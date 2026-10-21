# civicue-voting-anchor

**English** | [繁體中文](README.zh-TW.md)

Open-source on-chain anchor and verifier for CiviCue voting results.

After a voting session closes, the CiviCue platform publishes an anonymized ballot dataset and anchors a commitment to it (`merkleRoot` + `tallyHash`) on Base. This repo contains everything a third party needs to check that commitment independently:

- `packages/contracts`: the `AnchorRegistry` Solidity contract (Foundry). It stores one write-once commitment per session.
- `packages/verifier`: a TypeScript library and `verify` CLI. It recomputes the Merkle root and the method-aware tally from the published dataset and compares them to the on-chain record.

The voting system itself stays closed source. What is open here is the contract, the canonical ballot schema, and the verifier.

The interface contracts the platform implements are specified here:

- [Canonical ballot schema](packages/verifier/docs/canonical-schema-v1.md): the dataset format, leaf hashing, Merkle tree, and tally serialization, pinned by [conformance vectors](packages/verifier/vectors).
- [Public verification API](packages/verifier/docs/verification-api.md): the metadata and dataset endpoints.

To verify a session:

```bash
npx @civicue/voting-anchor-verifier verify --session <id> --network base --platform <platform-api-base-url>
```

## What a passing verification proves

- The published result has not been altered since it was anchored.
- The result is the correct tally of the **published** ballots under the session's voting method (majority, quadratic, or ranked choice).

See [How verification works](packages/verifier/docs/how-it-works.md) for why a PASS can be trusted, and the [CLI guide](packages/verifier/docs/cli.md) for detailed usage.

## Development

Requires Node `^24.16.0`, pnpm 10, and [Foundry](https://getfoundry.sh) (for `packages/contracts`).

```bash
git submodule update --init --recursive
pnpm install
pnpm build
pnpm test
```

[`packages/mock-platform`](packages/mock-platform) is a mock of the platform's anchoring pipeline (voting, producer, worker, and verification API), built from the public docs. It runs a local devnet the verifier can be pointed at.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md). Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

Apache-2.0
