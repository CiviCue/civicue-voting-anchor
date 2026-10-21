// The producer side without a chain: conformance vectors (what the platform's CI must pass),
// the anchor-status lifecycle, the API's status rules, and a randomized cross-check of the
// mock's commitments against the verifier's independent recomputation.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { computeCommitment } from "@civicue/voting-anchor-verifier";
import { loadVectors } from "@civicue/voting-anchor-verifier/vectors";
import { apiHandler } from "../src/api.ts";
import {
  EncodeError,
  encodeCommitment,
  type Dataset,
  type DatasetRow,
  type VotingMethod,
} from "../src/encoder.ts";
import {
  BallotRejected,
  castBallot,
  closeSession,
  computeRcvResult,
  createSession,
  Store,
  type BallotPayload,
} from "../src/platform.ts";
import {
  buildDataset,
  computePending,
  recordedTally,
} from "../src/producer.ts";
import { sessionIdFor, SCENARIOS, seedScenario } from "../src/scenarios.ts";

/** Replays a dataset through the platform (cast → close → RCV) and encodes what it recorded. */
function replay(dataset: Dataset, bindVersion?: number) {
  const store = new Store();
  const id = sessionIdFor("replay");
  createSession(store, {
    id,
    votingSystem: dataset.votingMethod,
    options: dataset.options,
    ...(dataset.voiceCredits !== undefined && { budget: dataset.voiceCredits }),
  });
  for (const row of dataset.ballots) {
    const { voter, ...payload } = row;
    castBallot(
      store,
      id,
      sessionIdFor(`replay#${voter}`),
      payload as BallotPayload,
    );
  }
  closeSession(store, id);
  if (dataset.votingMethod === "RANKED_CHOICE") computeRcvResult(store, id);
  const session = store.session(id);
  return encodeCommitment(
    dataset,
    recordedTally(session, dataset.schemaVersion),
    bindVersion,
  );
}

describe("conformance vectors through the mock producer", () => {
  for (const vector of loadVectors()) {
    test(vector.path, () => {
      let outcome:
        { merkleRoot: string; tallyHash: string } | { error: string };
      try {
        const { merkleRoot, tallyHash } = replay(
          vector.dataset as Dataset,
          vector.bindVersion,
        );
        outcome = { merkleRoot, tallyHash };
      } catch (error) {
        if (error instanceof BallotRejected)
          outcome = {
            error:
              error.code === "INVALID_BALLOT" ? "INVALID_DATASET" : error.code,
          };
        else if (error instanceof EncodeError) outcome = { error: error.code };
        else throw error;
      }
      assert.deepEqual(outcome, vector.expected);
    });
  }
});

describe("anchor status lifecycle", () => {
  test("MAJORITY and QUADRATIC become PENDING at close; RANKED_CHOICE waits for its result", () => {
    const store = new Store();
    const majority = seedScenario(
      store,
      SCENARIOS.find((s) => s.name === "majority-basic")!,
    );
    assert.equal(store.session(majority).anchorStatus, "PENDING");

    const id = sessionIdFor("rcv-waits");
    createSession(store, {
      id,
      votingSystem: "RANKED_CHOICE",
      options: ["A", "B"],
    });
    castBallot(store, id, sessionIdFor("rcv-waits#0"), {
      rankedOptions: ["A"],
    });
    closeSession(store, id);
    assert.equal(store.session(id).anchorStatus, "NONE");
    computeRcvResult(store, id);
    assert.equal(store.session(id).anchorStatus, "PENDING");
  });

  test("a void session (turnout 0) is never anchored", () => {
    const store = new Store();
    const id = seedScenario(
      store,
      SCENARIOS.find((s) => s.name === "void-no-ballots")!,
    );
    computePending(store);
    assert.equal(store.session(id).anchorStatus, "NONE");
  });

  test("computing is idempotent: a COMPUTED session keeps its commitment", () => {
    const store = new Store();
    const id = seedScenario(
      store,
      SCENARIOS.find((s) => s.name === "quadratic-basic")!,
    );
    computePending(store);
    const { merkleRoot, tallyHash } = store.session(id);
    store.session(id).options[0]!.votes += 1; // even if state drifted, re-running must not re-commit
    assert.deepEqual(computePending(store), []);
    assert.deepEqual(
      [store.session(id).merkleRoot, store.session(id).tallyHash],
      [merkleRoot, tallyHash],
    );
  });

  test("regeneration is deterministic, independent of cast order, and carries no ballot ids", () => {
    const scenario = SCENARIOS.find((s) => s.name === "ranked-elimination")!;
    const build = (order: number[]) => {
      const store = new Store();
      const id = sessionIdFor(scenario.name);
      createSession(store, {
        id,
        votingSystem: scenario.method,
        options: scenario.options,
      });
      for (const i of order)
        castBallot(
          store,
          id,
          sessionIdFor(`${scenario.name}#${i}`),
          scenario.ballots[i]!,
        );
      closeSession(store, id);
      computeRcvResult(store, id);
      return { store, id };
    };
    const forward = build(scenario.ballots.map((_, i) => i));
    const backward = build(scenario.ballots.map((_, i) => i).reverse());
    const a = JSON.stringify(
      buildDataset(forward.store, forward.store.session(forward.id)),
    );
    assert.equal(
      a,
      JSON.stringify(
        buildDataset(forward.store, forward.store.session(forward.id)),
      ),
    );
    assert.equal(
      a,
      JSON.stringify(
        buildDataset(backward.store, backward.store.session(backward.id)),
      ),
    );
    for (const ballot of forward.store.ballots)
      assert.ok(!a.includes(ballot.ballotId));
  });

  test("the backward tie-break scenario really breaks the tie on an earlier round", () => {
    const store = new Store();
    const id = seedScenario(
      store,
      SCENARIOS.find((s) => s.name === "ranked-backward-tie-break")!,
    );
    const rounds = store.session(id).rcvRounds!;
    assert.deepEqual(rounds[1]!.totals, { A: 4, B: 3, C: 3 });
    assert.equal(rounds[1]!.eliminated, "C");
  });
});

