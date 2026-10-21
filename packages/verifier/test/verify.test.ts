import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  computeCommitment,
  formatReport,
  GUARANTEE,
  verifySession,
  VerifyError,
  type AnchorMetadata,
  type OnChainAnchor,
  type VerifyOptions,
} from "../src/index.ts";
import { loadVectors } from "../src/vectors.ts";

const SESSION = "6650A3B2C1D0E9F8A7B6C5D4";
const PLATFORM = "https://api.example.org";
const BASE = `${PLATFORM}/v2/voting/sessions/6650a3b2c1d0e9f8a7b6c5d4/anchor`;
const REGISTRY = "0x00000000000000000000000000000000000a4c40";
const dataset = loadVectors().find(
  (vector) => vector.path === "v1/quadratic/basic.json",
)!.dataset as Record<string, unknown>;
const commitment = computeCommitment(dataset);

const metadata: AnchorMetadata = {
  sessionId: "6650a3b2c1d0e9f8a7b6c5d4",
  votingMethod: "QUADRATIC",
  anchorStatus: "ANCHORED",
  schemaVersion: 1,
  merkleRoot: commitment.merkleRoot,
  tallyHash: commitment.tallyHash,
  anchorTxHash: `0x${"ab".repeat(32)}`,
  anchorContract: REGISTRY,
  chainId: 84532,
  result: {
    winner: "C",
    turnout: 3,
    options: [
      { id: "A", votes: 3 },
      { id: "B", votes: 2 },
      { id: "C", votes: 5 },
    ],
  },
};

const anchored: OnChainAnchor = {
  merkleRoot: commitment.merkleRoot,
  tallyHash: commitment.tallyHash,
  timestamp: 1_760_000_000n,
  blockNumber: 123n,
};

function fakeFetch(routes: Record<string, unknown>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (!(url in routes)) return new Response("not found", { status: 404 });
    const body = routes[url];
    return new Response(
      typeof body === "string" ? body : JSON.stringify(body),
      { status: 200 },
    );
  }) as typeof fetch;
}

function verify(
  overrides: Partial<VerifyOptions> & {
    routes?: Record<string, unknown>;
    onChain?: OnChainAnchor;
  } = {},
) {
  const {
    routes = { [BASE]: metadata, [`${BASE}/dataset`]: dataset },
    onChain = anchored,
    ...options
  } = overrides;
  return verifySession({
    session: SESSION,
    network: "base-sepolia",
    platform: PLATFORM,
    fetch: fakeFetch(routes),
    readAnchor: async () => onChain,
    ...options,
  });
}

