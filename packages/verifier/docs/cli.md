# Verifier CLI guide

**English** | [繁體中文](cli.zh-TW.md)

This guide covers everything the `voting-anchor-verifier` command does: how to run it, where it gets each input, how to read its output, and what to do with each outcome. For why a PASS can be trusted, see [How verification works](how-it-works.md).

## Running it

The CLI needs Node.js 24 or later. It has one command, `verify`.

```bash
npx @civicue/voting-anchor-verifier verify --session <id> --network <base|base-sepolia> --platform <platform-api-base-url>
```

To pin a version (recommended for scripts and audits) or to install it:

```bash
npx @civicue/voting-anchor-verifier@0.1.0 verify …
npm install -g @civicue/voting-anchor-verifier && voting-anchor-verifier verify …
```

The verifier is read-only. It sends HTTP `GET` requests and JSON-RPC `eth_chainId` and `eth_call` requests. It never signs or sends a transaction, so it needs no wallet, key, or funds.

## Options

| Option                 | Required                                             | Meaning                                                                                                                             |
| ---------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `verify`               | yes                                                  | The command. It is the only one.                                                                                                    |
| `--session <id>`       | yes                                                  | The session's 24-character hex session id, in any letter case (lowercased before use). Surrounding whitespace is ignored.           |
| `--network <name>`     | yes                                                  | `base` (chain 8453) or `base-sepolia` (chain 84532).                                                                                |
| `--platform <url>`     | unless `--contract` and `--dataset-url` are both set | The platform API base URL, including any path prefix. Must be `http` or `https`. The metadata and dataset URLs are derived from it. |
| `--contract <address>` | no                                                   | The `AnchorRegistry` address to read. It overrides the metadata's `anchorContract`.                                                 |
| `--dataset-url <url>`  | no                                                   | Where to fetch `ballots.json`. It overrides the URL derived from `--platform`.                                                      |
| `--rpc-url <url>`      | no                                                   | The JSON-RPC endpoint. Defaults to the network's public RPC. The verifier checks that the endpoint's chain id matches `--network`.  |
| `--json`               | no                                                   | Print the full report as JSON instead of text.                                                                                      |
| `-h`, `--help`         | no                                                   | Print usage and exit with `0`.                                                                                                      |

## Where each input comes from

The verifier needs three things: the registry address, the on-chain commitment, and the dataset.

| Input            | Default source                                                      | Override        |
| ---------------- | ------------------------------------------------------------------- | --------------- |
| Registry address | `anchorContract` in `GET {platform}/v2/voting/sessions/{id}/anchor` | `--contract`    |
| Commitment       | `AnchorRegistry.getAnchor(sessionId)` on `--network`                | (none)          |
| Dataset          | `GET {platform}/v2/voting/sessions/{id}/anchor/dataset`             | `--dataset-url` |

`{id}` is the lowercased session id, and `sessionId = keccak256(bytes(id))`. The [verification API](verification-api.md) defines both endpoints.

The commitment has no override. It always comes from the chain, because the chain is the one source the platform cannot rewrite.

The metadata also carries `chainId` and a `result` summary:

- If `chainId` does not match `--network`, the verifier stops with an error instead of reading the wrong chain.
- If the metadata was fetched, its `result` is compared with the recomputed tally. This is the `resultSummary` check.

### Common invocations

Normal use, with every input from the platform:

```bash
npx @civicue/voting-anchor-verifier verify \
  --session 6650a3b2c1d0e9f8a7b6c5d4 \
  --network base \
  --platform https://api.example.org
```

Verify an archived or mirrored copy of the dataset. The metadata still supplies the registry and the result summary:

```bash
npx @civicue/voting-anchor-verifier verify \
  --session 6650a3b2c1d0e9f8a7b6c5d4 --network base \
  --platform https://api.example.org \
  --dataset-url https://archive.example.org/ballots.json
```

Without the platform at all, for example when the platform is offline or you don't want to rely on it. You need the registry address (from the deployment record, or from a Basescan `Anchored` event) and a copy of the dataset:

```bash
npx @civicue/voting-anchor-verifier verify \
  --session 6650a3b2c1d0e9f8a7b6c5d4 --network base \
  --contract 0x… \
  --dataset-url https://mirror.example.org/ballots.json
```

This mode skips the `resultSummary` check and prints a warning, because there is no published summary to compare with.

`--dataset-url` takes a URL, not a file path. To verify a local file, serve it, for example with `npx http-server` or `python3 -m http.server`.

Use your own RPC endpoint when the public one is rate-limited, or when you don't want to trust it:

```bash
npx @civicue/voting-anchor-verifier verify … --rpc-url <base-rpc-url>
```

