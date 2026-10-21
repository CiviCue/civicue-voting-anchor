// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AnchorRegistry} from "../src/AnchorRegistry.sol";

/// @dev Drives random interleavings of every state-changing entry point from a small pool of
///      actors and sessions, and records what a correct registry must have stored.
contract RegistryHandler is Test {
    AnchorRegistry public immutable registry;

    address[] internal actors;
    bytes32[] internal sessions;

    struct Expected {
        bytes32 merkleRoot;
        bytes32 tallyHash;
        uint64 timestamp;
        uint64 blockNumber;
    }

    mapping(bytes32 sessionId => Expected) public expected;
    uint256 public successfulWrites;
    uint256 public unauthorizedWriteAttempts;

    constructor(AnchorRegistry registry_, address[] memory actors_) {
        registry = registry_;
        actors = actors_;
        for (uint256 i; i < 6; ++i) {
            sessions.push(keccak256(abi.encode("session", i)));
        }
        sessions.push(bytes32(0));
    }

    function sessionCount() external view returns (uint256) {
        return sessions.length;
    }

    function sessionAt(uint256 i) external view returns (bytes32) {
        return sessions[i];
    }

    function anchor(uint256 actorSeed, uint256 sessionSeed, bytes32 root, bytes32 tally) external {
        address caller = actors[actorSeed % actors.length];
        bytes32 session = sessions[sessionSeed % sessions.length];
        vm.warp(block.timestamp + 1);
        vm.roll(block.number + 1);

        bool authorized = caller == registry.relayer();
        bool fresh = registry.getAnchor(session).timestamp == 0;
        bool nonZero = session != 0 && root != 0 && tally != 0;

        vm.prank(caller);
        try registry.anchor(session, root, tally) {
            // A write may only succeed when every precondition held.
            assertTrue(authorized && fresh && nonZero, "write succeeded without preconditions");
            expected[session] = Expected(root, tally, uint64(block.timestamp), uint64(block.number));
            ++successfulWrites;
        } catch {
            assertFalse(authorized && fresh && nonZero, "valid write reverted");
            if (!authorized) ++unauthorizedWriteAttempts;
        }
    }

    function setRelayer(uint256 actorSeed, uint256 relayerSeed, bool toZero) external {
        address caller = actors[actorSeed % actors.length];
        address next = toZero ? address(0) : actors[relayerSeed % actors.length];
        vm.prank(caller);
        try registry.setRelayer(next) {
            assertEq(caller, registry.owner(), "non-owner rotated relayer");
        } catch {}
    }

    function transferOwnership(uint256 actorSeed, uint256 nextSeed) external {
        address caller = actors[actorSeed % actors.length];
        vm.prank(caller);
        try registry.transferOwnership(actors[nextSeed % actors.length]) {} catch {}
    }

    function acceptOwnership(uint256 actorSeed) external {
        vm.prank(actors[actorSeed % actors.length]);
        try registry.acceptOwnership() {} catch {}
    }

    function renounceOwnership(uint256 actorSeed) external {
        vm.prank(actors[actorSeed % actors.length]);
        try registry.renounceOwnership() {} catch {}
    }
}

/// @notice Requirement-level properties that must hold after any sequence of calls.
contract AnchorRegistryInvariantTest is Test {
    AnchorRegistry internal registry;
    RegistryHandler internal handler;

    function setUp() public {
        vm.warp(1_760_000_000);
        vm.roll(30_000_000);

        address[] memory actors = new address[](4);
        actors[0] = makeAddr("owner");
        actors[1] = makeAddr("relayer");
        actors[2] = makeAddr("next");
        actors[3] = makeAddr("stranger");

        registry = new AnchorRegistry(actors[0], actors[1]);
        handler = new RegistryHandler(registry, actors);
        targetContract(address(handler));
    }

    /// Write-once: a stored commitment always equals the one written first.
    function invariant_CommitmentsNeverChangeOnceWritten() public view {
        for (uint256 i; i < handler.sessionCount(); ++i) {
            bytes32 session = handler.sessionAt(i);
            AnchorRegistry.Anchor memory stored = registry.getAnchor(session);
            (bytes32 root, bytes32 tally, uint64 timestamp, uint64 blockNumber) =
                handler.expected(session);
            assertEq(stored.merkleRoot, root);
            assertEq(stored.tallyHash, tally);
            assertEq(stored.timestamp, timestamp);
            assertEq(stored.blockNumber, blockNumber);
        }
    }

    /// No zero commitment and no zero session id is ever stored.
    function invariant_NoZeroCommitmentStored() public view {
        assertEq(registry.getAnchor(bytes32(0)).timestamp, 0);
        for (uint256 i; i < handler.sessionCount(); ++i) {
            AnchorRegistry.Anchor memory stored = registry.getAnchor(handler.sessionAt(i));
            if (stored.timestamp != 0) {
                assertTrue(stored.merkleRoot != 0 && stored.tallyHash != 0);
            }
        }
    }

    /// The registry always has an owner, so relayer rotation is never lost.
    function invariant_OwnerNeverZero() public view {
        assertTrue(registry.owner() != address(0));
    }

    /// Each stored session corresponds to exactly one successful write.
    function invariant_StoredCountMatchesSuccessfulWrites() public view {
        uint256 stored;
        for (uint256 i; i < handler.sessionCount(); ++i) {
            if (registry.getAnchor(handler.sessionAt(i)).timestamp != 0) ++stored;
        }
        assertEq(stored, handler.successfulWrites());
    }
}