describe("verification API status rules", () => {
  const request = async (store: Store, url: string) => {
    const handler = apiHandler(store);
    return new Promise<{ status: number; body: unknown }>((resolve) => {
      const res = {
        writeHead: (status: number) => ({
          end: (body: string) => resolve({ status, body: JSON.parse(body) }),
        }),
      };
      handler({ method: "GET", url } as never, res as never);
    });
  };

  test("metadata is 404 without an anchor record; the dataset only once computed", async () => {
    const store = new Store();
    const id = seedScenario(
      store,
      SCENARIOS.find((s) => s.name === "majority-basic")!,
    );
    const voidId = seedScenario(
      store,
      SCENARIOS.find((s) => s.name === "void-no-ballots")!,
    );
    const base = `/v2/voting/sessions/${id}/anchor`;
    assert.equal(
      (await request(store, `/v2/voting/sessions/${voidId}/anchor`)).status,
      404,
    );
    assert.equal((await request(store, base)).status, 200); // PENDING has a record
    assert.equal((await request(store, `${base}/dataset`)).status, 404);
    computePending(store);
    const dataset = await request(store, `${base}/dataset`);
    assert.equal(dataset.status, 200);
    assert.equal(
      computeCommitment(dataset.body).merkleRoot,
      store.session(id).merkleRoot,
    );
  });

  test("a RANKED_CHOICE summary lists only the final round's options", async () => {
    const store = new Store();
    const id = seedScenario(
      store,
      SCENARIOS.find((s) => s.name === "ranked-elimination")!,
    );
    const { body } = await request(store, `/v2/voting/sessions/${id}/anchor`);
    assert.deepEqual((body as { result: unknown }).result, {
      winner: "D",
      turnout: 8,
      options: [
        { id: "A", votes: 3 },
        { id: "D", votes: 5 },
      ],
    });
  });
});

describe("randomized cross-check against the verifier", () => {
  // A small deterministic PRNG (mulberry32), so a failure is reproducible from its seed.
  const prng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const OPTIONS = ["A", "B", "C", "D", "E", "選項", "z"];

  const randomBallot = (
    method: VotingMethod,
    options: string[],
    budget: number,
    rand: () => number,
  ): BallotPayload => {
    const shuffled = [...options].sort(() => rand() - 0.5);
    const some = shuffled.slice(0, Math.floor(rand() * (options.length + 1)));
    if (method === "MAJORITY") return { optionIds: some };
    if (method === "RANKED_CHOICE") return { rankedOptions: some };
    const allocations: Record<string, number> = {};
    let left = budget;
    for (const id of some) {
      const votes = Math.floor(rand() * (Math.floor(Math.sqrt(left)) + 1));
      allocations[id] = votes;
      left -= votes * votes;
    }
    return { allocations };
  };

  for (const method of ["MAJORITY", "QUADRATIC", "RANKED_CHOICE"] as const) {
    test(`${method}: 300 random sessions match`, () => {
      for (let seed = 1; seed <= 300; seed++) {
        const rand = prng(seed * 7919);
        const options = OPTIONS.slice(
          0,
          2 + Math.floor(rand() * (OPTIONS.length - 1)),
        );
        const budget = 1 + Math.floor(rand() * 30);
        const store = new Store();
        const id = sessionIdFor(`${method}-${seed}`);
        createSession(store, {
          id,
          votingSystem: method,
          options,
          ...(method === "QUADRATIC" && { budget }),
        });
        const turnout = 1 + Math.floor(rand() * 25);
        for (let i = 0; i < turnout; i++)
          castBallot(
            store,
            id,
            sessionIdFor(`${id}#${i}`),
            randomBallot(method, options, budget, rand),
          );
        closeSession(store, id);
        if (method === "RANKED_CHOICE") computeRcvResult(store, id);
        computePending(store);
        const session = store.session(id);
        const dataset = buildDataset(store, session);
        const verifier = computeCommitment(dataset);
        assert.deepEqual(
          { merkleRoot: verifier.merkleRoot, tallyHash: verifier.tallyHash },
          { merkleRoot: session.merkleRoot, tallyHash: session.tallyHash },
          `seed ${seed}: ${JSON.stringify(dataset.ballots as DatasetRow[])}`,
        );
      }
    });
  }
});
