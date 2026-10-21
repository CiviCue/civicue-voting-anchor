// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AnchorRegistry} from "../src/AnchorRegistry.sol";

/// @dev Stand-in for the relayer's ERC-4337 smart account: its owner-validated `execute`
///      forwards a CALL, so the registry sees the account (not the bundler) as msg.sender.
contract MockSmartAccount {
    address public immutable signer;

    constructor(address signer_) {
        signer = signer_;
    }

    function execute(address target, bytes calldata data) external returns (bytes memory) {
        require(msg.sender == signer, "not signer");
        (bool ok, bytes memory ret) = target.call(data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(ret, 32), mload(ret))
            }
        }
        return ret;
    }
}

/// @notice Production-shaped scenarios: deployment through the CREATE2 deployer proxy by the
///         relayer smart account, and anchoring with a contract (not an EOA) as relayer.
contract AnchorRegistryScenarioTest is Test {
    /// Arachnid deterministic deployment proxy, as deployed on Base and Base Sepolia.
    address internal constant FACTORY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    bytes internal constant FACTORY_CODE =
        hex"7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3";

    address internal ownerKey = makeAddr("ownerKey");
    address internal bundler = makeAddr("bundler");
    MockSmartAccount internal account;

    function setUp() public {
        vm.etch(FACTORY, FACTORY_CODE);
        account = new MockSmartAccount(ownerKey);
    }

    function test_DeployViaCreate2Proxy_RolesComeFromConstructorArgs() public {
        AnchorRegistry registry = _deployViaProxy(keccak256("salt-1"));

        assertEq(registry.owner(), ownerKey);
        assertEq(registry.relayer(), address(account));
        // Neither the proxy nor the deploying account gains any role.
        assertTrue(registry.owner() != FACTORY && registry.owner() != address(account));
    }

    function test_DeployViaCreate2Proxy_AddressIsPredictable() public {
        bytes32 salt = keccak256("salt-2");
        bytes memory initCode = _initCode();
        address predicted = vm.computeCreate2Address(salt, keccak256(initCode), FACTORY);

        assertEq(address(_deployViaProxy(salt)), predicted);
    }

    function test_DeployViaCreate2Proxy_SameSaltCannotRedeploy() public {
        bytes32 salt = keccak256("salt-3");
        _deployViaProxy(salt);

        vm.prank(ownerKey);
        vm.expectRevert();
        account.execute(FACTORY, abi.encodePacked(salt, _initCode()));
    }

    function test_DeployViaCreate2Proxy_FreshSaltGivesIndependentRegistry() public {
        AnchorRegistry first = _deployViaProxy(keccak256("salt-a"));
        AnchorRegistry second = _deployViaProxy(keccak256("salt-b"));
        bytes32 session = keccak256("session");

        _anchorThroughAccount(first, session, keccak256("r1"), keccak256("t1"));
        // A redeploy starts empty, so a disposed registry's anchors never block the new one.
        assertEq(second.getAnchor(session).timestamp, 0);
        _anchorThroughAccount(second, session, keccak256("r2"), keccak256("t2"));

        assertEq(first.getAnchor(session).merkleRoot, keccak256("r1"));
        assertEq(second.getAnchor(session).merkleRoot, keccak256("r2"));
    }

    function test_SmartAccountRelayer_AnchorsWithBundlerAsTxOrigin() public {
        AnchorRegistry registry = _deployViaProxy(keccak256("salt-4"));
        bytes32 session = keccak256("session");

        _anchorThroughAccount(registry, session, keccak256("root"), keccak256("tally"));

        assertEq(registry.getAnchor(session).merkleRoot, keccak256("root"));
    }

    function test_SmartAccountRelayer_BundlerCannotAnchorDirectly() public {
        AnchorRegistry registry = _deployViaProxy(keccak256("salt-5"));

        vm.expectRevert(AnchorRegistry.NotRelayer.selector);
        vm.prank(bundler, bundler);
        registry.anchor(keccak256("session"), keccak256("root"), keccak256("tally"));
    }

    function test_SmartAccountRelayer_SignerEoaCannotAnchorDirectly() public {
        AnchorRegistry registry = _deployViaProxy(keccak256("salt-6"));

        // The same key is the owner EOA, but only the smart account address is the relayer.
        vm.expectRevert(AnchorRegistry.NotRelayer.selector);
        vm.prank(ownerKey);
        registry.anchor(keccak256("session"), keccak256("root"), keccak256("tally"));
    }

    function test_SmartAccountRelayer_RevertDataSurvivesForwarding() public {
        AnchorRegistry registry = _deployViaProxy(keccak256("salt-7"));
        bytes32 session = keccak256("session");
        _anchorThroughAccount(registry, session, keccak256("root"), keccak256("tally"));

        vm.expectRevert(abi.encodeWithSelector(AnchorRegistry.AlreadyAnchored.selector, session));
        vm.prank(ownerKey, bundler);
        account.execute(
            address(registry),
            abi.encodeCall(AnchorRegistry.anchor, (session, keccak256("x"), keccak256("y")))
        );
    }

    function _initCode() internal view returns (bytes memory) {
        return
            abi.encodePacked(
                type(AnchorRegistry).creationCode, abi.encode(ownerKey, address(account))
            );
    }

    function _deployViaProxy(bytes32 salt) internal returns (AnchorRegistry) {
        vm.prank(ownerKey, bundler);
        bytes memory ret = account.execute(FACTORY, abi.encodePacked(salt, _initCode()));
        return AnchorRegistry(address(bytes20(ret)));
    }

    function _anchorThroughAccount(
        AnchorRegistry registry,
        bytes32 session,
        bytes32 root,
        bytes32 tally
    ) internal {
        vm.prank(ownerKey, bundler);
        account.execute(
            address(registry), abi.encodeCall(AnchorRegistry.anchor, (session, root, tally))
        );
    }
}
