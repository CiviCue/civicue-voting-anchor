// End to end against a local anvil chain posing as Base Sepolia: deploys AnchorRegistry,
// anchors vector commitments, serves the public verification API over HTTP, and runs the
// CLI as a subprocess. Skipped when Foundry's `anvil` or the forge build output is missing.
import assert from "node:assert/strict";
import {
  execFile,
  spawn,
  spawnSync,
  type ChildProcess,
} from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { anchorRegistryAbi } from "@civicue/voting-anchor-contracts";
import {
  createTestClient,
  createWalletClient,
  http,
  publicActions,
  type Hex,
} from "viem";
import { baseSepolia } from "viem/chains";
import {
  computeCommitment,
  sessionIdToBytes32,
  type AnchorMetadata,
} from "../src/index.ts";
import { loadVectors } from "../src/vectors.ts";

const ARTIFACT = join(
  import.meta.dirname,
  "../../contracts/out/AnchorRegistry.sol/AnchorRegistry.json",
);
const CLI = join(import.meta.dirname, "../src/cli.ts");
const hasAnvil = spawnSync("anvil", ["--version"]).status === 0;
const skip =
  !hasAnvil || !existsSync(ARTIFACT)
    ? "needs anvil and `forge build` output in packages/contracts"
    : false;

const SESSIONS = {
  "v1/majority/basic.json": "65f1c2a9e4b0d3f7a8c91e20",
  "v1/quadratic/basic.json": "6650a3b2c1d0e9f8a7b6c5d4",
  "v1/ranked-choice/elimination.json": "000000000000000000000000",
} as const;
const UNANCHORED = "ffffffffffffffffffffffff";

