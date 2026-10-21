# @civicue/voting-anchor-contracts

**English** | [繁體中文](README.zh-TW.md)

`AnchorRegistry`: a write-once, per-session registry of voting commitments (`merkleRoot` + `tallyHash`) on Base. This package also publishes the contract's typed ABI, its deployment records, and the `sessionId` encoding fixture shared with the verifier and the CiviCue platform.

## Contract

| Function                                   | Caller       | Behavior                                                                                      |
| ------------------------------------------ | ------------ | --------------------------------------------------------------------------------------------- |
| `anchor(sessionId, merkleRoot, tallyHash)` | relayer      | Stores `{ merkleRoot, tallyHash, timestamp, blockNumber }` once per session; emits `Anchored` |
| `getAnchor(sessionId)`                     | anyone       | Returns the commitment; `timestamp == 0` means not anchored                                   |
| `setRelayer(newRelayer)`                   | owner        | Rotates the relayer; `address(0)` disables all writes; emits `RelayerUpdated`                 |
| `transferOwnership` / `acceptOwnership`    | owner / next | Two-step ownership handover (`Ownable2Step`)                                                  |
| `renounceOwnership()`                      | —            | Always reverts `RenounceDisabled()`                                                           |

Reverts: `NotRelayer()`, `AlreadyAnchored(bytes32 sessionId)`, `ZeroCommitment()`, `RenounceDisabled()`.

`sessionId` is `keccak256(bytes(lowercaseSessionIdString))` of the 24-hex session id; see [`fixtures/session-id.json`](fixtures/session-id.json).

## Development

Requires [Foundry](https://getfoundry.sh), Node `^24.16.0`, and pnpm 10. Dependencies are git submodules:

```bash
git submodule update --init --recursive
pnpm install
pnpm --filter @civicue/voting-anchor-contracts build   # forge build + ABI codegen + tsc
forge test                                             # unit, scenario, invariant (from packages/contracts)
pnpm --filter @civicue/voting-anchor-contracts test:integration   # anvil + viem, needs anvil on PATH
forge coverage --no-match-coverage "(test|script)/"
```

### Dependency versions

Each submodule is pinned to a release tag, and CI fails if its commit does not match:

| Submodule                    | Tag       |
| ---------------------------- | --------- |
| `lib/openzeppelin-contracts` | `v5.7.0`  |
| `lib/forge-std`              | `v1.17.0` |

`git submodule update` checks out these pinned commits; it never pulls the latest upstream. Do not run `forge update` or `git submodule update --remote`. To upgrade, move the submodule to the new tag and update the tag in `.github/workflows/contracts.yml` and in the table above in the same PR:

```bash
git -C lib/openzeppelin-contracts fetch --tags
git -C lib/openzeppelin-contracts checkout v5.8.0
git -C lib/openzeppelin-contracts submodule update --init --recursive
git add lib/openzeppelin-contracts
```

## Deployment

The registry has two roles, both set in the constructor:

- **owner**: an operator-controlled address. It can rotate the relayer and hand over ownership in two steps.
- **relayer**: a single authorized ERC-4337 account, the only address allowed to call `anchor(...)`. It also deploys the registry through the CREATE2 deployer proxy (`ts/create2.ts`, exported as `create2Deployment`) with a random salt.

No key material or signer configuration lives in this repo; the contract checks only `msg.sender`.

Each supported network has its own deployment:

| Network              | `--rpc-url`    | Record                   |
| -------------------- | -------------- | ------------------------ |
| Base Sepolia (84532) | `base_sepolia` | `deployments/84532.json` |
| Base mainnet (8453)  | `base`         | `deployments/8453.json`  |

### Local deploy

Start anvil, then deploy with any two addresses as owner and relayer:

```bash
anvil
INITIAL_OWNER=0x… INITIAL_RELAYER=0x… \
  forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --unlocked --sender <addr> --broadcast
```

### Deployment records

Every Base deployment commits `deployments/<chainId>.json`:

| Field                              | Meaning                                                      |
| ---------------------------------- | ------------------------------------------------------------ |
| `address`, `deployBlock`, `txHash` | Where and when the registry was deployed                     |
| `owner`, `relayer`                 | The constructor's roles                                      |
| `factory`, `salt`                  | The CREATE2 proxy and salt, so the address can be recomputed |
| `gitCommit`, `solcVersion`, `abi`  | The exact source and compiler that produced the bytecode     |

The source of every deployment is verified on Basescan and Sourcify. Anyone can confirm a record without trusting it: check that the explorer shows verified source at `address`, and that `owner()` and `relayer()` on-chain match the record (the relayer may have been rotated since; see the `RelayerUpdated` events).

### Owner operations

`script/Ops.s.sol` holds the owner operations. Each is simulated before broadcast. Pass whatever signer flag the owner key needs; `--account <name>` is an example:

```bash
REGISTRY=0x… NEW_RELAYER=0x… forge script script/Ops.s.sol:SetRelayer --rpc-url base_sepolia --account <name> --broadcast
REGISTRY=0x… NEW_OWNER=0x…   forge script script/Ops.s.sol:TransferOwnership --rpc-url base_sepolia --account <name> --broadcast
REGISTRY=0x…                 forge script script/Ops.s.sol:AcceptOwnership --rpc-url base_sepolia --account <name> --broadcast   # signed by the new owner
```

`NEW_RELAYER=0x0000000000000000000000000000000000000000` disables all writes. A compromised relayer or contract is not repaired in place: the registry is disposable, so the operator redeploys and re-anchors.

## Consuming the package

```ts
import { anchorRegistryAbi } from "@civicue/voting-anchor-contracts";
import baseSepolia from "@civicue/voting-anchor-contracts/deployments/84532.json" with { type: "json" };
import sessionIdFixture from "@civicue/voting-anchor-contracts/fixtures/session-id.json" with { type: "json" };
```

The registry is disposable: a redeploy replaces `deployments/<chainId>.json`. Resolve the address per session from the platform's `anchorContract` field rather than hard-pinning one.

To deploy, the package also exports the creation bytecode, how it was built, and the CREATE2 helper:

```ts
import {
  FACTORY,
  anchorRegistryBuild,
  create2Deployment,
} from "@civicue/voting-anchor-contracts";

// The relayer sends `data` to FACTORY; the registry lands at `address`.
const { data, address } = create2Deployment(owner, relayer, salt);
// anchorRegistryBuild.solcVersion and .gitCommit go into the deployment record.
```
