# How verification works

**English** | [繁體中文](how-it-works.zh-TW.md)

This document explains why a PASS from the verifier can be trusted: what the platform commits to, why it cannot change that commitment later, and why the verifier can check it without trusting the platform. For how to run the verifier, see the [CLI guide](cli.md).

## The claim

After a voting session closes, the CiviCue platform publishes the session's ballots (anonymized) and its result. A PASS establishes two things:

1. **Integrity:** neither the published ballots nor the result have changed since they were anchored on-chain.
2. **Correctness:** the result is the correct tally of the published ballots under the session's voting method (majority, quadratic, or ranked choice).

## Who controls what

| Party                            | Controls                                                                                      | Trusted by the verifier for                                                       |
| -------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| CiviCue platform (closed source) | The voting itself, the published dataset, the metadata API, and the relayer key that anchors. | Nothing. Every value it serves is either recomputed or checked against the chain. |
| `AnchorRegistry` on Base         | One write-once `(merkleRoot, tallyHash, timestamp, blockNumber)` record per session.          | The commitment, and when it was made.                                             |
| This verifier (open source)      | The recomputation: canonical form, hashing, and the tally rules of each voting method.        | Itself, which anyone can read, run, and reimplement.                              |

The verifier treats the platform as a potential adversary. The only thing it takes from the platform without checking is _where_ to look: the registry address and the dataset URL. Both can be overridden (`--contract`, `--dataset-url`). A wrong dataset URL produces a FAIL, and the registry address can be confirmed against the published deployment record (see [Confirming the registry](cli.md#confirming-the-registry)).

## The open/closed boundary

The platform is closed source. This repository is open. The platform **produces** artifacts that the open side can **independently reproduce**:

| Closed (CiviCue platform)                                                             | Open (this repository)                          |
| ------------------------------------------------------------------------------------- | ----------------------------------------------- |
| The voting engine, identity, and eligibility                                          | `AnchorRegistry`, the Base contract             |
| Collecting and anonymizing ballots into the dataset                                   | The [canonical schema](canonical-schema-v1.md)  |
| Computing the tally and the commitment                                                | The method-aware tally and Merkle recomputation |
| Serving the [verification API](verification-api.md) and anchoring through the relayer | The verifier library and CLI                    |

The only shared, trust-critical asset is the canonical schema and its hashing rules, and those are open. Nothing on the closed side has to be trusted for a PASS to mean what it says.

## The commitment

When a session closes, the platform computes two 32-byte hashes from the ballots and writes them to the registry. The [canonical schema](canonical-schema-v1.md) defines every step. Here is the `vectors/v1/quadratic/basic.json` session worked through (3 voters, budget 10 voice credits, options A, B, C).

**1. Normalize each ballot and serialize it as canonical JSON.** Keys are sorted, there is no whitespace, and zero allocations are dropped:

```text
{"allocations":{"A":2,"B":1},"voter":1}
{"allocations":{"C":3},"voter":2}
{"allocations":{"A":1,"B":1,"C":2},"voter":3}
```

**2. Hash each ballot into a leaf**, prefixed with the schema tag:

```text
leaf = keccak256("civicue.ballot.v1" ‖ 0x00 ‖ canonicalJson(row))

leaf1 = 0x57eb90783a839e6f13052b7377df13156ad96862cc03212ee625420938b16123
leaf2 = 0xd59a242e2950fb5c58ddfaf23634098fc845cb92081f609387bf30af051ba5f7
leaf3 = 0x16837d525a4e1eb9244012de1abb9ccfbe614b6c92cb0af5a6a9c7bf305eabec
```

**3. Build a Merkle tree over the leaves**, in voter order. The odd leaf moves up unchanged:

```text
node = keccak256(0x01 ‖ left ‖ right)

n12        = node(leaf1, leaf2) = 0x638e5e4225fd6679a560f363b48b2b3db8d7c1104c2b925424a239fa2e6dffe7
merkleRoot = node(n12, leaf3)   = 0x39e8eb44d1f1c0ed4da7c2dd465162f7962c6bf2db7a4bb5f4817e5d1a06ffa5
```

**4. Tally the ballots under the voting method, and hash the canonical tally.** Each ballot is within budget (2²+1² = 5, 3² = 9, 1²+1²+2² = 6, all ≤ 10):

```text
{"ballotCount":3,"schemaVersion":1,"totals":{"A":3,"B":2,"C":5},"voiceCredits":10,"votingMethod":"QUADRATIC","winners":["C"]}

tallyHash = keccak256(canonicalJson(tally)) = 0x924f90f43511876e459b2df5976472a479707d65c1b4cf53dfd134d725650d70
```

**5. Anchor:** the relayer calls `AnchorRegistry.anchor(sessionId, merkleRoot, tallyHash)`, where `sessionId = keccak256(bytes("6650a3b2c1d0e9f8a7b6c5d4"))`.

The verifier repeats steps 1–4 from the published dataset, reads step 5 back from the chain, and compares.

## Why a PASS can be trusted

Each part of the argument rests on one design property.

### The chain value cannot change after anchoring

`AnchorRegistry` has no function that modifies or deletes a commitment:

- `anchor` reverts with `AlreadyAnchored` if the session already has a record.
- The owner can only rotate the relayer address. It cannot touch existing records.
- The registry is not upgradeable. A redeployment is a new contract at a new address, and the old records stay where they were.
- `timestamp` and `blockNumber` are set by the contract from the block, not by the caller.

So the platform's commitment is fixed at a public, timestamped moment. Rewriting it would mean rewriting Base's history.

### The verifier takes the hashes only from the chain

The metadata endpoint also returns `merkleRoot` and `tallyHash`, but the verifier ignores them. It reads the commitment with `getAnchor` and recomputes everything else locally. It also checks that the RPC endpoint is on the expected chain, so a misconfigured endpoint cannot substitute another chain's state. If you don't trust the default public RPC, use your own node with `--rpc-url`.

### A hash binds exactly one dataset

keccak256 is collision-resistant: nobody can feasibly find two different inputs with the same hash. So once `merkleRoot` is fixed, the only dataset that reproduces it is the one that was anchored. Any change to any ballot changes its leaf, which changes every node above it up to the root.

Canonicalization makes this work in both directions:

- **Deterministic:** the same logical dataset always produces the same bytes, whatever the key order, whitespace, or ballot order of the copy you downloaded. An honest copy, such as a mirror or an archive, always verifies.
- **Unambiguous:** every rule (sorting, zero-dropping, integer-only numbers) has exactly one outcome. Two implementations cannot disagree about which bytes were meant, which would otherwise give a cheater room to claim "a different encoding".

### The tree cannot be tricked

The tree design closes the known Merkle tree pitfalls:

- **Domain separation.** A leaf preimage starts with `c` (from `civicue.ballot.v1`), and a node preimage starts with `0x01`. An internal node can never be passed off as a ballot, or the other way round.
- **No duplication.** An unpaired node moves up unchanged instead of being paired with itself. In trees that duplicate, `[a, b, c]` and `[a, b, c, c]` have the same root, so a ballot could be added without changing the root. Here they differ.
- **Contiguous voters.** `voter` must be exactly `1..n`, each once, and the leaves are ordered by it. So the number of ballots and their positions are committed, and `ballotCount` in the tally must agree.

### The verifier computes the result itself

The verifier does not check that the platform's tally _looks_ plausible. It runs the voting rules on the ballots and hashes the output:

- `MAJORITY` counts every selection.
- `QUADRATIC` first rejects any ballot whose Σ votes² exceeds `voiceCredits`, then sums the votes.
- `RANKED_CHOICE` replays the instant runoff round by round, with fully specified tie-breaking.

If the recomputed `tallyHash` matches the chain, the anchored tally is the correct result of these ballots. A platform that anchored the honest ballots but a different result fails `tallyHash`, even though `merkleRoot` passes.

The tally includes everything that determines the result:

- `schemaVersion` and `votingMethod`, so the same ballots cannot be reinterpreted under other rules;
- `voiceCredits` for quadratic voting, so the budget cannot be changed after the fact;
- every round of a ranked-choice count, including eliminations and exhausted ballots.

### The version is bound into both hashes

The schema version is in the leaf tag (`civicue.ballot.v1`) and in the tally (`"schemaVersion":1`). Declaring a different version changes both hashes (see `vectors/v1/version-binding`). A dataset therefore cannot be re-labelled with a newer version to have different rules applied. A version this verifier does not know is reported as UNSUPPORTED, never guessed at.

### What people read is tied to what was anchored

People read results on the platform, not as hashes. The `resultSummary` check compares the platform's published `result` (winner, turnout, per-option votes) with the recomputed tally, exactly. So the numbers shown to people cannot quietly differ from the numbers anchored.

For ranked choice, the summary lists only the options in the final round, with their final-round counts. The full elimination history is not lost: it is part of the tally, committed by `tallyHash` and recomputed by the verifier, and `--json` prints it (`recomputed.tally.rounds`).

### Anyone can check the checker

- The verifier is a small, dependency-light TypeScript package. It has no network writes and no keys.
- The [conformance vectors](../vectors) pin the exact hashes for each method and its edge cases. The platform's producer runs the same vectors in its CI, so the producer and the verifier are two implementations that must agree byte for byte.
- Each step uses standard primitives, so it can be reproduced with other tools. For example, `cast keccak` reproduces any leaf from its canonical JSON.
- Anyone can write an independent verifier from the [schema](canonical-schema-v1.md) and the [API](verification-api.md) alone.

## What each kind of tampering triggers

| Change made after anchoring                                 | Detected by                                           |
| ----------------------------------------------------------- | ----------------------------------------------------- |
| A ballot's choice is changed                                | `merkleRoot`, usually `tallyHash` and `resultSummary` |
| Two voters' ballots are swapped (same totals)               | `merkleRoot`                                          |
| A ballot is added or removed                                | `merkleRoot`, `tallyHash`                             |
| The published result differs from the anchored one          | `resultSummary`                                       |
| The anchored result is not the correct count of the ballots | `tallyHash`                                           |
| A quadratic ballot spends more than its budget              | `BUDGET_EXCEEDED`                                     |
| The quadratic budget or the voting method is changed        | `tallyHash`                                           |
| A dataset is relabelled with another schema version         | `merkleRoot`, `tallyHash`                             |
| The on-chain record is changed                              | Impossible: the registry is write-once.               |

## Two levels of verification

Anyone, whether a voter, a journalist, or an auditor, can check a closed session at one of two levels. Both use only public data.

**Level 1: the result was not altered after publication.** Follow the session's `anchorTxHash` to a block explorer. The transaction exists, it is timestamped, and the registry is write-once, so the platform committed to this `(merkleRoot, tallyHash)` at that moment and cannot change it. This needs no tooling, but it does not show that the committed result is correct.

**Level 2: the result is the correct tally.** Run the verifier:

```bash
npx @civicue/voting-anchor-verifier verify --session <id> --network base --platform <platform-api-base-url>
```

It recomputes `merkleRoot` and `tallyHash` from the published ballots, compares them with the chain, and compares the published result with its own tally, as described above. For quadratic voting this includes the per-ballot budget check, which is why the dataset publishes anonymized per-ballot rows rather than only per-option totals.

| Attack                                             | Stopped by                                    |
| -------------------------------------------------- | --------------------------------------------- |
| Changing a result after it was published           | Level 1 (the chain record is immutable)       |
| Miscounting, or changing the counting rules        | Level 2 (the tally is recomputed in the open) |
| Quadratic ballots over budget                      | Level 2 (per-ballot budget check)             |
| Fabricating or dropping ballots before publication | Not stopped (see below)                       |

## What a PASS does not prove

- **That the published ballots are every real vote.** A PASS shows that the published ballots are unaltered and correctly tallied. It does not show that they are authentic: an operator could publish a self-consistent fabricated set, and it would verify. There are no inclusion receipts or voter signatures, so ballot-set authenticity rests on the operator's reputation, not on cryptography.
- **That the dataset will stay available.** The platform serves the dataset from its own API. If it stops serving it, a session cannot be re-verified from that source. Integrity does not depend on the platform, though: any copy, such as an archive, verifies against the on-chain root (`--dataset-url`).
- **Anything about sessions that were never anchored.** A void session, one that closed with zero turnout, has no ballots to verify and is never anchored. Its metadata endpoint returns `404`.