describe("verifySession", () => {
  test("PASS when root, tally and result summary all agree", async () => {
    const report = await verify();
    assert.equal(report.outcome, "PASS");
    assert.deepEqual(
      report.checks.map((check) => [check.name, check.ok]),
      [
        ["merkleRoot", true],
        ["tallyHash", true],
        ["resultSummary", true],
      ],
    );
    assert.equal(report.contract, "0x00000000000000000000000000000000000a4C40");
    assert.match(formatReport(report), new RegExp(GUARANTEE.slice(0, 40)));
  });

  test("reads the session's registry from metadata and passes the hashed session id", async () => {
    let seen: unknown;
    await verifySession({
      session: SESSION,
      network: "base-sepolia",
      platform: PLATFORM,
      fetch: fakeFetch({ [BASE]: metadata, [`${BASE}/dataset`]: dataset }),
      readAnchor: async (options) => ((seen = options), anchored),
    });
    assert.deepEqual(seen, {
      network: "base-sepolia",
      contract: "0x00000000000000000000000000000000000a4C40",
      sessionId:
        "0x1bbafa044774e78628e49e5b859e2ff69b10d80250f60deb09d6ed27570e013f",
      rpcUrl: undefined,
    });
  });

  test("FAIL with a per-option delta when the dataset was tampered with", async () => {
    const ballots = structuredClone(dataset.ballots) as {
      allocations: Record<string, number>;
    }[];
    ballots[1]!.allocations = { A: 3 };
    const report = await verify({
      routes: {
        [BASE]: metadata,
        [`${BASE}/dataset`]: { ...dataset, ballots },
      },
    });
    assert.equal(report.outcome, "FAIL");
    assert.equal(
      report.reason,
      "mismatch in merkleRoot, tallyHash, resultSummary",
    );
    assert.deepEqual(report.resultDiff, {
      options: [
        { id: "A", published: 3, recomputed: 6 },
        { id: "C", published: 5, recomputed: 2 },
      ],
      winner: { published: "C", recomputed: "A" },
    });
    const text = formatReport(report);
    assert.match(text, /A: published 3, recomputed 6 \(published 3 fewer\)/);
    assert.doesNotMatch(text, /PASS means/);
  });

  test("FAIL when the published summary disagrees even though the hashes match", async () => {
    const lying = {
      ...metadata,
      result: { ...metadata.result, winner: "A", turnout: 4 },
    };
    const report = await verify({
      routes: { [BASE]: lying, [`${BASE}/dataset`]: dataset },
    });
    assert.equal(report.outcome, "FAIL");
    assert.deepEqual(report.resultDiff, {
      options: [],
      winner: { published: "A", recomputed: "C" },
      turnout: { published: 4, recomputed: 3 },
    });
    assert.match(
      formatReport(report),
      /turnout: published 4, recomputed 3 \(published 1 more\)/,
    );
  });

  test("RANKED_CHOICE summary lists only the final round's options", async () => {
    const rcvDataset = loadVectors().find(
      (vector) => vector.path === "v1/ranked-choice/elimination.json",
    )!.dataset;
    const rcv = computeCommitment(rcvDataset);
    const rcvMetadata = {
      ...metadata,
      votingMethod: "RANKED_CHOICE",
      result: {
        winner: "D",
        turnout: 8,
        options: [
          { id: "D", votes: 5 },
          { id: "A", votes: 3 },
        ],
      },
    } satisfies AnchorMetadata;
    const run = (result: AnchorMetadata["result"]) =>
      verify({
        routes: {
          [BASE]: { ...rcvMetadata, result },
          [`${BASE}/dataset`]: rcvDataset,
        },
        onChain: {
          ...anchored,
          merkleRoot: rcv.merkleRoot,
          tallyHash: rcv.tallyHash,
        },
      });

    assert.equal((await run(rcvMetadata.result)).outcome, "PASS");

    // Eliminated options (B, C) must not be listed, not even with 0 votes.
    const withEliminated = await run({
      ...rcvMetadata.result,
      options: [
        ...rcvMetadata.result.options,
        { id: "B", votes: 0 },
        { id: "C", votes: 0 },
      ],
    });
    assert.equal(withEliminated.outcome, "FAIL");
    assert.deepEqual(withEliminated.resultDiff, {
      options: [
        { id: "B", published: 0, recomputed: null },
        { id: "C", published: 0, recomputed: null },
      ],
    });
  });

  test("FAIL when a ballot exceeds the QV budget", async () => {
    const report = await verify({
      routes: {
        [BASE]: metadata,
        [`${BASE}/dataset`]: { ...dataset, voiceCredits: 5 },
      },
    });
    assert.equal(report.outcome, "FAIL");
    assert.match(report.reason!, /^BUDGET_EXCEEDED/);
  });

  test("NOT_ANCHORED when the registry has no commitment", async () => {
    const report = await verify({
      onChain: {
        merkleRoot: `0x${"0".repeat(64)}`,
        tallyHash: `0x${"0".repeat(64)}`,
        timestamp: 0n,
        blockNumber: 0n,
      },
    });
    assert.equal(report.outcome, "NOT_ANCHORED");
  });

  test("NOT_ANCHORED when the platform has no anchor record or no registry yet", async () => {
    assert.equal((await verify({ routes: {} })).outcome, "NOT_ANCHORED");
    const computed = {
      ...metadata,
      anchorStatus: "COMPUTED",
      anchorContract: null,
      chainId: null,
    };
    const report = await verify({ routes: { [BASE]: computed } });
    assert.equal(report.outcome, "NOT_ANCHORED");
    assert.match(report.reason!, /COMPUTED/);
  });

  test("UNSUPPORTED for an unknown schemaVersion, distinct from FAIL", async () => {
    const report = await verify({
      routes: {
        [BASE]: metadata,
        [`${BASE}/dataset`]: { ...dataset, schemaVersion: 2 },
      },
    });
    assert.equal(report.outcome, "UNSUPPORTED");
  });

  test("--contract and --dataset-url work without the metadata endpoint", async () => {
    const archive = "https://archive.example.org/ballots.json";
    const report = await verify({
      platform: undefined,
      contract: REGISTRY,
      datasetUrl: archive,
      routes: { [archive]: dataset },
    });
    assert.equal(report.outcome, "PASS");
    assert.equal(report.datasetUrl, archive);
    assert.deepEqual(
      report.checks.map((check) => check.name),
      ["merkleRoot", "tallyHash"],
    );
  });

  test("--contract tolerates a missing metadata endpoint", async () => {
    const report = await verify({
      contract: REGISTRY,
      routes: { [`${BASE}/dataset`]: dataset },
    });
    assert.equal(report.outcome, "PASS");
    assert.match(report.warnings[0]!, /metadata unavailable/);
  });

  test("errors (not verdicts) for unusable input", async () => {
    await assert.rejects(verify({ platform: undefined }), VerifyError);
    await assert.rejects(verify({ session: "nope" }), VerifyError);
    await assert.rejects(
      verify({ network: "base" }),
      /anchored on chain 84532/,
    );
    await assert.rejects(
      verify({ routes: { [BASE]: metadata } }),
      /could not fetch dataset/,
    );
  });

  test("a dataset that is not JSON fails verification", async () => {
    const report = await verify({
      routes: { [BASE]: metadata, [`${BASE}/dataset`]: "<html>" },
    });
    assert.equal(report.outcome, "FAIL");
  });
});
