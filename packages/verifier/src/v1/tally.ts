import { DatasetError } from "../errors.ts";
import type {
  DatasetV1,
  MajorityBallot,
  QuadraticBallot,
  RankedChoiceBallot,
} from "./dataset.ts";

type Totals = Readonly<Record<string, number>>;

export interface MajorityTally {
  readonly schemaVersion: number;
  readonly votingMethod: "MAJORITY";
  readonly ballotCount: number;
  /** Selections per option id, including options with zero. */
  readonly totals: Totals;
  /** Option ids with the highest total, sorted; empty when every total is zero. */
  readonly winners: readonly string[];
}

export interface QuadraticTally {
  readonly schemaVersion: number;
  readonly votingMethod: "QUADRATIC";
  readonly ballotCount: number;
  readonly voiceCredits: number;
  /** Summed allocations per option id, including options with zero. */
  readonly totals: Totals;
  readonly winners: readonly string[];
}

export interface RankedChoiceRound {
  /** First-preference counts of the options still in the race this round. */
  readonly totals: Totals;
  /** Ballots with no remaining continuing option. */
  readonly exhausted: number;
  /** The option eliminated after this round, or `null` in the final round. */
  readonly eliminated: string | null;
}

export interface RankedChoiceTally {
  readonly schemaVersion: number;
  readonly votingMethod: "RANKED_CHOICE";
  readonly ballotCount: number;
  readonly rounds: readonly RankedChoiceRound[];
  /** One winner, the tied options when all remaining options are level, or empty if all ballots exhausted. */
  readonly winners: readonly string[];
}

export type TallyV1 = MajorityTally | QuadraticTally | RankedChoiceTally;

/**
 * Recomputes the tally under the dataset's voting method. `schemaVersion` is the version
 * bound into the tally serialization.
 */
export function tallyV1(dataset: DatasetV1, schemaVersion: number): TallyV1 {
  switch (dataset.votingMethod) {
    case "MAJORITY":
      return majority(dataset.options, dataset.ballots, schemaVersion);
    case "QUADRATIC":
      return quadratic(
        dataset.options,
        dataset.voiceCredits,
        dataset.ballots,
        schemaVersion,
      );
    case "RANKED_CHOICE":
      return rankedChoice(dataset.options, dataset.ballots, schemaVersion);
  }
}

/** The per-option totals a result summary reports: final-round counts for RANKED_CHOICE. */
export function finalTotals(tally: TallyV1): Totals {
  return tally.votingMethod === "RANKED_CHOICE"
    ? tally.rounds.at(-1)!.totals
    : tally.totals;
}

function majority(
  options: readonly string[],
  ballots: readonly MajorityBallot[],
  schemaVersion: number,
): MajorityTally {
  const totals = zeroTotals(options);
  for (const ballot of ballots)
    for (const id of ballot.optionIds) totals.set(id, totals.get(id)! + 1);
  return {
    schemaVersion,
    votingMethod: "MAJORITY",
    ballotCount: ballots.length,
    totals: Object.fromEntries(totals),
    winners: topOptions(totals),
  };
}

function quadratic(
  options: readonly string[],
  voiceCredits: number,
  ballots: readonly QuadraticBallot[],
  schemaVersion: number,
): QuadraticTally {
  const overBudget = ballots.filter(
    (ballot) =>
      Object.values(ballot.allocations).reduce(
        (sum, votes) => sum + BigInt(votes) ** 2n,
        0n,
      ) > BigInt(voiceCredits),
  );
  if (overBudget.length > 0) {
    const voters = overBudget.map((ballot) => ballot.voter);
    throw new DatasetError(
      "BUDGET_EXCEEDED",
      `${voters.length} ballot(s) spend more than voiceCredits (${voiceCredits}) on Σ votes²: voter ${voters.slice(0, 10).join(", ")}` +
        (voters.length > 10 ? ", …" : ""),
    );
  }
  const totals = zeroTotals(options);
  for (const ballot of ballots) {
    for (const [id, votes] of Object.entries(ballot.allocations))
      totals.set(id, totals.get(id)! + votes);
  }
  return {
    schemaVersion,
    votingMethod: "QUADRATIC",
    ballotCount: ballots.length,
    voiceCredits,
    totals: Object.fromEntries(totals),
    winners: topOptions(totals),
  };
}

/**
 * Instant-runoff replay. Each round counts every ballot for its highest-ranked continuing
 * option. The race ends when an option holds a strict majority of the non-exhausted
 * ballots, when all continuing options are tied (a tie between them), or when every ballot
 * is exhausted (no winner). Otherwise the option with the fewest votes is eliminated; ties
 * for last are broken by the fewest votes in the latest earlier round where they differ,
 * then by the smallest option id.
 */
function rankedChoice(
  options: readonly string[],
  ballots: readonly RankedChoiceBallot[],
  schemaVersion: number,
): RankedChoiceTally {
  const continuing = new Set(options);
  const rounds: RankedChoiceRound[] = [];
  const history: Map<string, number>[] = [];
  for (;;) {
    const counts = zeroTotals([...continuing]);
    let exhausted = 0;
    for (const ballot of ballots) {
      const choice = ballot.rankedOptions.find((id) => continuing.has(id));
      if (choice === undefined) exhausted++;
      else counts.set(choice, counts.get(choice)! + 1);
    }
    const active = ballots.length - exhausted;
    const values = [...counts.values()];
    const max = Math.max(...values);
    const finish = (winners: string[]): RankedChoiceTally => {
      rounds.push({
        totals: Object.fromEntries(counts),
        exhausted,
        eliminated: null,
      });
      return {
        schemaVersion,
        votingMethod: "RANKED_CHOICE",
        ballotCount: ballots.length,
        rounds,
        winners,
      };
    };

    if (active === 0) return finish([]);
    if (max * 2 > active) return finish(topOptions(counts));
    if (Math.min(...values) === max) return finish([...continuing].sort());

    const eliminated = lowest(counts, history);
    rounds.push({ totals: Object.fromEntries(counts), exhausted, eliminated });
    history.push(counts);
    continuing.delete(eliminated);
  }
}

function lowest(
  counts: ReadonlyMap<string, number>,
  history: readonly ReadonlyMap<string, number>[],
): string {
  const min = Math.min(...counts.values());
  let tied = [...counts.keys()].filter((id) => counts.get(id) === min);
  for (let r = history.length - 1; r >= 0 && tied.length > 1; r--) {
    const earlier = history[r]!;
    const floor = Math.min(...tied.map((id) => earlier.get(id)!));
    tied = tied.filter((id) => earlier.get(id) === floor);
  }
  return tied.sort()[0]!;
}

/** A Map in sorted option-id order, all zero. */
function zeroTotals(options: readonly string[]): Map<string, number> {
  return new Map([...options].sort().map((id) => [id, 0]));
}

function topOptions(totals: ReadonlyMap<string, number>): string[] {
  const max = Math.max(...totals.values());
  if (max === 0) return [];
  return [...totals.keys()].filter((id) => totals.get(id) === max).sort();
}
