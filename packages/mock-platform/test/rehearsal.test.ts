// Rehearses tasks 5.1 and 5.2 of v2-voting-anchor-verifier-cli on a local chain: every scenario
// goes through the mock platform's close → producer → worker pipeline, and the verifier CLI
// (as a subprocess) must PASS each one and FAIL each kind of tampering with a meaningful report.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import type { Server } from "node:http";
import { dirname, join } from "node:path";
import { after, before, describe, test } from "node:test";
import { serveApi, anchorMetadata } from "../src/api.ts";
import { canonicalDataset, type Dataset } from "../src/encoder.ts";
import {
  localChainUnavailable,
  startLocalChain,
  type LocalChain,
} from "../src/chain.ts";
import {
  castBallot,
  closeSession,
  createSession,
  Store,
} from "../src/platform.ts";
import { buildDataset, computePending } from "../src/producer.ts";
import { sessionIdFor, SCENARIOS, seedScenario } from "../src/scenarios.ts";
import { runAnchorBatch } from "../src/worker.ts";

// The built CLI, the same file `npx @civicue/voting-anchor-verifier` runs.
const CLI = join(
  dirname(
    createRequire(import.meta.url).resolve("@civicue/voting-anchor-verifier"),
  ),
  "cli.js",
);
const skip = localChainUnavailable() ?? false;
const idOf = (name: string) => sessionIdFor(name);

interface Run {
  code: number;
  stdout: string;
  stderr: string;
  /** Check name → passed, from the `✓`/`✗` lines. */
  checks: Record<string, boolean>;
}

