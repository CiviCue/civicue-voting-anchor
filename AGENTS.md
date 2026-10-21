# Agent instructions

This repository is **public**. It is the open-source half of CiviCue's on-chain vote anchor: the `AnchorRegistry` contract, the canonical ballot schema, the verifier, and a mock of the platform for local rehearsal. The CiviCue platform itself is closed source.

## What belongs here

Only what a verifier, auditor, or contributor needs to understand, reproduce, or build on the anchor's guarantee:

- the contract, its tests, the local-anvil deploy, signer-agnostic owner scripts, and committed `deployments/<chainId>.json` records
- the canonical schema, the conformance vectors, and the verifier library and CLI
- the public verification API definition and the public trust-model docs under `packages/verifier/docs/`

## What does not belong here

Never write any of the following into any file here, including code comments, docs, tests, commit messages, and PR descriptions:

- the CiviCue platform's implementation details
- how the operator keys are custodied, or which vendor provides the relayer
- the operator's infrastructure, accounts, identifiers, or costs
- plans for future work
- credentials of any kind, real or realistic-looking

That material is kept outside this repository, with the maintainers. Describe the operator only through the on-chain role model: an operator-controlled `owner` and a single authorized ERC-4337 `relayer`. When unsure whether something is public, leave it out and ask a maintainer.

## Leak guard

The `leak-guard` workflow runs on every PR and on `main`:

- **gitleaks** for secrets, configured in `.gitleaks.toml`.
- **Public deny-list** (`.github/leak-guard/denylist.txt`): forbidden file paths. A hit means the file must not exist here.
- **Private deny-list** (a CI secret): patterns for material that does not belong in this public repository. A hit is reported only as `file:line` and a pattern number, so the pattern stays private. Reword the line; a maintainer can tell you what the pattern number covers. Never try to work out or print the private patterns.

Run it locally with `node scripts/leak-guard.ts --all` (the private tier is skipped without the secret).

## Conventions

- TypeScript only for JS-side code (`.ts`, run directly by Node 24); never create `.js` files.
- Conventional Commits.
- Solidity: NatSpec on public/external functions.
- The verifier is read-only; it never sends transactions.
- Docs use neutral roles ("maintainer", "operator"), never personal names. User-facing docs ship in English and Traditional Chinese (`*.zh-TW.md`).
- Do not add a spec workflow or planning artifacts (proposals, design docs, task lists) to this repository. Design records are kept outside this repository, with the maintainers.
