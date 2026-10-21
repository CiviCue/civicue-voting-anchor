# @civicue/voting-anchor-mock-platform

**English** | [繁體中文](README.zh-TW.md)

A mock of the CiviCue platform's anchoring pipeline, built from the public docs in this repo, for rehearsing end-to-end verification on a local chain. It is private to the workspace and is not published.

It lets the verifier be exercised against a second implementation of the canonical schema without the platform's database, deployment, or relayer.

## What it models

| Module             | Spec                                                           | Behavior                                                                                                                                                                                                                         |
| ------------------ | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/platform.ts`  | [verification API](../verifier/docs/verification-api.md)       | Sessions and ballots. Casting validates a ballot and updates live per-option counters. `closeSession` sets `PENDING`, except for void sessions (turnout 0). Ranked choice waits until its rounds are computed.                   |
| `src/producer.ts`  | [canonical schema v1](../verifier/docs/canonical-schema-v1.md) | Regenerates the dataset on demand, numbering voters by `hash(ballotId)` order. Builds the tally from the recorded session state, not from a recount. Persists `merkleRoot`, `tallyHash`, and `anchorSchemaVersion` (`COMPUTED`). |
| `src/encoder.ts`   | [canonical schema v1](../verifier/docs/canonical-schema-v1.md) | The canonical JSON, leaf, Merkle tree, and tally encoding.                                                                                                                                                                       |
| `src/worker.ts`    | [`AnchorRegistry`](../contracts/README.md)                     | Anchors `COMPUTED` and `FAILED` sessions, waits for confirmation, and records `ANCHORED`. Errors become `FAILED`. An already anchored session is reconciled, not resubmitted.                                                    |
| `src/api.ts`       | [verification API](../verifier/docs/verification-api.md)       | `GET …/anchor` and `GET …/anchor/dataset`.                                                                                                                                                                                       |
| `src/scenarios.ts` | —                                                              | Sessions for every voting method and the schema's edge cases (ties, exhausted ballots, backward tie-breaks, Unicode option ids, a void session).                                                                                 |

The mock does not import the verifier's code. The encoder and the ranked-choice count are written from the public docs alone, so a PASS means two independent implementations agree.

The platform relays through an ERC-4337 smart account. Here the relayer is a plain anvil account. The verifier only reads `getAnchor`, so it sees no difference.

## Running the devnet

Requires Foundry's `anvil`, and the contracts and verifier packages built:

```bash
pnpm --filter @civicue/voting-anchor-contracts build
pnpm --filter @civicue/voting-anchor-verifier build
pnpm --filter @civicue/voting-anchor-mock-platform devnet   # --rpc-port 8545 --api-port 8787
```

It starts anvil with Base Sepolia's chain id, deploys `AnchorRegistry`, runs every scenario through close → producer → worker, and keeps the verification API up. It prints each session id and a command to verify it:

```bash
node packages/verifier/dist/cli.js verify --network base-sepolia \
  --rpc-url http://127.0.0.1:8545 --platform http://127.0.0.1:8787 --session <id>
```

## Tests

```bash
pnpm --filter @civicue/voting-anchor-mock-platform test
```

| File                     | Covers                                                                                                                                                                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/producer.test.ts`  | The conformance vectors through the mock producer (what the platform's CI must pass), the anchor-status lifecycle, the API's status rules, and 900 random sessions whose commitments must match the verifier's recomputation.                        |
| `test/rehearsal.test.ts` | On anvil: the worker's failure, retry, and reconcile paths. Every scenario must PASS in the verifier CLI. Each kind of tampering must FAIL with the expected checks and per-option differences. Skipped when anvil or the contract build is missing. |

The tampering cases are:

- a changed ballot, two swapped ballots, and a dropped or added ballot, for each voting method;
- a raised quadratic budget, a ballot over budget, and an unknown option;
- a relabelled schema version;
- a published summary that differs from the anchored tally;
- a ranked-choice summary that lists eliminated options;
- a platform bug where the anchored tally does not follow from the ballots.
