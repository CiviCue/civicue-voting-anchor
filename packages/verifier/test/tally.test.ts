import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  computeCommitment,
  DatasetError,
  finalTotals,
  UnsupportedSchemaVersionError,
} from "../src/index.ts";

const majority = (ballots: unknown[], options = ["A", "B", "C"]) => ({
  schemaVersion: 1,
  votingMethod: "MAJORITY",
  options,
  ballots,
});
const quadratic = (voiceCredits: unknown, ballots: unknown[]) => ({
  schemaVersion: 1,
  votingMethod: "QUADRATIC",
  voiceCredits,
  options: ["A", "B"],
  ballots,
});
const ranked = (rankings: string[][], options = ["A", "B", "C"]) => ({
  schemaVersion: 1,
  votingMethod: "RANKED_CHOICE",
  options,
  ballots: rankings.map((rankedOptions, i) => ({
    voter: i + 1,
    rankedOptions,
  })),
});

function datasetError(input: unknown, code: DatasetError["code"]): void {
  assert.throws(
    () => computeCommitment(input),
    (error: unknown) => error instanceof DatasetError && error.code === code,
  );
}

describe("MAJORITY", () => {
  test("counts every selection and reports zero-vote options", () => {
    const { tally } = computeCommitment(
      majority([
        { voter: 1, optionIds: ["A", "B"] },
        { voter: 2, optionIds: ["A"] },
      ]),
    );
    assert.deepEqual(tally.votingMethod === "MAJORITY" && tally.totals, {
      A: 2,
      B: 1,
      C: 0,
    });
    assert.deepEqual(tally.winners, ["A"]);
  });

  test("a tie yields every top option; all-blank yields no winner", () => {
    const tie = computeCommitment(
      majority([
        { voter: 1, optionIds: ["B"] },
        { voter: 2, optionIds: ["A"] },
      ]),
    );
    assert.deepEqual(tie.tally.winners, ["A", "B"]);
    const blank = computeCommitment(majority([{ voter: 1, optionIds: [] }]));
    assert.deepEqual(blank.tally.winners, []);
  });
});

describe("QUADRATIC", () => {
  test("zero allocations are dropped, so they do not change the commitment", () => {
    const withZero = computeCommitment(
      quadratic(4, [{ voter: 1, allocations: { A: 2, B: 0 } }]),
    );
    const without = computeCommitment(
      quadratic(4, [{ voter: 1, allocations: { A: 2 } }]),
    );
    assert.equal(withZero.merkleRoot, without.merkleRoot);
    assert.equal(withZero.tallyHash, without.tallyHash);
  });

  test("a ballot spending exactly voiceCredits is valid", () => {
    assert.deepEqual(
      finalTotals(
        computeCommitment(
          quadratic(8, [{ voter: 1, allocations: { A: 2, B: 2 } }]),
        ),
      ),
      { A: 2, B: 2 },
    );
  });

  test("a ballot over budget fails and names the voter", () => {
    const input = quadratic(8, [
      { voter: 1, allocations: { A: 2 } },
      { voter: 2, allocations: { A: 2, B: 3 } },
    ]);
    assert.throws(
      () => computeCommitment(input),
      (error: unknown) => {
        return (
          error instanceof DatasetError &&
          error.code === "BUDGET_EXCEEDED" &&
          /voter 2/.test(error.message)
        );
      },
    );
  });

  test("voiceCredits is bound into tallyHash", () => {
    const ballots = [{ voter: 1, allocations: { A: 1 } }];
    assert.notEqual(
      computeCommitment(quadratic(4, ballots)).tallyHash,
      computeCommitment(quadratic(9, ballots)).tallyHash,
    );
  });

  test("rejects a missing budget and negative or fractional votes", () => {
    datasetError(
      quadratic(undefined, [{ voter: 1, allocations: { A: 1 } }]),
      "INVALID_DATASET",
    );
    datasetError(
      quadratic(4, [{ voter: 1, allocations: { A: -1 } }]),
      "INVALID_DATASET",
    );
    datasetError(
      quadratic(4, [{ voter: 1, allocations: { A: 1.5 } }]),
      "INVALID_DATASET",
    );
  });
});

