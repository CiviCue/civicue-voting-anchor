// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AnchorRegistry} from "../src/AnchorRegistry.sol";

contract AnchorRegistryTest is Test {
    event Anchored(
        bytes32 indexed sessionId, bytes32 merkleRoot, bytes32 tallyHash, uint64 timestamp
    );
    event RelayerUpdated(address indexed oldRelayer, address indexed newRelayer);

    AnchorRegistry internal registry;

    address internal owner = makeAddr("owner");
    address internal relayer = makeAddr("relayer");
    address internal stranger = makeAddr("stranger");

    bytes32 internal constant SESSION = keccak256("65f1c2a9e4b0d3f7a8c91e20");
    bytes32 internal constant ROOT = keccak256("root");
    bytes32 internal constant TALLY = keccak256("tally");

    function setUp() public {
        vm.warp(1_760_000_000);
        vm.roll(30_000_000);
        registry = new AnchorRegistry(owner, relayer);
    }

    // ---------------------------------------------------------------- constructor

    function test_Constructor_SetsOwnerAndRelayer_RegardlessOfDeployer() public {
        vm.prank(stranger);
        AnchorRegistry deployed = new AnchorRegistry(owner, relayer);

        assertEq(deployed.owner(), owner);
        assertEq(deployed.relayer(), relayer);
    }

    function test_Constructor_EmitsRelayerUpdated() public {
        vm.expectEmit(true, true, false, false);
        emit RelayerUpdated(address(0), relayer);
        new AnchorRegistry(owner, relayer);
    }

    function test_Constructor_RevertsOnZeroOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new AnchorRegistry(address(0), relayer);
    }

    // ---------------------------------------------------------------- anchor

    function test_Anchor_StoresCommitmentAndEmits() public {
        vm.expectEmit(true, false, false, true);
        emit Anchored(SESSION, ROOT, TALLY, uint64(block.timestamp));

        vm.prank(relayer);
        registry.anchor(SESSION, ROOT, TALLY);

        AnchorRegistry.Anchor memory a = registry.getAnchor(SESSION);
        assertEq(a.merkleRoot, ROOT);
        assertEq(a.tallyHash, TALLY);
        assertEq(a.timestamp, uint64(block.timestamp));
        assertEq(a.blockNumber, uint64(block.number));
    }

    function test_Anchor_RecordsBlockNumberOfAnchoringBlock() public {
        vm.roll(42_424_242);
        vm.prank(relayer);
        registry.anchor(SESSION, ROOT, TALLY);

        assertEq(registry.getAnchor(SESSION).blockNumber, 42_424_242);
    }

    function test_Anchor_RevertsForNonRelayer() public {
        vm.expectRevert(AnchorRegistry.NotRelayer.selector);
        vm.prank(stranger);
        registry.anchor(SESSION, ROOT, TALLY);
    }

    function test_Anchor_RevertsForOwner() public {
        vm.expectRevert(AnchorRegistry.NotRelayer.selector);
        vm.prank(owner);
        registry.anchor(SESSION, ROOT, TALLY);
    }

    function test_Anchor_RevertsOnReanchor_AndKeepsOriginal() public {
        vm.prank(relayer);
        registry.anchor(SESSION, ROOT, TALLY);
        AnchorRegistry.Anchor memory before = registry.getAnchor(SESSION);

        vm.warp(block.timestamp + 1 days);
        vm.roll(block.number + 100);
        vm.expectRevert(abi.encodeWithSelector(AnchorRegistry.AlreadyAnchored.selector, SESSION));
        vm.prank(relayer);
        registry.anchor(SESSION, keccak256("other-root"), keccak256("other-tally"));

        AnchorRegistry.Anchor memory afterwards = registry.getAnchor(SESSION);
        assertEq(afterwards.merkleRoot, before.merkleRoot);
        assertEq(afterwards.tallyHash, before.tallyHash);
        assertEq(afterwards.timestamp, before.timestamp);
        assertEq(afterwards.blockNumber, before.blockNumber);
    }

    function test_Anchor_RevertsOnZeroSessionId() public {
        _expectZeroCommitment(bytes32(0), ROOT, TALLY);
    }

    function test_Anchor_RevertsOnZeroMerkleRoot() public {
        _expectZeroCommitment(SESSION, bytes32(0), TALLY);
    }

    function test_Anchor_RevertsOnZeroTallyHash() public {
        _expectZeroCommitment(SESSION, ROOT, bytes32(0));
    }

    function testFuzz_Anchor_RoundTrips(bytes32 sessionId, bytes32 root, bytes32 tally) public {
        vm.assume(sessionId != bytes32(0) && root != bytes32(0) && tally != bytes32(0));

        vm.prank(relayer);
        registry.anchor(sessionId, root, tally);

        AnchorRegistry.Anchor memory a = registry.getAnchor(sessionId);
        assertEq(a.merkleRoot, root);
        assertEq(a.tallyHash, tally);
        assertGt(a.timestamp, 0);
    }

    // ---------------------------------------------------------------- getAnchor

    function test_GetAnchor_UnanchoredReturnsZeroStruct() public view {
        AnchorRegistry.Anchor memory a = registry.getAnchor(SESSION);
        assertEq(a.merkleRoot, bytes32(0));
        assertEq(a.tallyHash, bytes32(0));
        assertEq(a.timestamp, 0);
        assertEq(a.blockNumber, 0);
    }

    function test_GetAnchor_IsPublic() public {
        vm.prank(relayer);
        registry.anchor(SESSION, ROOT, TALLY);

        vm.prank(stranger);
        assertEq(registry.getAnchor(SESSION).merkleRoot, ROOT);
    }

    // ---------------------------------------------------------------- relayer rotation

    function test_SetRelayer_RotatesAndEmits() public {
        address next = makeAddr("next");

        vm.expectEmit(true, true, false, false);
        emit RelayerUpdated(relayer, next);
        vm.prank(owner);
        registry.setRelayer(next);

        assertEq(registry.relayer(), next);

        vm.expectRevert(AnchorRegistry.NotRelayer.selector);
        vm.prank(relayer);
        registry.anchor(SESSION, ROOT, TALLY);

        vm.prank(next);
        registry.anchor(SESSION, ROOT, TALLY);
        assertEq(registry.getAnchor(SESSION).merkleRoot, ROOT);
    }

    function test_SetRelayer_RevertsForNonOwner() public {
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
        vm.prank(stranger);
        registry.setRelayer(stranger);
    }

    function test_SetRelayer_ZeroIsKillSwitch_ReadsStillWork() public {
        vm.prank(relayer);
        registry.anchor(SESSION, ROOT, TALLY);

        vm.prank(owner);
        registry.setRelayer(address(0));

        vm.expectRevert(AnchorRegistry.NotRelayer.selector);
        vm.prank(relayer);
        registry.anchor(keccak256("another"), ROOT, TALLY);

        // Nobody else can write either. (address(0) itself can never be msg.sender on a real
        // chain: no key controls it and no code is deployed there.)
        vm.expectRevert(AnchorRegistry.NotRelayer.selector);
        vm.prank(owner);
        registry.anchor(keccak256("another"), ROOT, TALLY);

        assertEq(registry.getAnchor(SESSION).merkleRoot, ROOT);
    }

    // ---------------------------------------------------------------- ownership

    function test_TransferOwnership_IsTwoStep() public {
        address nextOwner = makeAddr("nextOwner");

        vm.prank(owner);
        registry.transferOwnership(nextOwner);

        assertEq(registry.owner(), owner);
        assertEq(registry.pendingOwner(), nextOwner);

        // Old owner keeps control until the transfer is accepted.
        vm.prank(owner);
        registry.setRelayer(makeAddr("interim"));

        vm.prank(nextOwner);
        registry.acceptOwnership();
        assertEq(registry.owner(), nextOwner);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, owner));
        vm.prank(owner);
        registry.setRelayer(relayer);

        vm.prank(nextOwner);
        registry.setRelayer(relayer);
        assertEq(registry.relayer(), relayer);
    }

    function test_AcceptOwnership_RevertsForNonPendingOwner() public {
        vm.prank(owner);
        registry.transferOwnership(makeAddr("nextOwner"));

        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
        vm.prank(stranger);
        registry.acceptOwnership();
    }

    function test_RenounceOwnership_Reverts() public {
        vm.expectRevert(AnchorRegistry.RenounceDisabled.selector);
        vm.prank(owner);
        registry.renounceOwnership();

        assertEq(registry.owner(), owner);
    }

    // ---------------------------------------------------------------- helpers

    function _expectZeroCommitment(bytes32 sessionId, bytes32 root, bytes32 tally) internal {
        vm.expectRevert(AnchorRegistry.ZeroCommitment.selector);
        vm.prank(relayer);
        registry.anchor(sessionId, root, tally);

        assertEq(registry.getAnchor(sessionId).timestamp, 0);
    }
}
