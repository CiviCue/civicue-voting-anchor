# Public verification API, version 1

**English** | [繁體中文](verification-api.zh-TW.md)

This document is the authoritative definition of the HTTP API that a CiviCue platform deployment serves for anchored voting sessions. The platform implements it, and the verifier consumes it. Both endpoints are public, need no authentication, and do not depend on which module owns the session.

The verifier builds both URLs from a platform base URL and a session id, so the platform never returns URLs to itself. Paths are relative to the base URL, which may include a path prefix:

```
{platform}/v2/voting/sessions/{id}/anchor            metadata
{platform}/v2/voting/sessions/{id}/anchor/dataset    canonical ballots.json
```

`{id}` is the session's 24-character hex session id, in lowercase. Its on-chain key is `sessionId = keccak256(bytes(id))`. See [`@civicue/voting-anchor-contracts` `fixtures/session-id.json`](../../contracts/fixtures/session-id.json).

## `GET /v2/voting/sessions/:id/anchor`

This endpoint returns the session's verification fields and a human-readable summary of its result.

```jsonc
{
  "sessionId": "6650a3b2c1d0e9f8a7b6c5d4",
  "votingMethod": "QUADRATIC", // MAJORITY | QUADRATIC | RANKED_CHOICE
  "anchorStatus": "ANCHORED", // PENDING | COMPUTED | ANCHORED | FAILED
  "schemaVersion": 1, // canonical schema version the commitment was computed under
  "merkleRoot": "0x…", // bytes32
  "tallyHash": "0x…", // bytes32
  "anchorTxHash": "0x…", // null until anchored
  "anchorContract": "0x…", // AnchorRegistry address this session was anchored to; null until anchored
  "chainId": 84532, // 8453 (Base) or 84532 (Base Sepolia); null until anchored
  "result": {
    "winner": "C", // single winning option id; null on a tie or when there is no winner
    "turnout": 3, // number of ballots in the dataset
    "options": [
      { "id": "A", "votes": 3 },
      { "id": "B", "votes": 2 },
      { "id": "C", "votes": 5 },
    ],
  },
}
```

| Status | When                                                                           |
| ------ | ------------------------------------------------------------------------------ |
| `200`  | The session is closed and has an anchor record (`anchorStatus` is not `NONE`). |
| `404`  | The session does not exist, is not closed, or has no anchor record.            |

Rules:

- `anchorContract` and `chainId` identify the exact registry for this session. Registries can be redeployed, so clients must not assume a single permanent address.
- `result` must agree with what `tallyHash` commits to. The verifier compares `result` with its own recomputation and reports any difference as a failure.
  - `options` holds exactly the per-option totals of the [canonical tally](canonical-schema-v1.md#tally-and-tallyhash), in any order.
  - For `MAJORITY` and `QUADRATIC`, that is `totals`, so every option is listed, including options with `0` votes.
  - For `RANKED_CHOICE`, that is the final round's `totals`: only the options still continuing in the final round, with their final-round counts. Eliminated options are **not** listed. Listing one, even with `0` votes, is a mismatch. The elimination history is committed through `rounds` in the tally, which the verifier recomputes.
  - `winner` is the tally's single winner, or `null` when the tally has zero or several winners.
- The response has no `datasetUrl` field, because the dataset path follows from this contract.
- The response must not expose pre-close results, voter identities, or eligibility rules.

## `GET /v2/voting/sessions/:id/anchor/dataset`

This endpoint returns the session's canonical ballot dataset (`ballots.json`), as defined by the [canonical schema](canonical-schema-v1.md) for the session's `schemaVersion`. The response is `application/json`.

| Status | When                                                                                                |
| ------ | --------------------------------------------------------------------------------------------------- |
| `200`  | The session's commitment has been computed (`anchorStatus` is `COMPUTED`, `ANCHORED`, or `FAILED`). |
| `404`  | Otherwise.                                                                                          |

Rules:

- Every response for a session must produce the session's `merkleRoot` and `tallyHash` under the canonical schema. The bytes do not need to be identical between responses, but the normalized dataset must be.
- Any copy of the dataset, such as an archived one, can be verified against the on-chain root. The verifier accepts such a copy with `--dataset-url`.

## How the verifier uses this API

1. `GET …/anchor` returns `anchorContract`, `chainId`, and `result`. `--contract` replaces `anchorContract` when the metadata endpoint is unavailable.
2. It reads `AnchorRegistry(anchorContract).getAnchor(sessionId)` on the chain. If `timestamp` is `0`, the session is not anchored.
3. `GET …/anchor/dataset` returns the dataset. `--dataset-url` replaces this URL.
4. It recomputes `merkleRoot` and `tallyHash`, compares them with the on-chain values, and compares `result` with the recomputed tally.

The verifier trusts none of the metadata's hash fields. The hashes always come from the chain.
