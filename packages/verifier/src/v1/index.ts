import { concatHex, keccak256, stringToHex, type Hex } from "viem";
import { canonicalJson } from "../canonical-json.ts";
import { merkleRoot } from "../merkle.ts";
import { parseDatasetV1, type BallotV1, type DatasetV1 } from "./dataset.ts";
import { tallyV1, type TallyV1 } from "./tally.ts";

export * from "./dataset.ts";
export * from "./tally.ts";

/** The leaf domain-separation tag for `schemaVersion`, e.g. `civicue.ballot.v1`. */
export function leafTag(schemaVersion: number): string {
  return `civicue.ballot.v${schemaVersion}`;
}

/** `keccak256(utf8(leafTag(schemaVersion)) ‖ 0x00 ‖ utf8(canonicalJson(ballot)))`. */
export function hashLeafV1(ballot: BallotV1, schemaVersion: number): Hex {
  return keccak256(
    concatHex([
      stringToHex(leafTag(schemaVersion)),
      "0x00",
      stringToHex(canonicalJson(ballot)),
    ]),
  );
}

/** `keccak256(utf8(canonicalJson(tally)))`; the tally carries `schemaVersion`. */
export function hashTallyV1(tally: TallyV1): Hex {
  return keccak256(stringToHex(canonicalJson(tally)));
}

export interface CommitmentV1 {
  readonly dataset: DatasetV1;
  readonly merkleRoot: Hex;
  readonly tally: TallyV1;
  readonly tallyHash: Hex;
}

/**
 * Applies the schema-v1 rules to `input`. `bindVersion` is the version number bound into
 * both hashes; it defaults to the dataset's own `schemaVersion` and is overridden only by
 * the version-binding conformance vectors.
 */
export function commitV1(input: unknown, bindVersion?: number): CommitmentV1 {
  const dataset = parseDatasetV1(input);
  const version = bindVersion ?? dataset.schemaVersion;
  const tally = tallyV1(dataset, version);
  return {
    dataset,
    merkleRoot: merkleRoot(
      dataset.ballots.map((ballot) => hashLeafV1(ballot, version)),
    ),
    tally,
    tallyHash: hashTallyV1(tally),
  };
}