If `--contract` and the metadata's `anchorContract` disagree, `--contract` wins and the report adds a warning. If the metadata endpoint fails while `--contract` is set, the verifier continues and adds a warning.

### Confirming the registry

For a full independent check, compare the report's `registry` line with CiviCue's published deployment record:

- the deployment records are in `packages/contracts/deployments/<chainId>.json`;
- they are exported as `@civicue/voting-anchor-contracts/deployments/<chainId>.json`;
- the contract's verified source is also on Basescan.

A redeploy replaces the record file. A session anchored before a redeploy points to the earlier address, which is in that file's history in this repository.

## Reading the output

### PASS

```text
PASS

  session       65f1c2a9e4b0d3f7a8c91e20 (sessionId 0x009568d07b457170327bd557ce0d8658ef696946c6dce6e84f2879a70b1a7e18)
  network       base-sepolia (chain 84532)
  registry      0x5FbDB2315678afecb367f032d93F642f64180aa3
  metadata      http://127.0.0.1:8787/v2/voting/sessions/65f1c2a9e4b0d3f7a8c91e20/anchor
  dataset       http://127.0.0.1:8787/v2/voting/sessions/65f1c2a9e4b0d3f7a8c91e20/anchor/dataset
  anchored at   block 2, 2026-10-10T11:39:40.000Z
  schema        v1, MAJORITY
  ballots       5
  winner        A

Checks:
  ✓ merkleRoot
  ✓ tallyHash
  ✓ resultSummary

PASS means the published ballots are tallied correctly under the session's voting method, and neither the ballots nor the tally changed after they were anchored on-chain.
```

| Line          | Meaning                                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------------------------- |
| `session`     | The normalized id and the `bytes32` key that was looked up on chain.                                              |
| `registry`    | The contract that was read. Check it against the published deployment address if you don't trust the metadata.    |
| `anchored at` | The block and time the commitment was written, from the contract's storage.                                       |
| `schema`      | The canonical schema version and voting method declared by the dataset.                                           |
| `ballots`     | The number of rows in the dataset (turnout).                                                                      |
| `winner`      | The recomputed winner. `A, B (tie)` for a tie, and `none` when no option received a vote.                         |
| `Checks`      | `merkleRoot` and `tallyHash` compare against the chain. `resultSummary` compares against the platform's `result`. |

### FAIL

This output comes from verifying a session against a copy of its dataset in which one quadratic ballot was changed from `{"C":3}` to `{"A":3}`:

```text
FAIL: mismatch in merkleRoot, tallyHash, resultSummary

  …
  winner        A

Checks:
  ✗ merkleRoot
      on-chain    0x39e8eb44d1f1c0ed4da7c2dd465162f7962c6bf2db7a4bb5f4817e5d1a06ffa5
      recomputed  0xebcf389cd6fb5f0717a4cc299a73edf459e85be0f9911379b9d467f2d50f61aa
  ✗ tallyHash
      on-chain    0x924f90f43511876e459b2df5976472a479707d65c1b4cf53dfd134d725650d70
      recomputed  0x7538841b8a4f6705c95de72d58bbcec6f1c52c7bd0b858c27ebfeb838f50b823
  ✗ resultSummary

Published result summary vs recomputed tally:
  A: published 3, recomputed 6 (published 3 fewer)
  C: published 5, recomputed 2 (published 3 more)
  winner: published C, recomputed A
```

The header `winner` line is the winner of the dataset that was fetched, not of the anchored one. The words in parentheses say whether the platform published more or fewer votes than the ballots support. An option missing from one side shows `—`.

Which checks fail tells you what changed:

| Failing checks                                   | Most likely cause                                                                                                                                    |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `merkleRoot`, `tallyHash`, maybe `resultSummary` | Ballots were added, removed, or changed after anchoring. Or this is the wrong dataset (a different session, or the wrong `--dataset-url`).           |
| `merkleRoot` only                                | The ballots changed in a way that keeps the same tally, such as two voters' choices swapped.                                                         |
| `tallyHash` only                                 | The ballots match, but the anchored tally does not follow from them. The platform anchored a tally that is not the correct count of its own ballots. |
| `resultSummary` only                             | Both hashes match, but the human-readable result the platform shows is not the anchored one. The per-option lines show the difference.               |

When only `tallyHash` fails, the report says which side is wrong:

- If the result summary matches the recomputed tally, the on-chain `tallyHash` commits to a different tally.
- Without a summary (no `--platform`), there are no per-option numbers to show, because the chain stores only a hash.

A FAIL is also reported, with no checks, when the dataset itself is unusable:

| Reason                        | Meaning                                                                                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INVALID_DATASET: …`          | The dataset breaks a rule of the [canonical schema](canonical-schema-v1.md), such as an unknown option id, a missing voter number, or a duplicate ranking. |
| `BUDGET_EXCEEDED: …`          | A quadratic ballot spends more than `voiceCredits` (Σ votes² > budget). A valid quadratic session can never contain one.                                   |
| `… did not return valid JSON` | The dataset URL returned something that is not JSON.                                                                                                       |

### NOT_ANCHORED

```text
NOT_ANCHORED: the platform has no anchor record for this session
```

There is nothing to verify yet. The reason says which of three cases applies:

| Reason                                                             | Meaning                                                                                                                     |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `the platform has no anchor record for this session`               | The metadata endpoint returned `404`. The session does not exist, is still open, or was never anchored.                     |
| `the platform reports anchorStatus … with no registry address yet` | The commitment is computed but not yet on chain (`PENDING` or `COMPUTED`), or anchoring failed (`FAILED`). Try again later. |
| `0x… has no commitment for this session`                           | The registry was read and has nothing for this `sessionId`. Check the session id, the network, and the registry address.    |

If the platform shows a session as anchored but the registry has no commitment, that is a discrepancy worth reporting.

### UNSUPPORTED

The dataset declares a `schemaVersion` this verifier does not implement. This is not a failure: the session was probably anchored under a newer schema. Upgrade and run again:

```bash
npx @civicue/voting-anchor-verifier@latest verify …
```

### Errors

Errors go to stderr as `error: …`, with exit code `4` and no verdict.

| Message                                                            | Fix                                                                                                    |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `--session is required`, `--network must be one of …`              | Add the missing argument.                                                                              |
| `session id must be 24 hex characters`                             | Pass the 24-character session id string, not the `bytes32` `sessionId`.                                |
| `pass --platform (or --contract) to locate the session's registry` | Add `--platform`, or `--contract` with `--dataset-url`.                                                |
| `session was anchored on chain 84532, not base (8453)`             | The metadata says another network. Use the `--network` it names.                                       |
| `RPC endpoint is on chain …, expected …`                           | `--rpc-url` points at another chain.                                                                   |
| `could not fetch metadata` / `could not fetch dataset`             | The endpoint is unreachable or returned a non-404 error status. Check the URL and retry.               |
| `could not read 0x… on …`                                          | The RPC call failed, or the address is not an `AnchorRegistry`. Check the address and try another RPC. |

## Exit codes

| Code | Outcome      |
| ---- | ------------ |
| `0`  | PASS         |
| `1`  | FAIL         |
| `2`  | NOT_ANCHORED |
| `3`  | UNSUPPORTED  |
| `4`  | Error        |

Each outcome has its own code, so a script can tell a tampered result (`1`) from one that is not anchored yet (`2`) or from a verifier that needs an upgrade (`3`):

```bash
npx @civicue/voting-anchor-verifier@0.1.0 verify --session "$ID" --network base --platform "$PLATFORM" --json > report.json
case $? in
  0) echo "verified" ;;
  1) echo "MISMATCH: see report.json" >&2; exit 1 ;;
  2) echo "not anchored yet; retry later" ;;
  3) echo "upgrade the verifier" >&2; exit 1 ;;
  *) echo "could not verify" >&2; exit 1 ;;
esac
```

## JSON output

`--json` prints the same report as a single JSON object. `bigint` values (`timestamp`, `blockNumber`) are printed as decimal strings. The fields are:

| Field                       | Present                    | Content                                                                                                                                                                          |
| --------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `outcome`                   | always                     | `PASS`, `FAIL`, `NOT_ANCHORED`, or `UNSUPPORTED`. Errors are not reported as JSON.                                                                                               |
| `reason`                    | unless PASS                | One sentence on why.                                                                                                                                                             |
| `session`                   | always                     | `{ id, sessionId }`.                                                                                                                                                             |
| `network`, `chainId`        | always                     | The network that was read.                                                                                                                                                       |
| `contract`                  | once resolved              | The registry address that was read.                                                                                                                                              |
| `metadataUrl`, `datasetUrl` | when used                  | The URLs fetched.                                                                                                                                                                |
| `onChain`                   | once read                  | `{ merkleRoot, tallyHash, timestamp, blockNumber }` from `getAnchor`.                                                                                                            |
| `recomputed`                | once computed              | `{ schemaVersion, dataset, merkleRoot, tally, tallyHash }`. `dataset` is the normalized dataset, and `tally` is the full canonical tally, including every `RANKED_CHOICE` round. |
| `checks`                    | always                     | `[{ name, ok, expected?, actual? }]`. `expected` is the on-chain value, and `actual` is the recomputed one.                                                                      |
| `resultDiff`                | when the summary disagrees | `{ options: [{ id, published, recomputed }], winner?, turnout? }`.                                                                                                               |
| `warnings`                  | always                     | Things to be aware of that did not change the outcome.                                                                                                                           |

