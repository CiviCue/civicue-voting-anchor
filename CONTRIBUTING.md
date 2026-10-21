# Contributing

**English** | [繁體中文](CONTRIBUTING.zh-TW.md)

Thanks for helping make CiviCue's vote anchor easier to verify. Bug reports, independent verifier implementations, and doc fixes are all welcome.

## Setup

Requires Node `^24.16.0`, pnpm 10, and [Foundry](https://getfoundry.sh).

```bash
git submodule update --init --recursive
pnpm install
pnpm build
pnpm test
```

## Making a change

- Open an issue first for anything larger than a small fix, so the approach can be agreed before you write code.
- Use [Conventional Commits](https://www.conventionalcommits.org) for commit messages and PR titles.
- Keep CI green: contract tests with 100% line coverage, gas snapshot, Slither, verifier and mock-platform tests, Prettier, and the leak guard.
- A change to the canonical schema or the tally rules must come with conformance vectors, because the platform runs the same vectors and both sides must agree byte for byte.
- User-facing docs ship in English and Traditional Chinese. If you can only write one, say so in the PR and a maintainer will add the other.

## What this repository holds

This repository holds only the open parts of the anchor: the contract, the canonical schema, the verifier, and their docs. The CiviCue platform is closed source, and operational details of how it is run are not part of this repository. The `leak-guard` check enforces this. If it flags a line in your PR, a maintainer will help you reword it.

## Security issues

Do not open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).
