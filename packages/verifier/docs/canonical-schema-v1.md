# Canonical ballot schema, version 1

**English** | [繁體中文](canonical-schema-v1.zh-TW.md)

This document is the authoritative definition of how a published ballot dataset (`ballots.json`) maps to the two values anchored on-chain: `merkleRoot` and `tallyHash`. The CiviCue platform's producer mirrors it, and the verifier in this package implements it. The [conformance vectors](../vectors/v1) pin it byte for byte. When this document and the vectors disagree, the vectors win.

Version 1 is frozen. Any change to the canonical bytes, the leaf hashing, the tree, or the tally serialization needs a new `schemaVersion`. Additive dataset fields that are not hashed (see [Ignored fields](#ignored-fields)) do not.

## Dataset

```jsonc
{
  "schemaVersion": 1,
  "votingMethod": "QUADRATIC", // "MAJORITY" | "QUADRATIC" | "RANKED_CHOICE"
  "voiceCredits": 10, // QUADRATIC only: the uniform per-voter budget
  "options": ["A", "B", "C"],
  "ballots": [
    { "voter": 1, "allocations": { "A": 2, "B": 1 } },
    { "voter": 2, "allocations": { "C": 3 } },
  ],
}
```

| Field           | Rule                                                                                                                             |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion` | The integer `1`. Any other value is reported as **unsupported**, not as a failure.                                               |
| `votingMethod`  | `MAJORITY`, `QUADRATIC`, or `RANKED_CHOICE`.                                                                                     |
| `options`       | Non-empty array of distinct, non-empty option id strings.                                                                        |
| `voiceCredits`  | `QUADRATIC` only. A positive integer.                                                                                            |
| `ballots`       | Non-empty array of rows. Each row's `voter` is a positive integer, and the set of `voter` values is exactly `1..n` for `n` rows. |

Each row carries one method-specific field:

| `votingMethod`  | Row field       | Rule                                                                                        |
| --------------- | --------------- | ------------------------------------------------------------------------------------------- |
| `MAJORITY`      | `optionIds`     | Array of distinct option ids from `options`. May be empty (a blank ballot).                 |
| `QUADRATIC`     | `allocations`   | Object mapping option ids from `options` to non-negative integers. May be empty.            |
| `RANKED_CHOICE` | `rankedOptions` | Array of distinct option ids from `options`, most preferred first. May be partial or empty. |

A dataset that breaks any rule above cannot reproduce a commitment and fails verification (`INVALID_DATASET`).

The voter index carries no identity. The producer assigns `voter` numbers by ordering ballots on a hash of their internal ids. The index exists only so per-voter rules can be checked.

### Ignored fields

Fields not listed above, at the top level or in a row, are ignored. They are not hashed, so they are not covered by the anchor.

## Canonical form

Before hashing, the dataset is normalized. Every implementation must produce the same normalized values from the same logical dataset, whatever the input order:

- `options` are sorted.
- `ballots` are ordered by `voter`, ascending.
- `MAJORITY` `optionIds` are sorted.
- `QUADRATIC` allocation entries with value `0` are dropped.
- `RANKED_CHOICE` `rankedOptions` keep their order, because order is the ballot.

"Sorted" always means ascending by UTF-16 code units, which is JavaScript's default `Array.prototype.sort()` order.

### Canonical JSON

Values are serialized with the [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) JSON Canonicalization Scheme, restricted to the values that occur here:

- Object keys are sorted by UTF-16 code units. There is no whitespace.
- Strings are escaped as ECMAScript `JSON.stringify` escapes them, then encoded as UTF-8.
- Numbers are only non-negative integers up to 2^53 − 1, written in decimal with no sign, exponent, fraction, or leading zeros.
- Arrays keep their order. `null` appears only in a tally's `eliminated` field.

## Leaves and `merkleRoot`

Each normalized row becomes one leaf. The row object contains exactly `voter` and its method field:

```
leaf = keccak256( utf8("civicue.ballot.v1") ‖ 0x00 ‖ utf8(canonicalJson(row)) )
```

For example, the row `{"optionIds":["A"],"voter":1}` is hashed with the 18-byte prefix `civicue.ballot.v1\0`. The tag contains the schema version, so `merkleRoot` commits to it.

The tree is built over the leaves in row order (by `voter`):

```
node = keccak256( 0x01 ‖ left ‖ right )
```

Pair nodes left to right at each level. If a level has an odd count, its last node moves up to the next level unchanged; it is never duplicated. A single leaf is its own root. A leaf preimage starts with `c` (`0x63`) and a node preimage starts with `0x01`, so the two cannot collide.

## Tally and `tallyHash`

```
tallyHash = keccak256( utf8(canonicalJson(tally)) )
```

The tally object depends on the voting method. Every tally contains `schemaVersion`, `votingMethod`, `ballotCount` (the number of rows), and `winners`, so `tallyHash` commits to the version and to the method.

### `MAJORITY`

Each selected option id in each row adds one vote.

```text
{"ballotCount":5,"schemaVersion":1,"totals":{"A":3,"B":1,"C":1},"votingMethod":"MAJORITY","winners":["A"]}
```

- `totals` lists every option, including those with `0`.
- `winners` lists the options with the highest total, sorted. It has more than one entry on a tie, and it is empty when every total is `0`.

### `QUADRATIC`

First, the budget is checked. For every row, the sum of `votes²` over its allocations must be at most `voiceCredits`. If any row exceeds it, verification fails (`BUDGET_EXCEEDED`) and no tally is produced. Then the allocations are summed per option.

```text
{"ballotCount":3,"schemaVersion":1,"totals":{"A":3,"B":2,"C":5},"voiceCredits":10,"votingMethod":"QUADRATIC","winners":["C"]}
```

`totals` and `winners` follow the `MAJORITY` rules. `voiceCredits` is included, so the budget the ballots were checked against is committed too.

### `RANKED_CHOICE`

The tally is an instant-runoff replay. At the start, every option is continuing. Each round:

1. Count each row once, for its highest-ranked option that is still continuing. A row with none left is **exhausted**. Let `active` be the number of rows that are not exhausted.
2. If `active` is `0`, the race ends with no winner (`winners: []`).
3. If an option has more than half of `active` (`votes × 2 > active`), it wins.
4. If every continuing option has the same count, the race ends in a tie, and `winners` lists all of them, sorted.
5. Otherwise, the option with the fewest votes is eliminated. If several options tie for fewest, look at the earlier rounds from the most recent backwards and keep only the tied options with the fewest votes in that round. Stop when one option is left. If options are still tied after round 1, eliminate the smallest option id.

```text
{"ballotCount":8,"rounds":[{"eliminated":"C","exhausted":0,"totals":{"A":3,"B":2,"C":1,"D":2}},{"eliminated":"B","exhausted":0,"totals":{"A":3,"B":2,"D":3}},{"eliminated":null,"exhausted":0,"totals":{"A":3,"D":5}}],"schemaVersion":1,"votingMethod":"RANKED_CHOICE","winners":["D"]}
```

- `rounds` lists every round in order. A round's `totals` covers only the options continuing in that round. `exhausted` is the count of exhausted rows. `eliminated` is the option removed after the round, or `null` in the final round.
- `winners` has one option, the tied options, or is empty.

## Versioning

- The version is bound into both hashes: through the leaf tag (`civicue.ballot.v<N>`) and through the tally's `schemaVersion` field. Declaring a different version changes both `merkleRoot` and `tallyHash` (see [`vectors/v1/version-binding`](../vectors/v1/version-binding)).
- The verifier keeps every released version forever, so sessions anchored under an old version stay verifiable.
- The producer persists the version each session was computed under and regenerates its dataset under that version.

## Conformance vectors

`vectors/v<schemaVersion>/<group>/*.json`, each with the following shape:

```jsonc
{
  "description": "…",
  "bindVersion": 2, // optional: bind this version into the hashes instead of dataset.schemaVersion
  "dataset": {/* ballots.json */},
  "expected": { "merkleRoot": "0x…", "tallyHash": "0x…" }, // or { "error": "INVALID_DATASET" | "BUDGET_EXCEEDED" | "UNSUPPORTED_SCHEMA_VERSION" }
}
```

The vectors ship in the npm package. The producer's CI pins a package version and runs every vector:

```ts
import { loadVectors } from "@civicue/voting-anchor-verifier/vectors";

for (const vector of loadVectors()) {
  // Run the producer's encoder on vector.dataset (binding vector.bindVersion when set)
  // and assert vector.expected.
}
```

The raw files can also be imported directly, for example `@civicue/voting-anchor-verifier/vectors/v1/majority/basic.json`. Vectors for a released version never change. A fix goes into a new version, unless the vector itself is shown to be wrong.
