// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {AnchorRegistry} from "../src/AnchorRegistry.sol";

/// @notice Deploys AnchorRegistry in a single transaction with its owner and relayer.
/// @dev Local anvil only. Env: INITIAL_OWNER, INITIAL_RELAYER.
///      forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --unlocked --sender <addr> --broadcast
contract Deploy is Script {
    function run() external returns (AnchorRegistry registry) {
        address initialOwner = vm.envAddress("INITIAL_OWNER");
        address initialRelayer = vm.envAddress("INITIAL_RELAYER");
        require(initialOwner != address(0), "INITIAL_OWNER is zero");
        require(initialRelayer != address(0), "INITIAL_RELAYER is zero");

        vm.startBroadcast();
        registry = new AnchorRegistry(initialOwner, initialRelayer);
        vm.stopBroadcast();

        console.log("AnchorRegistry", address(registry));
        console.log("owner", initialOwner);
        console.log("relayer", initialRelayer);
    }
}
