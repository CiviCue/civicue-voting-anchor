// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

/// @notice Locks `sessionId = keccak256(bytes(lowercaseSessionIdString))` against the shared
///         fixture that the verifier and the CiviCue platform consume.
contract SessionIdEncodingTest is Test {
    /// @dev Fields are alphabetical so `vm.parseJson` decodes the fixture objects in order.
    struct Case {
        string input;
        string normalized;
        bytes32 sessionId;
    }

    function test_FixtureMatchesEncoding() public view {
        string memory json =
            vm.readFile(string.concat(vm.projectRoot(), "/fixtures/session-id.json"));
        Case[] memory cases = abi.decode(vm.parseJson(json, ".cases"), (Case[]));
        assertGt(cases.length, 0);

        for (uint256 i; i < cases.length; ++i) {
            Case memory c = cases[i];
            assertEq(bytes(c.normalized).length, 24, "session id must be 24 hex chars");
            assertEq(_lower(c.input), c.normalized, "input must normalize to lowercase");
            assertEq(keccak256(bytes(c.normalized)), c.sessionId, "sessionId mismatch");
        }
    }

    function _lower(string memory s) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        for (uint256 i; i < b.length; ++i) {
            if (b[i] >= "A" && b[i] <= "Z") b[i] = bytes1(uint8(b[i]) + 32);
        }
        return string(b);
    }
}