`recomputed.tally` is the most useful field for an audit: it is the exact object that was hashed into `tallyHash`.

## Using it as a library

The CLI is a thin wrapper around `verifySession`. The library also exposes the pieces separately:

```ts
import {
  computeCommitment,
  formatReport,
  sessionIdToBytes32,
  verifySession,
} from "@civicue/voting-anchor-verifier";

const report = await verifySession({
  session: "6650a3b2c1d0e9f8a7b6c5d4",
  network: "base",
  platform: "https://api.example.org",
  // contract, datasetUrl, rpcUrl: same as the CLI flags
});
if (report.outcome !== "PASS") console.error(formatReport(report));

// Recompute without any network access:
const { merkleRoot, tallyHash, tally } = computeCommitment(datasetJson);
const key = sessionIdToBytes32("6650a3b2c1d0e9f8a7b6c5d4");
```

`verifySession` returns `PASS`, `FAIL`, `NOT_ANCHORED`, and `UNSUPPORTED` as a report, and throws `VerifyError` where the CLI exits with `4`.

## Trying it locally

You can run the whole flow without Base or a real platform.

The quickest way is the [mock platform](../../mock-platform)'s devnet. It anchors a session for every voting method and edge case, serves the verification API, and prints a `verify` command for each session:

```bash
pnpm --filter @civicue/voting-anchor-mock-platform devnet
```

The verifier's own end-to-end tests also run against a local chain:

- Install [Foundry](https://getfoundry.sh).
- Build the contracts: `pnpm --filter @civicue/voting-anchor-contracts build`.
- Run the end-to-end tests: `pnpm --filter @civicue/voting-anchor-verifier test`. The tests in `test/e2e.test.ts` do the following:
  - start `anvil` with Base Sepolia's chain id;
  - deploy `AnchorRegistry` and anchor the commitments of some conformance vectors;
  - serve the [verification API](verification-api.md) from a local HTTP server;
  - run the built CLI against them for PASS, a tampered dataset (FAIL), and an unanchored session (NOT_ANCHORED).

To try it by hand instead, build both packages, then run these steps from the repository root.

1. Start a local chain that poses as Base Sepolia. It prints its funded accounts; `<account0>` below is the first one.

   ```bash
   anvil --chain-id 84532   # in its own terminal
   ```

2. Deploy the registry, with `<account0>` as both owner and relayer. Note the `Deployed to:` address.

   ```bash
   (cd packages/contracts && forge create src/AnchorRegistry.sol:AnchorRegistry --broadcast \
     --rpc-url http://127.0.0.1:8545 --unlocked --from <account0> \
     --constructor-args <account0> <account0>)
   ```

3. Copy a conformance vector's dataset and compute its commitment:

   ```bash
   mkdir -p /tmp/anchor-demo
   node -e 'const v = require("./packages/verifier/vectors/v1/majority/basic.json");
     require("fs").writeFileSync("/tmp/anchor-demo/ballots.json", JSON.stringify(v.dataset, null, 2))'
   node --input-type=module -e '
     import { readFileSync } from "node:fs";
     import { computeCommitment, sessionIdToBytes32 } from "./packages/verifier/dist/index.js";
     const c = computeCommitment(JSON.parse(readFileSync("/tmp/anchor-demo/ballots.json", "utf8")));
     console.log(sessionIdToBytes32("65f1c2a9e4b0d3f7a8c91e20"), c.merkleRoot, c.tallyHash);'
   ```

4. Anchor it, using the three values printed above:

   ```bash
   cast send <registry> "anchor(bytes32,bytes32,bytes32)" <sessionId> <merkleRoot> <tallyHash> \
     --rpc-url http://127.0.0.1:8545 --unlocked --from <account0>
   ```

5. Serve the dataset (`python3 -m http.server 8000 --directory /tmp/anchor-demo` in another terminal) and verify it:

   ```bash
   node packages/verifier/dist/cli.js verify --session 65f1c2a9e4b0d3f7a8c91e20 --network base-sepolia \
     --rpc-url http://127.0.0.1:8545 --contract <registry> \
     --dataset-url http://127.0.0.1:8000/ballots.json
   ```

Change one ballot in `/tmp/anchor-demo/ballots.json` and run step 5 again to see a FAIL.
