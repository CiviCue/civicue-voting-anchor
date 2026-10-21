// The anchoring worker: one stateless batch that
// anchors every COMPUTED or FAILED session and records where it landed. The platform relays
// through an ERC-4337 smart account; here the relayer is a plain anvil account, which the
// verifier cannot tell apart, since it only reads getAnchor.
import { anchorRegistryAbi } from "@civicue/voting-anchor-contracts";
import {
  keccak256,
  stringToBytes,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import type { Store, VotingSession } from "./platform.ts";

export interface WorkerChain {
  publicClient: PublicClient;
  wallet: WalletClient;
  registry: Address;
  /** Waits until a submitted transaction is confirmed. */
  confirm: (hash: Hex) => Promise<void>;
}

/** The on-chain key: keccak256 of the lowercase session id string. */
export const onChainSessionId = (id: string): Hex =>
  keccak256(stringToBytes(id.toLowerCase()));

export interface BatchResult {
  anchored: string[];
  reconciled: string[];
  failed: { id: string; error: string }[];
}

export async function runAnchorBatch(
  store: Store,
  chain: WorkerChain,
): Promise<BatchResult> {
  const result: BatchResult = { anchored: [], reconciled: [], failed: [] };
  const chainId = await chain.publicClient.getChainId();
  const eligible = [...store.sessions.values()].filter(
    (session) =>
      session.status === "COMPLETED" &&
      (session.anchorStatus === "COMPUTED" ||
        session.anchorStatus === "FAILED") &&
      !session.anchorTxHash,
  );
  for (const session of eligible) {
    try {
      const existing = await chain.publicClient.readContract({
        address: chain.registry,
        abi: anchorRegistryAbi,
        functionName: "getAnchor",
        args: [onChainSessionId(session.id)],
      });
      if (existing.timestamp !== 0n) {
        // Write-once: a previous run already anchored it. Reconcile instead of resubmitting.
        if (
          existing.merkleRoot !== session.merkleRoot ||
          existing.tallyHash !== session.tallyHash
        )
          throw new Error("on-chain commitment differs from the computed one");
        markAnchored(
          session,
          await anchorTxOf(chain, session),
          chain.registry,
          chainId,
        );
        result.reconciled.push(session.id);
        continue;
      }
      const hash = await chain.wallet.writeContract({
        address: chain.registry,
        abi: anchorRegistryAbi,
        functionName: "anchor",
        args: [
          onChainSessionId(session.id),
          session.merkleRoot!,
          session.tallyHash!,
        ],
        account: chain.wallet.account!,
        chain: chain.wallet.chain,
      });
      await chain.confirm(hash);
      markAnchored(session, hash, chain.registry, chainId);
      result.anchored.push(session.id);
    } catch (error) {
      session.anchorStatus = "FAILED";
      result.failed.push({
        id: session.id,
        error:
          error instanceof Error
            ? error.message.split("\n")[0]!
            : String(error),
      });
    }
  }
  return result;
}

function markAnchored(
  session: VotingSession,
  txHash: Hex,
  registry: Address,
  chainId: number,
): void {
  Object.assign(session, {
    anchorStatus: "ANCHORED",
    anchorTxHash: txHash,
    anchorContract: registry,
    chainId,
  });
}

async function anchorTxOf(
  chain: WorkerChain,
  session: VotingSession,
): Promise<Hex> {
  const [event] = await chain.publicClient.getContractEvents({
    address: chain.registry,
    abi: anchorRegistryAbi,
    eventName: "Anchored",
    args: { sessionId: onChainSessionId(session.id) },
    fromBlock: 0n,
  });
  if (!event) throw new Error("anchored on chain but no Anchored event found");
  return event.transactionHash;
}
