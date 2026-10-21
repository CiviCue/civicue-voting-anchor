// A local chain posing as Base Sepolia: an anvil process and a freshly deployed AnchorRegistry.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { anchorRegistryAbi } from "@civicue/voting-anchor-contracts";
import {
  createTestClient,
  createWalletClient,
  getAddress,
  http,
  publicActions,
  type Address,
  type Hex,
} from "viem";
import { baseSepolia } from "viem/chains";
import type { WorkerChain } from "./worker.ts";

export const ARTIFACT = join(
  import.meta.dirname,
  "../../contracts/out/AnchorRegistry.sol/AnchorRegistry.json",
);

/** Why a local chain cannot run here, or `undefined` when it can. */
export function localChainUnavailable(): string | undefined {
  if (spawnSync("anvil", ["--version"]).status !== 0)
    return "needs Foundry's anvil on PATH";
  if (!existsSync(ARTIFACT))
    return "needs `pnpm --filter @civicue/voting-anchor-contracts build`";
  return undefined;
}

export interface LocalChain extends WorkerChain {
  rpcUrl: string;
  relayer: Address;
  stop: () => void;
}

/** Starts anvil with Base Sepolia's chain id and deploys a registry whose owner and relayer is the first account. */
export async function startLocalChain(port: number): Promise<LocalChain> {
  const rpcUrl = `http://127.0.0.1:${port}`;
  const anvil: ChildProcess = spawn(
    "anvil",
    ["--port", String(port), "--chain-id", String(baseSepolia.id), "--silent"],
    {
      stdio: "ignore",
    },
  );
  const client = createTestClient({
    chain: baseSepolia,
    mode: "anvil",
    transport: http(rpcUrl),
    pollingInterval: 100,
  }).extend(publicActions);
  for (let attempt = 0; ; attempt++) {
    try {
      await client.getChainId();
      break;
    } catch (error) {
      if (attempt > 100) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  const [relayer] = await createWalletClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
  }).getAddresses();
  const wallet = createWalletClient({
    account: relayer!,
    chain: baseSepolia,
    transport: http(rpcUrl),
  });
  const { bytecode } = JSON.parse(readFileSync(ARTIFACT, "utf8")) as {
    bytecode: { object: Hex };
  };
  const deployment = await wallet.deployContract({
    abi: anchorRegistryAbi,
    bytecode: bytecode.object,
    args: [relayer!, relayer!],
  });
  const registry = getAddress(
    (await client.waitForTransactionReceipt({ hash: deployment }))
      .contractAddress!,
  );

  return {
    rpcUrl,
    relayer: relayer!,
    registry,
    publicClient: client as unknown as WorkerChain["publicClient"],
    wallet,
    // anvil mines one block per transaction, so a successful receipt is final.
    confirm: async (hash) => {
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success")
        throw new Error(`anchor transaction ${hash} reverted`);
    },
    stop: () => anvil.kill(),
  };
}
