// The producer's canonical encoder, written from docs/canonical-schema-v1.md alone. It must not
// import the verifier: the point of the mock is a second, independent implementation of the spec.
import { bytesToHex, concatBytes, keccak256, type Hex } from "viem";

export type VotingMethod = "MAJORITY" | "QUADRATIC" | "RANKED_CHOICE";

export type DatasetRow =
  | { voter: number; optionIds: string[] }
  | { voter: number; allocations: Record<string, number> }
  | { voter: number; rankedOptions: string[] };

export interface Dataset {
  schemaVersion: number;
  votingMethod: VotingMethod;
  options: string[];
  voiceCredits?: number;
  ballots: DatasetRow[];
}

export interface Round {
  totals: Record<string, number>;
  exhausted: number;
  eliminated: string | null;
}

/** The canonical tally object, before serialization. */
export type Tally = {
  schemaVersion: number;
  votingMethod: VotingMethod;
  ballotCount: number;
  winners: string[];
} & (
  | { totals: Record<string, number>; voiceCredits?: number }
  | { rounds: Round[] }
);

/** The schema versions this producer can emit. Every emitted version's encoder is kept. */
export const ENCODABLE_VERSIONS = [1];

export class EncodeError extends Error {
  readonly code: "INVALID_DATASET" | "UNSUPPORTED_SCHEMA_VERSION";

  constructor(code: EncodeError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

const encoder = new TextEncoder();
const utf8 = (text: string) => encoder.encode(text);

/** RFC 8785, restricted to the values the schema allows: non-negative safe integers, strings, arrays, objects, null. */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new EncodeError(
        "INVALID_DATASET",
        `not a canonical number: ${value}`,
      );
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalize((value as Record<string, unknown>)[key])}`,
      );
    return `{${entries.join(",")}}`;
  }
  throw new EncodeError(
    "INVALID_DATASET",
    `not a canonical value: ${typeof value}`,
  );
}

/** Normalizes a row: sorted MAJORITY selections, no zero QV allocations, RCV order kept. */
function normalizeRow(row: DatasetRow): DatasetRow {
  if ("optionIds" in row)
    return { voter: row.voter, optionIds: [...row.optionIds].sort() };
  if ("allocations" in row) {
    const kept = Object.entries(row.allocations).filter(
      ([, votes]) => votes !== 0,
    );
    return { voter: row.voter, allocations: Object.fromEntries(kept) };
  }
  return { voter: row.voter, rankedOptions: [...row.rankedOptions] };
}

function leafHash(row: DatasetRow, version: number): Uint8Array {
  const preimage = concatBytes([
    utf8(`civicue.ballot.v${version}`),
    new Uint8Array([0]),
    utf8(canonicalize(row)),
  ]);
  return keccak256(preimage, "bytes");
}

function root(leaves: Uint8Array[]): Uint8Array {
  let level = leaves;
  while (level.length > 1) {
    const up: Uint8Array[] = [];
    for (let i = 0; i + 1 < level.length; i += 2)
      up.push(
        keccak256(
          concatBytes([new Uint8Array([1]), level[i]!, level[i + 1]!]),
          "bytes",
        ),
      );
    if (level.length % 2 === 1) up.push(level.at(-1)!);
    level = up;
  }
  return level[0]!;
}

/** Puts a dataset in canonical form and checks the shape rules a commitment depends on. */
export function canonicalDataset(dataset: Dataset): Dataset {
  if (!ENCODABLE_VERSIONS.includes(dataset.schemaVersion))
    throw new EncodeError(
      "UNSUPPORTED_SCHEMA_VERSION",
      `cannot encode schemaVersion ${dataset.schemaVersion}`,
    );
  const ballots = dataset.ballots
    .map(normalizeRow)
    .sort((a, b) => a.voter - b.voter);
  ballots.forEach((row, index) => {
    if (row.voter !== index + 1)
      throw new EncodeError(
        "INVALID_DATASET",
        `voter numbers must be exactly 1..${ballots.length}`,
      );
  });
  return { ...dataset, options: [...dataset.options].sort(), ballots };
}

/**
 * Hashes a dataset and the tally the platform recorded for it. `bindVersion` binds a version
 * other than the dataset's own into both hashes (the conformance vectors' version-binding case).
 */
export function encodeCommitment(
  dataset: Dataset,
  tally: Tally,
  bindVersion = dataset.schemaVersion,
): { dataset: Dataset; merkleRoot: Hex; tallyHash: Hex } {
  const canonical = canonicalDataset(dataset);
  if (canonical.ballots.length === 0)
    throw new EncodeError(
      "INVALID_DATASET",
      "a dataset needs at least one ballot",
    );
  const merkleRoot = bytesToHex(
    root(canonical.ballots.map((row) => leafHash(row, bindVersion))),
  );
  const tallyHash = keccak256(
    utf8(canonicalize({ ...tally, schemaVersion: bindVersion })),
  );
  return { dataset: canonical, merkleRoot, tallyHash };
}

/** Options with the highest total, sorted; empty when no option has a vote. */
export function topOptions(totals: Record<string, number>): string[] {
  const best = Math.max(0, ...Object.values(totals));
  return best === 0
    ? []
    : Object.keys(totals)
        .filter((id) => totals[id] === best)
        .sort();
}
