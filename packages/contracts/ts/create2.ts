// CREATE2 deployment of AnchorRegistry through the deterministic deployment proxy. Exported so
// deployers and the anvil integration tests exercise the same code path.
import {
  concat,
  encodeAbiParameters,
  getContractAddress,
  parseAbiParameters,
  type Address,
  type Hex,
} from "viem";
import { anchorRegistryBytecode } from "./artifact.ts";

/** Arachnid deterministic deployment proxy; calldata is `salt ‖ initCode`. */
export const FACTORY: Address = "0x4e59b44847b379578588920cA78FbF26c0B4956C";

export function constructorArgs(owner: Address, relayer: Address): Hex {
  return encodeAbiParameters(parseAbiParameters("address, address"), [
    owner,
    relayer,
  ]);
}

/** The call the deployer sends to FACTORY, and the address the registry will land at. */
export function create2Deployment(
  owner: Address,
  relayer: Address,
  salt: Hex,
  bytecode: Hex = anchorRegistryBytecode,
): { data: Hex; address: Address } {
  const initCode = concat([bytecode, constructorArgs(owner, relayer)]);
  return {
    data: concat([salt, initCode]),
    address: getContractAddress({
      opcode: "CREATE2",
      from: FACTORY,
      salt,
      bytecode: initCode,
    }),
  };
}
