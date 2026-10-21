// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title AnchorRegistry
/// @notice Write-once registry of per-session voting commitments (`merkleRoot` + `tallyHash`).
/// @dev Only the authorized relayer can write; anyone can read. The contract holds no funds and
///      is disposable: every commitment is reproducible off-chain, so a compromise is recovered
///      by redeploying and re-anchoring.
contract AnchorRegistry is Ownable2Step {
    /// @notice A session's commitment. `timestamp == 0` means the session is not anchored.
    /// @dev `timestamp` and `blockNumber` pack into a single storage slot.
    struct Anchor {
        bytes32 merkleRoot;
        bytes32 tallyHash;
        uint64 timestamp;
        uint64 blockNumber;
    }

    /// @notice The only address allowed to call {anchor}. `address(0)` disables all writes.
    address public relayer;

    mapping(bytes32 sessionId => Anchor) private _anchors;

    /// @notice Emitted when a session's commitment is recorded.
    /// @param sessionId `keccak256(bytes(lowercaseSessionIdString))` of the CiviCue platform's session id.
    /// @param merkleRoot Merkle root over the session's canonical ballot leaves.
    /// @param tallyHash Hash of the session's canonical tally output.
    /// @param timestamp `block.timestamp` at which the commitment was recorded.
    event Anchored(
        bytes32 indexed sessionId, bytes32 merkleRoot, bytes32 tallyHash, uint64 timestamp
    );

    /// @notice Emitted when the authorized relayer changes, including at construction.
    /// @param oldRelayer The previously authorized relayer (`address(0)` at construction).
    /// @param newRelayer The newly authorized relayer (`address(0)` disables writes).
    event RelayerUpdated(address indexed oldRelayer, address indexed newRelayer);

    /// @notice The caller is not the authorized relayer.
    error NotRelayer();

    /// @notice The session already has a commitment; commitments are write-once.
    /// @param sessionId The session that is already anchored.
    error AlreadyAnchored(bytes32 sessionId);

    /// @notice `sessionId`, `merkleRoot`, or `tallyHash` is zero.
    error ZeroCommitment();

    /// @notice Ownership cannot be renounced; an ownerless registry could never rotate its relayer.
    error RenounceDisabled();

    modifier onlyRelayer() {
        if (msg.sender != relayer) revert NotRelayer();
        _;
    }

    /// @param initialOwner Owner allowed to rotate the relayer and transfer ownership.
    /// @param initialRelayer Initially authorized relayer (may be `address(0)` to start disabled).
    // `address(0)` is a valid relayer: it starts the registry with writes disabled.
    // forge-lint: disable-next-line(missing-zero-check)
    constructor(address initialOwner, address initialRelayer) Ownable(initialOwner) {
        // slither-disable-next-line missing-zero-check
        relayer = initialRelayer;
        emit RelayerUpdated(address(0), initialRelayer);
    }

    /// @notice Records the commitment for a session. Callable once per session, by the relayer only.
    /// @param sessionId `keccak256(bytes(lowercaseSessionIdString))` of the CiviCue platform's session id.
    /// @param merkleRoot Merkle root over the session's canonical ballot leaves.
    /// @param tallyHash Hash of the session's canonical tally output.
    function anchor(bytes32 sessionId, bytes32 merkleRoot, bytes32 tallyHash) external onlyRelayer {
        if (sessionId == bytes32(0) || merkleRoot == bytes32(0) || tallyHash == bytes32(0)) {
            revert ZeroCommitment();
        }
        Anchor storage existing = _anchors[sessionId];
        if (existing.timestamp != 0) revert AlreadyAnchored(sessionId);

        // Casting to uint64 is safe: block timestamps and numbers stay far below 2^64.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 timestamp = uint64(block.timestamp);
        _anchors[sessionId] = Anchor({
            merkleRoot: merkleRoot,
            tallyHash: tallyHash,
            timestamp: timestamp,
            // forge-lint: disable-next-line(unsafe-typecast)
            blockNumber: uint64(block.number)
        });
        emit Anchored(sessionId, merkleRoot, tallyHash, timestamp);
    }

    /// @notice Returns a session's commitment, or a zero-valued struct if it is not anchored.
    /// @param sessionId `keccak256(bytes(lowercaseSessionIdString))` of the CiviCue platform's session id.
    function getAnchor(bytes32 sessionId) external view returns (Anchor memory) {
        return _anchors[sessionId];
    }

    /// @notice Sets the authorized relayer. `address(0)` acts as a kill switch for all writes.
    /// @param newRelayer The address to authorize.
    // `address(0)` is intentional: it is the kill switch.
    // forge-lint: disable-next-line(missing-zero-check)
    function setRelayer(address newRelayer) external onlyOwner {
        address oldRelayer = relayer;
        // slither-disable-next-line missing-zero-check
        relayer = newRelayer;
        emit RelayerUpdated(oldRelayer, newRelayer);
    }

    /// @notice Always reverts: ownership cannot be renounced.
    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }
}
