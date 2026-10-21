// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {AnchorRegistry} from "../src/AnchorRegistry.sol";

/// @notice Owner operations on a deployed AnchorRegistry. Each is simulated before broadcast.
/// @dev Env: REGISTRY plus the per-script variable. Sign with the owner key, passing whatever
///      signer flag it needs, e.g.
///      forge script script/Ops.s.sol:SetRelayer --rpc-url base_sepolia --account <name> --broadcast
abstract contract RegistryScript is Script {
    function _registry() internal view returns (AnchorRegistry) {
        return AnchorRegistry(vm.envAddress("REGISTRY"));
    }
}

/// @notice Rotates the relayer. Env: NEW_RELAYER (`0x000…000` disables all writes).
contract SetRelayer is RegistryScript {
    function run() external {
        AnchorRegistry registry = _registry();
        address newRelayer = vm.envAddress("NEW_RELAYER");
        console.log("relayer", registry.relayer(), "->", newRelayer);

        vm.startBroadcast();
        registry.setRelayer(newRelayer);
        vm.stopBroadcast();
    }
}

/// @notice Step 1 of an ownership transfer, signed by the current owner. Env: NEW_OWNER.
contract TransferOwnership is RegistryScript {
    function run() external {
        AnchorRegistry registry = _registry();
        address newOwner = vm.envAddress("NEW_OWNER");
        console.log("pending owner", newOwner);

        vm.startBroadcast();
        registry.transferOwnership(newOwner);
        vm.stopBroadcast();
    }
}

/// @notice Step 2 of an ownership transfer, signed by the pending owner.
contract AcceptOwnership is RegistryScript {
    function run() external {
        AnchorRegistry registry = _registry();
        console.log("accepting ownership of", address(registry));

        vm.startBroadcast();
        registry.acceptOwnership();
        vm.stopBroadcast();
    }
}