describe("rehearsal on a local chain", { skip }, () => {
  let chain: LocalChain;
  let server: Server;
  let platform: string;
  const store = new Store();
  const overrides = new Map<string, unknown>();
  const BUGGY = idOf("platform-bug-double-count");

  before(async () => {
    chain = await startLocalChain(19545 + Math.floor(Math.random() * 1000));
    for (const scenario of SCENARIOS) seedScenario(store, scenario);
    // A platform bug: the live counter for A was incremented twice for one ballot. The ballots
    // are right, but the recorded (and anchored) tally does not follow from them.
    createSession(store, {
      id: BUGGY,
      votingSystem: "MAJORITY",
      options: ["A", "B"],
    });
    ["A", "B", "B"].forEach((option, i) =>
      castBallot(store, BUGGY, idOf(`bug#${i}`), { optionIds: [option] }),
    );
    store.session(BUGGY).options[0]!.votes += 1;
    closeSession(store, BUGGY);
    computePending(store);
    ({ server, url: platform } = await serveApi(store, 0, overrides));
  });

  after(() => {
    server?.close();
    chain?.stop();
  });

  const verify = (session: string, ...extra: string[]) =>
    new Promise<Run>((resolve) => {
      execFile(
        process.execPath,
        [
          CLI,
          "verify",
          "--session",
          session,
          "--network",
          "base-sepolia",
          "--rpc-url",
          chain.rpcUrl,
          "--platform",
          platform,
          ...extra,
        ],
        (error, stdout, stderr) => {
          const checks = Object.fromEntries(
            [...stdout.matchAll(/^ {2}([✓✗]) (\w+)$/gm)].map((m) => [
              m[2]!,
              m[1] === "✓",
            ]),
          );
          resolve({
            code: error ? Number(error.code) : 0,
            stdout,
            stderr,
            checks,
          });
        },
      );
    });

  /** Serves a modified copy of a session's dataset and verifies the session against it. */
  const verifyCopy = (name: string, edit: (dataset: Dataset) => void) => {
    const id = idOf(name);
    const copy = structuredClone(
      canonicalDataset(buildDataset(store, store.session(id))),
    );
    edit(copy);
    const path = `/archive/${id}-${overrides.size}.json`;
    overrides.set(path, copy);
    return verify(id, "--dataset-url", `${platform}${path}`);
  };

  /** Serves a modified result summary for a session and verifies it. */
  const verifySummary = (
    name: string,
    edit: (result: ReturnType<typeof anchorMetadata>["result"]) => void,
  ) => {
    const id = idOf(name);
    const metadata = structuredClone(anchorMetadata(store.session(id)));
    edit(metadata.result);
    overrides.set(`/v2/voting/sessions/${id}/anchor`, metadata);
    return verify(id).finally(() =>
      overrides.delete(`/v2/voting/sessions/${id}/anchor`),
    );
  };

  describe("worker", () => {
    test("a batch with an unreachable registry marks sessions FAILED", async () => {
      const broken = {
        ...chain,
        registry: "0x000000000000000000000000000000000000dEaD" as const,
      };
      const result = await runAnchorBatch(store, broken);
      assert.equal(result.anchored.length, 0);
      assert.ok(result.failed.length > 0);
      assert.equal(
        store.session(idOf("majority-basic")).anchorStatus,
        "FAILED",
      );
    });

    test("the next batch anchors every COMPUTED or FAILED session, and no void session", async () => {
      const result = await runAnchorBatch(store, chain);
      assert.deepEqual(result.failed, []);
      const nonVoid = SCENARIOS.filter((s) => s.ballots.length > 0).length;
      assert.equal(result.anchored.length, nonVoid + 1); // + the buggy session
      for (const session of store.sessions.values()) {
        const expected =
          session.id === idOf("void-no-ballots") ? "NONE" : "ANCHORED";
        assert.equal(session.anchorStatus, expected, session.id);
      }
    });

    test("re-running is idempotent: an already anchored session is reconciled, not resubmitted", async () => {
      const session = store.session(idOf("quadratic-basic"));
      const txHash = session.anchorTxHash;
      Object.assign(session, {
        anchorStatus: "FAILED",
        anchorTxHash: undefined,
      });
      const result = await runAnchorBatch(store, chain);
      assert.deepEqual(result, {
        anchored: [],
        reconciled: [session.id],
        failed: [],
      });
      assert.equal(session.anchorTxHash, txHash);
      assert.equal(session.anchorStatus, "ANCHORED");
    });
  });

  describe("5.1: every method verifies against the mock platform", () => {
    for (const scenario of SCENARIOS.filter((s) => s.ballots.length > 0)) {
      test(`PASS ${scenario.name}`, async () => {
        const run = await verify(idOf(scenario.name));
        assert.equal(run.code, 0, run.stdout + run.stderr);
        assert.deepEqual(run.checks, {
          merkleRoot: true,
          tallyHash: true,
          resultSummary: true,
        });
      });
    }

    test("a void session is NOT_ANCHORED", async () => {
      const run = await verify(idOf("void-no-ballots"));
      assert.equal(run.code, 2, run.stdout);
      assert.match(
        run.stdout,
        /^NOT_ANCHORED: the platform has no anchor record/,
      );
    });
  });

  describe("5.2: tampering is reported as FAIL with a meaningful diff", () => {
    for (const [name, field] of [
      ["majority-basic", "optionIds"],
      ["quadratic-basic", "allocations"],
      ["ranked-elimination", "rankedOptions"],
    ] as const) {
      test(`${name}: changing one ballot`, async () => {
        const run = await verifyCopy(name, (dataset) => {
          const row = dataset.ballots.find((r) =>
            JSON.stringify(r).includes('"A"'),
          ) as Record<string, unknown>;
          row[field] = field === "allocations" ? { B: 1 } : ["B"];
        });
        assert.equal(run.code, 1, run.stdout);
        assert.deepEqual(run.checks, {
          merkleRoot: false,
          tallyHash: false,
          resultSummary: false,
        });
        assert.match(
          run.stdout,
          /^ {2}\S+: published \d+, recomputed \d+ \(published \d+ (more|fewer)\)$/m,
        );
      });

      test(`${name}: swapping two voters' ballots changes only merkleRoot`, async () => {
        const run = await verifyCopy(name, (dataset) => {
          const content = (row: object) => JSON.stringify({ ...row, voter: 0 });
          const a = dataset.ballots[0]!;
          const b = dataset.ballots.find((row) => content(row) !== content(a))!;
          [a.voter, b.voter] = [b.voter, a.voter];
        });
        assert.equal(run.code, 1, run.stdout);
        assert.deepEqual(run.checks, {
          merkleRoot: false,
          tallyHash: true,
          resultSummary: true,
        });
      });

      test(`${name}: dropping a ballot`, async () => {
        const run = await verifyCopy(
          name,
          (dataset) => void dataset.ballots.pop(),
        );
        assert.equal(run.code, 1, run.stdout);
        assert.equal(run.checks.merkleRoot, false);
        assert.equal(run.checks.tallyHash, false);
        assert.match(
          run.stdout,
          /turnout: published \d+, recomputed \d+ \(published 1 more\)/,
        );
      });

      test(`${name}: adding a ballot`, async () => {
        const run = await verifyCopy(name, (dataset) => {
          dataset.ballots.push({
            ...structuredClone(dataset.ballots[0]!),
            voter: dataset.ballots.length + 1,
          });
        });
        assert.equal(run.code, 1, run.stdout);
        assert.match(
          run.stdout,
          /turnout: published \d+, recomputed \d+ \(published 1 fewer\)/,
        );
      });
    }

    test("raising the quadratic budget changes only tallyHash", async () => {
      const run = await verifyCopy(
        "quadratic-basic",
        (dataset) => void (dataset.voiceCredits = 100),
      );
      assert.equal(run.code, 1, run.stdout);
      assert.deepEqual(run.checks, {
        merkleRoot: true,
        tallyHash: false,
        resultSummary: true,
      });
    });

    test("a quadratic ballot over budget is BUDGET_EXCEEDED", async () => {
      const run = await verifyCopy("quadratic-basic", (dataset) => {
        dataset.ballots[0] = {
          voter: dataset.ballots[0]!.voter,
          allocations: { A: 4 },
        };
      });
      assert.equal(run.code, 1, run.stdout);
      assert.match(run.stdout, /^FAIL: BUDGET_EXCEEDED/);
    });

    test("an unknown option is INVALID_DATASET", async () => {
      const run = await verifyCopy("majority-basic", (dataset) => {
        dataset.ballots[0] = {
          voter: dataset.ballots[0]!.voter,
          optionIds: ["Z"],
        };
      });
      assert.equal(run.code, 1, run.stdout);
      assert.match(run.stdout, /^FAIL: INVALID_DATASET/);
    });

    test("relabelling the schema version is not accepted (UNSUPPORTED)", async () => {
      const run = await verifyCopy(
        "majority-basic",
        (dataset) => void (dataset.schemaVersion = 2),
      );
      assert.equal(run.code, 3, run.stdout);
    });

    test("a published summary that differs from the anchored tally fails resultSummary only", async () => {
      const run = await verifySummary("majority-basic", (result) => {
        result.winner = "B";
        result.options.find((o) => o.id === "B")!.votes = 4;
      });
      assert.equal(run.code, 1, run.stdout);
      assert.deepEqual(run.checks, {
        merkleRoot: true,
        tallyHash: true,
        resultSummary: false,
      });
      assert.match(
        run.stdout,
        /B: published 4, recomputed 1 \(published 3 more\)/,
      );
      assert.match(run.stdout, /winner: published B, recomputed A/);
    });

    test("a ranked-choice summary listing eliminated options fails resultSummary", async () => {
      const run = await verifySummary("ranked-elimination", (result) => {
        result.options.push({ id: "B", votes: 0 }, { id: "C", votes: 0 });
      });
      assert.equal(run.code, 1, run.stdout);
      assert.deepEqual(run.checks, {
        merkleRoot: true,
        tallyHash: true,
        resultSummary: false,
      });
      assert.match(run.stdout, /B: published 0, recomputed —/);
    });

    test("an anchored tally that does not follow from the ballots fails tallyHash", async () => {
      const run = await verify(BUGGY);
      assert.equal(run.code, 1, run.stdout);
      assert.deepEqual(run.checks, {
        merkleRoot: true,
        tallyHash: false,
        resultSummary: false,
      });
      assert.match(
        run.stdout,
        /A: published 2, recomputed 1 \(published 1 more\)/,
      );
    });
  });
});
