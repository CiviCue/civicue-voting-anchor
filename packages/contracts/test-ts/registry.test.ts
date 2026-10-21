// Integration tests against a local anvil node, exercising AnchorRegistry the way its
// consumers do: viem + the published typed ABI + the shared sessionId fixture.
// Requires `pnpm build` (forge artifacts + ts/generated.ts + ts/artifact.ts) and anvil on PATH.
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toBytes,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { foundry } from "viem/chains";
import { anchorRegistryAbi } from "../ts/generated.ts";
import { FACTORY, create2Deployment } from "../ts/create2.ts";

const root = join(import.meta.dirname, "..");
const port = 20_000 + Math.floor(Math.random() * 20_000);
const transport = http(`http://127.0.0.1:${port}`);
// anvil mines instantly; viem's 4s default polling would only slow the tests down.
const publicClient = createPublicClient({
  chain: foundry,
  transport,
  pollingInterval: 50,
});
const wallet = createWalletClient({ chain: foundry, transport });

let anvil: ChildProcess;
let deployer: Address, owner: Address, relayer: Address, stranger: Address;
let registry: Address;
let deployBlock: bigint;

const id = (label: string): Hex => keccak256(toBytes(label));

async function send(
  account: Address,
  functionName: "anchor" | "setRelayer" | "renounceOwnership",
  args: readonly unknown[],
) {
  const hash = await wallet.writeContract({
    account,
    address: registry,
    abi: anchorRegistryAbi,
    functionName,
    args,
  } as never);
  return publicClient.waitForTransactionReceipt({ hash });
}

/** Simulates a call and returns the decoded custom error, as a consumer would see it. */
async function revertOf(
  account: Address,
  functionName: "anchor" | "setRelayer" | "renounceOwnership",
  args: readonly unknown[],
) {
  try {
    await publicClient.simulateContract({
      account,
      address: registry,
      abi: anchorRegistryAbi,
      functionName,
      args,
    } as never);
  } catch (err) {
    const reverted = (err as BaseError).walk(
      (e) => e instanceof ContractFunctionRevertedError,
    );
    assert.ok(reverted instanceof ContractFunctionRevertedError, String(err));
    return reverted.data;
  }
  assert.fail(`${functionName} did not revert`);
}

