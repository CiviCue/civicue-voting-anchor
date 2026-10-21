import { anchorRegistryAbi } from "@civicue/voting-anchor-contracts";
import {
  createPublicClient,
  http,
  type Address,
  type Chain,
  type Hex,
} from "viem";
import { base, baseSepolia } from "viem/chains";

export const NETWORKS = {
  base,
  "base-sepolia": baseSepolia,
} as const satisfies Record<string, Chain>;

export type NetworkName = keyof typeof NETWORKS;

export function isNetworkName(name: string): name is NetworkName {
  return Object.hasOwn(NETWORKS, name);
}

/** `AnchorRegistry.getAnchor(sessionId)`. `timestamp == 0n` means the session is not anchored. */
export interface OnChainAnchor {
  readonly merkleRoot: Hex;
  readonly tallyHash: Hex;
  readonly timestamp: bigint;
  readonly blockNumber: bigint;
}

export interface ReadAnchorOptions {
  readonly network: NetworkName;
  /** The registry this session was anchored to; registries are redeployable, so there is no default. */
  readonly contract: Address;
  /** `keccak256(bytes(lowercaseSessionIdString))`. */
  readonly sessionId: Hex;
  /** JSON-RPC endpoint; defaults to the chain's public RPC. */
  readonly rpcUrl?: string;
}

/** Reads a session's commitment. Read-only: never sends a transaction. */
export async function readAnchor({
  network,
  contract,
  sessionId,
  rpcUrl,
}: ReadAnchorOptions): Promise<OnChainAnchor> {
  const chain = NETWORKS[network];
  const client = createPublicClient({ chain, transport: http(rpcUrl) });
  const rpcChainId = await client.getChainId();
  if (rpcChainId !== chain.id) {
    throw new Error(
      `RPC endpoint is on chain ${rpcChainId}, expected ${network} (${chain.id})`,
    );
  }
  const anchor = await client.readContract({
    address: contract,
    abi: anchorRegistryAbi,
    functionName: "getAnchor",
    args: [sessionId],
  });
  return {
    merkleRoot: anchor.merkleRoot,
    tallyHash: anchor.tallyHash,
    timestamp: anchor.timestamp,
    blockNumber: anchor.blockNumber,
  };
}