describe("RANKED_CHOICE", () => {
  test("transfers ballots from eliminated options", () => {
    const { tally } = computeCommitment(
      ranked([["A"], ["A"], ["B"], ["B"], ["C", "B"]]),
    );
    assert.ok(tally.votingMethod === "RANKED_CHOICE");
    assert.deepEqual(
      tally.rounds.map((round) => round.eliminated),
      ["C", null],
    );
    assert.deepEqual(tally.rounds.at(-1)!.totals, { A: 2, B: 3 });
    assert.deepEqual(tally.winners, ["B"]);
  });

  test("partial rankings exhaust and lower the majority threshold", () => {
    const { tally } = computeCommitment(
      ranked([["A"], ["A"], ["B"], ["B"], ["B"], ["C"]]),
    );
    assert.ok(tally.votingMethod === "RANKED_CHOICE");
    assert.deepEqual(tally.rounds.at(-1), {
      totals: { A: 2, B: 3 },
      exhausted: 1,
      eliminated: null,
    });
    assert.deepEqual(tally.winners, ["B"]);
  });

  test("empty rankings are exhausted from the first round", () => {
    const { tally } = computeCommitment(ranked([[], ["A"]]));
    assert.ok(tally.votingMethod === "RANKED_CHOICE");
    assert.equal(tally.rounds[0]!.exhausted, 1);
    assert.deepEqual(tally.winners, ["A"]);
  });

  test("a level race ends in a tie rather than an arbitrary elimination", () => {
    assert.deepEqual(
      computeCommitment(ranked([["A"], ["B"], ["C"]])).tally.winners,
      ["A", "B", "C"],
    );
  });

  test("ranking order matters to the leaf", () => {
    const ab = computeCommitment(ranked([["A", "B"]]));
    const ba = computeCommitment(ranked([["B", "A"]]));
    assert.notEqual(ab.merkleRoot, ba.merkleRoot);
  });
});

describe("dataset validation", () => {
  test("rejects malformed datasets", () => {
    datasetError(null, "INVALID_DATASET");
    datasetError(
      { votingMethod: "MAJORITY", options: ["A"], ballots: [] },
      "INVALID_DATASET",
    );
    datasetError(majority([]), "INVALID_DATASET");
    datasetError(
      {
        ...majority([{ voter: 1, optionIds: ["A"] }]),
        votingMethod: "APPROVAL",
      },
      "INVALID_DATASET",
    );
    datasetError(
      majority([{ voter: 1, optionIds: ["A"] }], ["A", "A"]),
      "INVALID_DATASET",
    );
    datasetError(
      majority([{ voter: 1, optionIds: ["A", "A"] }]),
      "INVALID_DATASET",
    );
    datasetError(
      majority([
        { voter: 1, optionIds: ["A"] },
        { voter: 1, optionIds: ["B"] },
      ]),
      "INVALID_DATASET",
    );
    datasetError(majority([{ voter: 0, optionIds: ["A"] }]), "INVALID_DATASET");
  });

  test("reports unknown versions as unsupported, not invalid", () => {
    for (const schemaVersion of [0, 2, "1"]) {
      assert.throws(
        () =>
          computeCommitment({
            ...majority([{ voter: 1, optionIds: ["A"] }]),
            schemaVersion,
          }),
        UnsupportedSchemaVersionError,
      );
    }
  });

  test("an option id named __proto__ is an ordinary key", () => {
    const input = {
      ...quadratic(4, [
        { voter: 1, allocations: JSON.parse('{"__proto__": 2}') },
      ]),
      options: ["__proto__", "B"],
    };
    assert.deepEqual(
      finalTotals(computeCommitment(input)),
      JSON.parse('{"B": 0, "__proto__": 2}'),
    );
  });
});
