# @civicue/voting-anchor-contracts

[English](README.md) | **繁體中文**

`AnchorRegistry`：部署在 Base 上、每個場次只能寫入一次的投票承諾（`merkleRoot` + `tallyHash`）登錄合約。這個套件也發布合約的型別化 ABI、部署紀錄，以及驗證工具與 CiviCue 平台共用的 `sessionId` 編碼 fixture。

## 合約

| 函式                                       | 呼叫者           | 行為                                                                                       |
| ------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------ |
| `anchor(sessionId, merkleRoot, tallyHash)` | relayer          | 每個場次儲存一次 `{ merkleRoot, tallyHash, timestamp, blockNumber }`；發出 `Anchored` 事件 |
| `getAnchor(sessionId)`                     | 任何人           | 回傳承諾；`timestamp == 0` 表示尚未錨定                                                    |
| `setRelayer(newRelayer)`                   | owner            | 更換 relayer；`address(0)` 會停用所有寫入；發出 `RelayerUpdated` 事件                      |
| `transferOwnership` / `acceptOwnership`    | owner / 新 owner | 兩階段移交所有權（`Ownable2Step`）                                                         |
| `renounceOwnership()`                      | —                | 一律以 `RenounceDisabled()` revert                                                         |

Revert 錯誤：`NotRelayer()`、`AlreadyAnchored(bytes32 sessionId)`、`ZeroCommitment()`、`RenounceDisabled()`。

`sessionId` 是 24 位十六進位場次 id 的 `keccak256(bytes(lowercaseSessionIdString))`；見 [`fixtures/session-id.json`](fixtures/session-id.json)。

## 開發

需要 [Foundry](https://getfoundry.sh)、Node `^24.16.0` 與 pnpm 10。相依套件以 git submodule 管理：

```bash
git submodule update --init --recursive
pnpm install
pnpm --filter @civicue/voting-anchor-contracts build   # forge build + ABI codegen + tsc
forge test                                             # 單元、情境與 invariant 測試（在 packages/contracts 下執行）
pnpm --filter @civicue/voting-anchor-contracts test:integration   # anvil + viem，PATH 中需要有 anvil
forge coverage --no-match-coverage "(test|script)/"
```

### 相依套件版本

每個 submodule 都鎖定在一個 release tag 上，commit 對不上時 CI 會失敗：

| Submodule                    | Tag       |
| ---------------------------- | --------- |
| `lib/openzeppelin-contracts` | `v5.7.0`  |
| `lib/forge-std`              | `v1.17.0` |

`git submodule update` 只會 checkout 這些鎖定的 commit，不會抓上游最新的內容。請勿執行 `forge update` 或 `git submodule update --remote`。要升級時，把 submodule 移到新的 tag，並在同一個 PR 裡更新 `.github/workflows/contracts.yml` 與上表中的 tag：

```bash
git -C lib/openzeppelin-contracts fetch --tags
git -C lib/openzeppelin-contracts checkout v5.8.0
git -C lib/openzeppelin-contracts submodule update --init --recursive
git add lib/openzeppelin-contracts
```

## 部署

registry 有兩個角色，都在 constructor 中設定：

- **owner**：由營運方控制的地址。它可以更換 relayer，也可以分兩步移交擁有權。
- **relayer**：唯一獲得授權的 ERC-4337 帳戶，也是唯一能呼叫 `anchor(...)` 的地址。registry 也由它透過 CREATE2 deployer proxy（`ts/create2.ts`，以 `create2Deployment` 匯出）以隨機 salt 部署。

這個 repo 裡沒有任何金鑰或簽章設定；合約只檢查 `msg.sender`。

每個支援的網路各有一份部署：

| 網路                 | `--rpc-url`    | 部署紀錄                 |
| -------------------- | -------------- | ------------------------ |
| Base Sepolia (84532) | `base_sepolia` | `deployments/84532.json` |
| Base mainnet (8453)  | `base`         | `deployments/8453.json`  |

### 本機部署

先啟動 anvil，再用任意兩個地址當作 owner 與 relayer 部署：

```bash
anvil
INITIAL_OWNER=0x… INITIAL_RELAYER=0x… \
  forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --unlocked --sender <addr> --broadcast
```

### 部署紀錄

每次部署到 Base 都會 commit `deployments/<chainId>.json`：

| 欄位                               | 意義                                      |
| ---------------------------------- | ----------------------------------------- |
| `address`、`deployBlock`、`txHash` | registry 部署的位置與時間                 |
| `owner`、`relayer`                 | constructor 設定的角色                    |
| `factory`、`salt`                  | CREATE2 proxy 與 salt，可用來重新算出地址 |
| `gitCommit`、`solcVersion`、`abi`  | 產生這份 bytecode 的確切原始碼與編譯器    |

每次部署的原始碼都會在 Basescan 與 Sourcify 上驗證。任何人都能在不信任紀錄的情況下確認它：確認區塊瀏覽器在 `address` 顯示已驗證的原始碼，並確認鏈上的 `owner()` 與 `relayer()` 和紀錄一致（relayer 之後可能更換過，請看 `RelayerUpdated` 事件）。

### owner 操作

owner 操作放在 `script/Ops.s.sol`，每一個都會先模擬再送出。請傳入 owner 金鑰需要的簽章參數，以下用 `--account <name>` 當作範例：

```bash
REGISTRY=0x… NEW_RELAYER=0x… forge script script/Ops.s.sol:SetRelayer --rpc-url base_sepolia --account <name> --broadcast
REGISTRY=0x… NEW_OWNER=0x…   forge script script/Ops.s.sol:TransferOwnership --rpc-url base_sepolia --account <name> --broadcast
REGISTRY=0x…                 forge script script/Ops.s.sol:AcceptOwnership --rpc-url base_sepolia --account <name> --broadcast   # 由新的 owner 簽署
```

`NEW_RELAYER=0x0000000000000000000000000000000000000000` 會停用所有寫入。relayer 或合約遭入侵時不會就地修復：registry 可以拋棄，營運方會重新部署並重新錨定。

## 使用這個套件

```ts
import { anchorRegistryAbi } from "@civicue/voting-anchor-contracts";
import baseSepolia from "@civicue/voting-anchor-contracts/deployments/84532.json" with { type: "json" };
import sessionIdFixture from "@civicue/voting-anchor-contracts/fixtures/session-id.json" with { type: "json" };
```

registry 是可拋棄的：重新部署會取代 `deployments/<chainId>.json`。請依每個場次，從平台的 `anchorContract` 欄位取得地址，不要寫死某一個地址。

部署時，這個套件也提供 creation bytecode、它的 build 資訊，以及 CREATE2 輔助函式：

```ts
import {
  FACTORY,
  anchorRegistryBuild,
  create2Deployment,
} from "@civicue/voting-anchor-contracts";

// relayer 把 `data` 送到 FACTORY；registry 會部署在 `address`。
const { data, address } = create2Deployment(owner, relayer, salt);
// anchorRegistryBuild.solcVersion 與 .gitCommit 寫進部署紀錄。
```