before(async () => {
  anvil = spawn("anvil", ["--port", String(port), "--silent"], {
    stdio: "ignore",
  });
  for (let i = 0; ; i++) {
    try {
      await publicClient.getChainId();
      break;
    } catch {
      if (i > 100) throw new Error("anvil did not start");
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  [deployer, owner, relayer, stranger] = (await wallet.getAddresses()) as [
    Address,
    Address,
    Address,
    Address,
  ];

  // Deploy as a real-network deploy does: CREATE2 proxy, random salt.
  const { data, address } = create2Deployment(
    owner,
    relayer,
    toHex(randomBytes(32)),
  );
  const hash = await wallet.sendTransaction({
    account: deployer,
    to: FACTORY,
    data,
  });
  deployBlock = (await publicClient.waitForTransactionReceipt({ hash }))
    .blockNumber;
  registry = address;
});

after(() => {
  anvil?.kill();
});

describe("deployment through the CREATE2 proxy", () => {
  test("lands at the predicted address with roles from constructor args", async () => {
    assert.ok(await publicClient.getCode({ address: registry }));
    const read = (functionName: "owner" | "relayer") =>
      publicClient.readContract({
        address: registry,
        abi: anchorRegistryAbi,
        functionName,
      });
    assert.equal(await read("owner"), owner);
    assert.equal(await read("relayer"), relayer);
  });
});

describe("anchoring and reading (worker and verifier view)", () => {
  const session = id("session-1");
  const root = id("root-1");
  const tally = id("tally-1");

  test("relayer anchors; getAnchor returns the commitment with its block", async () => {
    const receipt = await send(relayer, "anchor", [session, root, tally]);
    const stored = await publicClient.readContract({
      address: registry,
      abi: anchorRegistryAbi,
      functionName: "getAnchor",
      args: [session],
    });
    assert.equal(stored.merkleRoot, root);
    assert.equal(stored.tallyHash, tally);
    assert.ok(stored.timestamp > 0n);
    assert.equal(stored.blockNumber, receipt.blockNumber);
  });

  test("Anchored event is found by indexed sessionId", async () => {
    const events = await publicClient.getContractEvents({
      address: registry,
      abi: anchorRegistryAbi,
      eventName: "Anchored",
      args: { sessionId: session },
      fromBlock: deployBlock,
    });
    assert.equal(events.length, 1);
    assert.equal(events[0]?.args.merkleRoot, root);
    assert.equal(events[0]?.args.tallyHash, tally);
  });

  test("un-anchored session reads as a zero struct without reverting", async () => {
    const stored = await publicClient.readContract({
      address: registry,
      abi: anchorRegistryAbi,
      functionName: "getAnchor",
      args: [id("never-anchored")],
    });
    assert.equal(stored.timestamp, 0n);
    assert.equal(stored.merkleRoot, `0x${"0".repeat(64)}`);
  });
});

describe("custom errors decode by name (worker reconciliation)", () => {
  test("re-anchor → AlreadyAnchored(sessionId)", async () => {
    const session = id("session-dup");
    await send(relayer, "anchor", [session, id("r"), id("t")]);
    const error = await revertOf(relayer, "anchor", [
      session,
      id("r2"),
      id("t2"),
    ]);
    assert.equal(error?.errorName, "AlreadyAnchored");
    assert.deepEqual(error?.args, [session]);
  });

  test("non-relayer → NotRelayer", async () => {
    const error = await revertOf(stranger, "anchor", [
      id("s"),
      id("r"),
      id("t"),
    ]);
    assert.equal(error?.errorName, "NotRelayer");
  });

  test("zero commitment → ZeroCommitment", async () => {
    const zero = `0x${"0".repeat(64)}` as Hex;
    const error = await revertOf(relayer, "anchor", [id("s0"), zero, id("t")]);
    assert.equal(error?.errorName, "ZeroCommitment");
  });

  test("renounceOwnership → RenounceDisabled", async () => {
    const error = await revertOf(owner, "renounceOwnership", []);
    assert.equal(error?.errorName, "RenounceDisabled");
  });
});

describe("shared sessionId encoding fixture", () => {
  const fixture = JSON.parse(
    readFileSync(join(root, "fixtures", "session-id.json"), "utf8"),
  ) as { cases: { input: string; normalized: string; sessionId: Hex }[] };

  test("viem derives the fixture sessionIds from lowercase session ids", () => {
    for (const c of fixture.cases) {
      assert.equal(c.input.toLowerCase(), c.normalized);
      assert.equal(keccak256(toBytes(c.input.toLowerCase())), c.sessionId);
    }
  });

  test("a fixture sessionId anchors and reads back on-chain", async () => {
    const sessionId = fixture.cases[1]!.sessionId; // the mixed-case input
    await send(relayer, "anchor", [sessionId, id("fx-root"), id("fx-tally")]);
    const stored = await publicClient.readContract({
      address: registry,
      abi: anchorRegistryAbi,
      functionName: "getAnchor",
      args: [sessionId],
    });
    assert.equal(stored.merkleRoot, id("fx-root"));
  });
});

describe("kill switch (runs last: disables writes)", () => {
  test("setRelayer(0) blocks every write; reads still work", async () => {
    await send(owner, "setRelayer", [zeroAddress]);
    const error = await revertOf(relayer, "anchor", [
      id("after-kill"),
      id("r"),
      id("t"),
    ]);
    assert.equal(error?.errorName, "NotRelayer");
    const stored = await publicClient.readContract({
      address: registry,
      abi: anchorRegistryAbi,
      functionName: "getAnchor",
      args: [id("session-1")],
    });
    assert.ok(stored.timestamp > 0n);
  });
});
