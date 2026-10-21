import { invalid } from "../errors.ts";

export const VOTING_METHODS = [
  "MAJORITY",
  "QUADRATIC",
  "RANKED_CHOICE",
] as const;
export type VotingMethod = (typeof VOTING_METHODS)[number];

export interface MajorityBallot {
  readonly voter: number;
  /** Selected option ids, sorted. Empty for a blank ballot. */
  readonly optionIds: readonly string[];
}

export interface QuadraticBallot {
  readonly voter: number;
  /** Votes per option id; zero entries are dropped. */
  readonly allocations: Readonly<Record<string, number>>;
}

export interface RankedChoiceBallot {
  readonly voter: number;
  /** Option ids in preference order; may be partial or empty. */
  readonly rankedOptions: readonly string[];
}

interface DatasetBase {
  readonly schemaVersion: number;
  /** Option ids, sorted. */
  readonly options: readonly string[];
}

export type DatasetV1 =
  | (DatasetBase & {
      readonly votingMethod: "MAJORITY";
      readonly ballots: readonly MajorityBallot[];
    })
  | (DatasetBase & {
      readonly votingMethod: "QUADRATIC";
      readonly voiceCredits: number;
      readonly ballots: readonly QuadraticBallot[];
    })
  | (DatasetBase & {
      readonly votingMethod: "RANKED_CHOICE";
      readonly ballots: readonly RankedChoiceBallot[];
    });

export type BallotV1 = DatasetV1["ballots"][number];

/**
 * Validates a schema-v1 dataset and returns its canonical form: options sorted, ballots
 * ordered by `voter`, MAJORITY selections sorted, zero QUADRATIC allocations dropped.
 * Fields this version does not define are ignored (they are not committed to).
 */
export function parseDatasetV1(input: unknown): DatasetV1 {
  const data = record(input, "dataset");
  const schemaVersion = data.schemaVersion as number;
  const votingMethod = data.votingMethod;
  if (!VOTING_METHODS.includes(votingMethod as VotingMethod)) {
    throw invalid(`votingMethod must be one of ${VOTING_METHODS.join(", ")}`);
  }
  const options = parseOptions(data.options);
  const known = new Set(options);
  const rows = data.ballots;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw invalid("ballots must be a non-empty array");
  }
  const voters = rows.map((row, i) => voterOf(row, i));
  checkVoterIndex(voters);

  const base = { schemaVersion, options };
  switch (votingMethod as VotingMethod) {
    case "MAJORITY":
      return {
        ...base,
        votingMethod: "MAJORITY",
        ballots: sortByVoter(
          rows.map((row, i) => ({
            voter: voters[i]!,
            optionIds: [
              ...optionList(
                record(row, `ballots[${i}]`).optionIds,
                known,
                `ballots[${i}].optionIds`,
              ),
            ].sort(),
          })),
        ),
      };
    case "QUADRATIC":
      return {
        ...base,
        votingMethod: "QUADRATIC",
        voiceCredits: positiveInteger(data.voiceCredits, "voiceCredits"),
        ballots: sortByVoter(
          rows.map((row, i) => ({
            voter: voters[i]!,
            allocations: allocations(
              record(row, `ballots[${i}]`).allocations,
              known,
              `ballots[${i}].allocations`,
            ),
          })),
        ),
      };
    case "RANKED_CHOICE":
      return {
        ...base,
        votingMethod: "RANKED_CHOICE",
        ballots: sortByVoter(
          rows.map((row, i) => ({
            voter: voters[i]!,
            rankedOptions: optionList(
              record(row, `ballots[${i}]`).rankedOptions,
              known,
              `ballots[${i}].rankedOptions`,
            ),
          })),
        ),
      };
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalid(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw invalid(`${path} must be a non-negative integer`);
  }
  return value;
}

function positiveInteger(value: unknown, path: string): number {
  const n = nonNegativeInteger(value, path);
  if (n === 0) throw invalid(`${path} must be a positive integer`);
  return n;
}

function parseOptions(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw invalid("options must be a non-empty array of option ids");
  }
  const seen = new Set<string>();
  for (const [i, id] of value.entries()) {
    if (typeof id !== "string" || id.length === 0)
      throw invalid(`options[${i}] must be a non-empty string`);
    if (seen.has(id)) throw invalid(`options contains duplicate id "${id}"`);
    seen.add(id);
  }
  return [...seen].sort();
}

function voterOf(row: unknown, i: number): number {
  return positiveInteger(
    record(row, `ballots[${i}]`).voter,
    `ballots[${i}].voter`,
  );
}

/** Voter indexes must be exactly 1..n, each once. */
function checkVoterIndex(voters: readonly number[]): void {
  const sorted = [...voters].sort((a, b) => a - b);
  sorted.forEach((voter, i) => {
    if (voter !== i + 1)
      throw invalid(
        `voter indexes must be exactly 1..${voters.length}, each once`,
      );
  });
}

function sortByVoter<T extends { readonly voter: number }>(rows: T[]): T[] {
  return rows.sort((a, b) => a.voter - b.voter);
}

function optionList(
  value: unknown,
  known: ReadonlySet<string>,
  path: string,
): string[] {
  if (!Array.isArray(value))
    throw invalid(`${path} must be an array of option ids`);
  const seen = new Set<string>();
  for (const id of value) {
    if (typeof id !== "string" || !known.has(id))
      throw invalid(`${path} contains unknown option ${JSON.stringify(id)}`);
    if (seen.has(id))
      throw invalid(`${path} contains duplicate option "${id}"`);
    seen.add(id);
  }
  return [...seen];
}

function allocations(
  value: unknown,
  known: ReadonlySet<string>,
  path: string,
): Record<string, number> {
  const kept: [string, number][] = [];
  for (const [id, votes] of Object.entries(record(value, path))) {
    if (!known.has(id))
      throw invalid(`${path} contains unknown option ${JSON.stringify(id)}`);
    const n = nonNegativeInteger(votes, `${path}.${id}`);
    if (n > 0) kept.push([id, n]);
  }
  // `fromEntries` defines own properties, so an option id like "__proto__" stays a plain key.
  return Object.fromEntries(kept);
}
