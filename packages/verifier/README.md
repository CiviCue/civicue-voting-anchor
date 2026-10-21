# @civicue/voting-anchor-verifier

**English** | [繁體中文](README.zh-TW.md)

This package independently verifies a CiviCue voting session that has been anchored on Base. Given a session id, it:

1. reads the session's commitment (`merkleRoot`, `tallyHash`) from `AnchorRegistry`,
2. fetches the published ballot dataset,
3. recomputes the Merkle root and the tally for the session's voting method (majority, quadratic, or ranked choice), and
4. reports whether the recomputed values match the on-chain commitment.

It trusts nothing the platform reports about hashes, because those values come from the chain. The verifier is read-only and never sends a transaction.

## What PASS means

PASS means the published ballots are tallied correctly under the session's voting method, and neither the ballots nor the tally changed after they were anchored on-chain.

[How verification works](docs/how-it-works.md) explains why a PASS can be trusted. The [CLI guide](docs/cli.md) covers every option, output, and outcome in detail.

## CLI

```bash
npx @civicue/voting-anchor-verifier verify \
  --session 6650a3b2c1d0e9f8a7b6c5d4 \
  --network base-sepolia \
  --platform https://<platform-api-base-url>
```

| Option                 | Meaning                                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `--session <id>`       | Session id (24-character hex, any case; lowercased before use)                                                       |
| `--network <name>`     | `base` or `base-sepolia`                                                                                             |
| `--platform <url>`     | Platform API base URL. The metadata and dataset URLs are derived from it ([API contract](docs/verification-api.md)). |
| `--contract <address>` | `AnchorRegistry` address, overriding the metadata's `anchorContract`                                                 |
| `--dataset-url <url>`  | Dataset URL override, for example an archived copy of `ballots.json`                                                 |
| `--rpc-url <url>`      | JSON-RPC endpoint (default: the network's public RPC)                                                                |
| `--json`               | Print the full report as JSON                                                                                        |

If a platform does not serve the metadata endpoint, pass `--contract` and `--dataset-url` without `--platform`.

| Exit code | Outcome                                                                                                                                |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `0`       | PASS                                                                                                                                   |
| `1`       | FAIL: a hash or the published result summary does not match, or the dataset is invalid, for example a ballot over its quadratic budget |
| `2`       | Not anchored: the registry has no commitment for this session                                                                          |
| `3`       | Unsupported: the dataset uses a schema version this verifier does not know. Upgrade the package.                                       |
| `4`       | Error: bad arguments, or an endpoint or RPC that could not be reached                                                                  |

On FAIL, the report shows which of `merkleRoot` and `tallyHash` differ, with both values. It also shows the per-option delta between the platform's published result and the recomputed tally.

## Library

```ts
import {
  computeCommitment,
  formatReport,
  verifySession,
} from "@civicue/voting-anchor-verifier";

const report = await verifySession({
  session: "6650a3b2c1d0e9f8a7b6c5d4",
  network: "base-sepolia",
  platform: "https://<platform-api-base-url>",
});
console.log(report.outcome, formatReport(report));

// Recompute from a dataset you already have:
const { merkleRoot, tallyHash, tally } = computeCommitment(
  JSON.parse(ballotsJson),
);
```

## Specifications

- [Canonical ballot schema v1](docs/canonical-schema-v1.md) defines the dataset format, leaf hashing, Merkle tree, and per-method tally serialization.
- [Public verification API](docs/verification-api.md) defines the endpoint paths and response shapes that the platform implements.
- Conformance vectors are in [`vectors/`](vectors), exported as `@civicue/voting-anchor-verifier/vectors` (`loadVectors()`).

## Development

```bash
pnpm --filter @civicue/voting-anchor-contracts build   # ABI used by the verifier (needs Foundry)
pnpm --filter @civicue/voting-anchor-verifier test     # unit tests, vectors, and anvil end-to-end tests
pnpm --filter @civicue/voting-anchor-verifier lint
```

The end-to-end tests run only when Foundry's `anvil` is installed and `packages/contracts` has been built. They deploy `AnchorRegistry` to a local chain, anchor vector commitments, and run the CLI against a local HTTP server that implements the API contract.

## Releasing

`pnpm publish` rewrites the `workspace:*` dependency to the current `@civicue/voting-anchor-contracts` version. Release both packages from the same commit, and publish the contracts package first:

```bash
pnpm --filter @civicue/voting-anchor-contracts publish
pnpm --filter @civicue/voting-anchor-verifier publish
npx -y @civicue/voting-anchor-verifier@<version> verify --help   # from a clean machine
```