describe("e2e: CLI against anvil", { skip }, () => {
  let anvil: ChildProcess;
  let server: Server;
  let rpcUrl: string;
  let platform: string;
  const routes = new Map<string, unknown>();

  before(async () => {
    const port = 18545 + Math.floor(Math.random() * 1000);
    rpcUrl = `http://127.0.0.1:${port}`;
    anvil = spawn(
      "anvil",
      [
        "--port",
        String(port),
        "--chain-id",
        String(baseSepolia.id),
        "--silent",
      ],
      { stdio: "ignore" },
    );
    const client = createTestClient({
      chain: baseSepolia,
      mode: "anvil",
      transport: http(rpcUrl),
    }).extend(publicActions);
    await waitFor(() => client.getChainId());

    const [deployer] = await createWalletClient({
      chain: baseSepolia,
      transport: http(rpcUrl),
    }).getAddresses();
    const wallet = createWalletClient({
      account: deployer!,
      chain: baseSepolia,
      transport: http(rpcUrl),
    });
    const { bytecode } = JSON.parse(readFileSync(ARTIFACT, "utf8")) as {
      bytecode: { object: Hex };
    };
    const hash = await wallet.deployContract({
      abi: anchorRegistryAbi,
      bytecode: bytecode.object,
      args: [deployer!, deployer!],
    });
    const registry = (await client.waitForTransactionReceipt({ hash }))
      .contractAddress!;

    const vectors = loadVectors();
    for (const [path, session] of Object.entries(SESSIONS)) {
      const dataset = vectors.find((vector) => vector.path === path)!.dataset;
      const commitment = computeCommitment(dataset);
      const tx = await wallet.writeContract({
        address: registry,
        abi: anchorRegistryAbi,
        functionName: "anchor",
        args: [
          sessionIdToBytes32(session),
          commitment.merkleRoot,
          commitment.tallyHash,
        ],
      });
      await client.waitForTransactionReceipt({ hash: tx });
      const winners = commitment.tally.winners;
      const totals =
        commitment.tally.votingMethod === "RANKED_CHOICE"
          ? commitment.tally.rounds.at(-1)!.totals
          : commitment.tally.totals;
      const metadata: AnchorMetadata = {
        sessionId: session,
        votingMethod: commitment.tally.votingMethod,
        anchorStatus: "ANCHORED",
        schemaVersion: 1,
        merkleRoot: commitment.merkleRoot,
        tallyHash: commitment.tallyHash,
        anchorTxHash: tx,
        anchorContract: registry,
        chainId: baseSepolia.id,
        result: {
          winner: winners.length === 1 ? winners[0]! : null,
          turnout: commitment.tally.ballotCount,
          options: Object.entries(totals).map(([id, votes]) => ({ id, votes })),
        },
      };
      routes.set(`/v2/voting/sessions/${session}/anchor`, metadata);
      routes.set(`/v2/voting/sessions/${session}/anchor/dataset`, dataset);
    }
    // A local "archived copy" of the quadratic dataset with one ballot altered.
    const quadratic = structuredClone(
      routes.get(
        `/v2/voting/sessions/${SESSIONS["v1/quadratic/basic.json"]}/anchor/dataset`,
      ),
    ) as {
      ballots: { allocations: Record<string, number> }[];
    };
    quadratic.ballots[1]!.allocations = { A: 3 };
    routes.set("/archive/tampered.json", quadratic);
    routes.set(`/v2/voting/sessions/${UNANCHORED}/anchor`, {
      ...(routes.get(
        `/v2/voting/sessions/${SESSIONS["v1/majority/basic.json"]}/anchor`,
      ) as object),
    });

    server = createServer((req, res) => {
      const body = routes.get(req.url ?? "");
      res
        .writeHead(body === undefined ? 404 : 200, {
          "content-type": "application/json",
        })
        .end(JSON.stringify(body ?? {}));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    platform = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(() => {
    server?.close();
    anvil?.kill();
  });

  const cli = (...args: string[]) =>
    new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
      execFile(process.execPath, [CLI, ...args], (error, stdout, stderr) =>
        resolve({ code: error ? Number(error.code) : 0, stdout, stderr }),
      );
    });
  const verify = (session: string, ...extra: string[]) =>
    cli(
      "verify",
      "--session",
      session,
      "--network",
      "base-sepolia",
      "--platform",
      platform,
      "--rpc-url",
      rpcUrl,
      ...extra,
    );

  for (const [path, session] of Object.entries(SESSIONS)) {
    test(`PASS for ${path}`, async () => {
      const { code, stdout } = await verify(session.toUpperCase());
      assert.equal(code, 0, stdout);
      assert.match(stdout, /^PASS/);
      assert.match(stdout, /changed after they were anchored on-chain\.$/m);
    });
  }

  test("FAIL with a diff for a tampered archived copy", async () => {
    const { code, stdout } = await verify(
      SESSIONS["v1/quadratic/basic.json"],
      "--dataset-url",
      `${platform}/archive/tampered.json`,
    );
    assert.equal(code, 1, stdout);
    assert.match(
      stdout,
      /^FAIL: mismatch in merkleRoot, tallyHash, resultSummary/,
    );
    assert.match(
      stdout,
      /✗ merkleRoot\n\s+on-chain\s+0x[0-9a-f]{64}\n\s+recomputed\s+0x[0-9a-f]{64}/,
    );
    assert.match(stdout, /C: published 5, recomputed 2 \(published 3 more\)/);
  });

  test("not anchored exits 2", async () => {
    const { code, stdout } = await verify(UNANCHORED);
    assert.equal(code, 2, stdout);
    assert.match(stdout, /^NOT_ANCHORED/);
  });

  test("--json prints a machine-readable report", async () => {
    const { code, stdout } = await verify(
      SESSIONS["v1/majority/basic.json"],
      "--json",
    );
    assert.equal(code, 0);
    const report = JSON.parse(stdout) as {
      outcome: string;
      onChain: { blockNumber: string };
    };
    assert.equal(report.outcome, "PASS");
    assert.match(report.onChain.blockNumber, /^\d+$/);
  });

  test("an RPC on the wrong chain is an error, not a verdict", async () => {
    const { code, stderr } = await cli(
      "verify",
      "--session",
      UNANCHORED,
      "--network",
      "base",
      "--contract",
      "0x0000000000000000000000000000000000000001",
      "--dataset-url",
      `${platform}/x`,
      "--rpc-url",
      rpcUrl,
    );
    assert.equal(code, 4);
    assert.match(stderr, /RPC endpoint is on chain 84532/);
  });
});

describe("CLI arguments", () => {
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });

  test("--help exits 0", () => {
    const { status, stdout } = run("verify", "--help");
    assert.equal(status, 0);
    assert.match(
      stdout,
      /Usage: voting-anchor-verifier verify --session <id> --network <base\|base-sepolia>/,
    );
  });

  test("usage errors exit 4", () => {
    assert.equal(run("verify", "--network", "base").status, 4);
    assert.equal(
      run("verify", "--session", UNANCHORED, "--network", "mainnet").status,
      4,
    );
    assert.equal(
      run("check", "--session", UNANCHORED, "--network", "base").status,
      4,
    );
    assert.equal(run("verify", "--bogus").status, 4);
  });
});

async function waitFor(probe: () => Promise<unknown>): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      await probe();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("anvil did not start");
}
