import type { Hex } from "viem";
import { invalid, UnsupportedSchemaVersionError } from "./errors.ts";
import {
  commitV1,
  finalTotals as finalTotalsV1,
  type DatasetV1,
  type TallyV1,
} from "./v1/index.ts";

/**
 * Every released schema version, kept forever: removing one would make the sessions
 * anchored under it unverifiable.
 */
const SCHEMAS = {
  1: { commit: commitV1, finalTotals: finalTotalsV1 },
} as const;

export type SchemaVersion = keyof typeof SCHEMAS;
export const SUPPORTED_SCHEMA_VERSIONS: readonly SchemaVersion[] = [1];

export type Dataset = DatasetV1;
export type Tally = TallyV1;

export interface Commitment {
  readonly schemaVersion: SchemaVersion;
  /** The dataset in canonical form. */
  readonly dataset: Dataset;
  readonly merkleRoot: Hex;
  readonly tally: Tally;
  readonly tallyHash: Hex;
}

/**
 * Recomputes `merkleRoot` and `tallyHash` from a parsed `ballots.json`, dispatching on its
 * `schemaVersion`.
 *
 * @throws {UnsupportedSchemaVersionError} for a version this verifier does not implement.
 * @throws {DatasetError} when the dataset is malformed or breaks a voting rule.
 */
export function computeCommitment(input: unknown): Commitment {
  const schemaVersion = declaredVersion(input);
  const { dataset, merkleRoot, tally, tallyHash } =
    SCHEMAS[schemaVersion].commit(input);
  return { schemaVersion, dataset, merkleRoot, tally, tallyHash };
}

/** The per-option totals a result summary reports (final-round counts for RANKED_CHOICE). */
export function finalTotals(
  commitment: Commitment,
): Readonly<Record<string, number>> {
  return SCHEMAS[commitment.schemaVersion].finalTotals(commitment.tally);
}

function declaredVersion(input: unknown): SchemaVersion {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw invalid("dataset must be an object");
  const version = (input as { schemaVersion?: unknown }).schemaVersion;
  if (version === undefined) throw invalid("dataset has no schemaVersion");
  if (!Object.hasOwn(SCHEMAS, String(version)) || typeof version !== "number") {
    throw new UnsupportedSchemaVersionError(version, SUPPORTED_SCHEMA_VERSIONS);
  }
  return version as SchemaVersion;
}
