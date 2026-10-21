# 驗證工具 CLI 使用指南

[English](cli.md) | **繁體中文**

> 本文件譯自英文版。若兩者有出入，以英文版為準。

本指南說明 `voting-anchor-verifier` 指令的所有功能：怎麼執行、每項輸入從哪裡取得、怎麼看輸出，以及遇到各種結果該怎麼做。為什麼 PASS 值得信任，請見[驗證原理](how-it-works.zh-TW.md)。

## 執行

CLI 需要 Node.js 24 以上。它只有一個指令：`verify`。

```bash
npx @civicue/voting-anchor-verifier verify --session <id> --network <base|base-sepolia> --platform <platform-api-base-url>
```

固定版本（建議用於腳本與稽核），或直接安裝：

```bash
npx @civicue/voting-anchor-verifier@0.1.0 verify …
npm install -g @civicue/voting-anchor-verifier && voting-anchor-verifier verify …
```

驗證工具是唯讀的。它只發送 HTTP `GET` 請求，以及 JSON-RPC 的 `eth_chainId` 與 `eth_call` 請求。它從不簽章或送出交易，所以不需要錢包、金鑰或資金。

## 選項

| 選項                   | 必填                                           | 說明                                                                                                         |
| ---------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `verify`               | 是                                             | 指令本身，也是唯一的指令。                                                                                   |
| `--session <id>`       | 是                                             | 場次的 24 字元十六進位 session id，大小寫皆可（使用前先轉小寫）。前後空白會被忽略。                          |
| `--network <name>`     | 是                                             | `base`（chain 8453）或 `base-sepolia`（chain 84532）。                                                       |
| `--platform <url>`     | 除非同時指定了 `--contract` 與 `--dataset-url` | 平台 API 的 base URL，包含路徑前綴（如果有）。必須是 `http` 或 `https`。metadata 與資料集的 URL 由它推導。   |
| `--contract <address>` | 否                                             | 要讀取的 `AnchorRegistry` 地址。會覆寫 metadata 中的 `anchorContract`。                                      |
| `--dataset-url <url>`  | 否                                             | 下載 `ballots.json` 的位置。會覆寫由 `--platform` 推導出的 URL。                                             |
| `--rpc-url <url>`      | 否                                             | JSON-RPC endpoint。預設為該網路的公開 RPC。驗證工具會檢查這個 endpoint 的 chain id 是否與 `--network` 相符。 |
| `--json`               | 否                                             | 以 JSON 輸出完整報告，取代文字輸出。                                                                         |
| `-h`, `--help`         | 否                                             | 顯示用法，並以 `0` 結束。                                                                                    |

## 每項輸入的來源

驗證工具需要三樣東西：registry 地址、鏈上承諾，以及資料集。

| 輸入          | 預設來源                                                              | 覆寫方式        |
| ------------- | --------------------------------------------------------------------- | --------------- |
| Registry 地址 | `GET {platform}/v2/voting/sessions/{id}/anchor` 中的 `anchorContract` | `--contract`    |
| 承諾          | `--network` 上的 `AnchorRegistry.getAnchor(sessionId)`                | （無）          |
| 資料集        | `GET {platform}/v2/voting/sessions/{id}/anchor/dataset`               | `--dataset-url` |

`{id}` 是轉成小寫的場次 id，`sessionId = keccak256(bytes(id))`。兩個 endpoint 由[驗證 API](verification-api.zh-TW.md) 定義。

承諾沒有覆寫方式。它一律取自鏈上，因為鏈是平台唯一無法改寫的來源。

metadata 還帶有 `chainId` 與 `result` 結果摘要：

- 如果 `chainId` 與 `--network` 不符，驗證工具會報錯並停止，而不是去讀錯誤的鏈。
- 如果有取得 metadata，它的 `result` 會與重新計算的計票結果比對。這就是 `resultSummary` 檢查。

### 常見用法

一般用法，所有輸入都來自平台：

```bash
npx @civicue/voting-anchor-verifier verify \
  --session 6650a3b2c1d0e9f8a7b6c5d4 \
  --network base \
  --platform https://api.example.org
```

驗證資料集的封存或鏡像副本。registry 與結果摘要仍由 metadata 提供：

```bash
npx @civicue/voting-anchor-verifier verify \
  --session 6650a3b2c1d0e9f8a7b6c5d4 --network base \
  --platform https://api.example.org \
  --dataset-url https://archive.example.org/ballots.json
```

完全不經過平台，例如平台離線，或你不想依賴平台時。你需要 registry 地址（來自部署紀錄，或 Basescan 上的 `Anchored` 事件）以及一份資料集副本：

```bash
npx @civicue/voting-anchor-verifier verify \
  --session 6650a3b2c1d0e9f8a7b6c5d4 --network base \
  --contract 0x… \
  --dataset-url https://mirror.example.org/ballots.json
```

這個模式會略過 `resultSummary` 檢查並顯示警告，因為沒有公布的摘要可以比對。

`--dataset-url` 接受的是 URL，不是檔案路徑。要驗證本機檔案，請先用 HTTP 提供它，例如 `npx http-server` 或 `python3 -m http.server`。

公開 RPC 有流量限制，或你不想信任它時，請改用自己的 RPC endpoint：

```bash
npx @civicue/voting-anchor-verifier verify … --rpc-url <base-rpc-url>
```

如果 `--contract` 與 metadata 的 `anchorContract` 不一致，以 `--contract` 為準，報告會加上一則警告。如果指定了 `--contract` 而 metadata endpoint 失敗，驗證工具會繼續執行並加上一則警告。

### 確認 registry 地址

若要做完整的獨立檢查，請把報告中的 `registry` 那一行與 CiviCue 公開的部署紀錄比對：

- 部署紀錄在 `packages/contracts/deployments/<chainId>.json`；
- 也以 `@civicue/voting-anchor-contracts/deployments/<chainId>.json` 匯出；
- 合約的已驗證原始碼也可以在 Basescan 上查看。

重新部署會取代紀錄檔。在重新部署前錨定的場次會指向先前的地址，這個地址可以在本 repo 該檔案的歷史紀錄中找到。

## 怎麼看輸出

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

| 欄位          | 說明                                                                             |
| ------------- | -------------------------------------------------------------------------------- |
| `session`     | 正規化後的 id，以及在鏈上查詢用的 `bytes32` 鍵值。                               |
| `registry`    | 實際讀取的合約。如果你不信任 metadata，請與公開的部署地址比對。                  |
| `anchored at` | 承諾寫入時的區塊與時間，取自合約的儲存內容。                                     |
| `schema`      | 資料集宣告的標準格式版本與投票方式。                                             |
| `ballots`     | 資料集的選票筆數（投票人數）。                                                   |
| `winner`      | 重新計算出的勝出者。平手時顯示 `A, B (tie)`，沒有任何選項得票時顯示 `none`。     |
| `Checks`      | `merkleRoot` 與 `tallyHash` 和鏈上比對；`resultSummary` 和平台的 `result` 比對。 |

### FAIL

以下輸出來自驗證一份被改過的資料集副本，其中一張平方投票選票從 `{"C":3}` 被改成 `{"A":3}`：

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

上方的 `winner` 是實際下載的那份資料集的勝出者，不是錨定那份的。括號中的文字說明平台公布的票數比選票支持的多還是少。某個選項只出現在其中一邊時，另一邊顯示 `—`。

從哪些檢查失敗，可以判斷改了什麼：

| 失敗的檢查                                          | 最可能的原因                                                                              |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `merkleRoot`、`tallyHash`，可能還有 `resultSummary` | 錨定之後有選票被新增、刪除或修改。或是用錯了資料集（別的場次，或 `--dataset-url` 指錯）。 |
| 只有 `merkleRoot`                                   | 選票被改過，但計票結果不變，例如兩位投票者的選擇被對調。                                  |
| 只有 `tallyHash`                                    | 選票一致，但錨定的計票結果不是由這些選票算出的。平台錨定了一個與自家選票不符的計票結果。  |
| 只有 `resultSummary`                                | 兩個雜湊都一致，但平台顯示的人類可讀結果不是錨定的那份。各選項那幾行會列出差異。          |

只有 `tallyHash` 失敗時，報告會說明是哪一邊有問題：

- 如果結果摘要與重新計算的結果一致，表示鏈上的 `tallyHash` 承諾的是另一份計票結果。
- 如果沒有摘要（沒有 `--platform`），就無法列出各選項的數字，因為鏈上只存雜湊。

資料集本身無法使用時，也會回報 FAIL，且不列出任何檢查：

| 原因                          | 說明                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| `INVALID_DATASET: …`          | 資料集違反[標準格式](canonical-schema-v1.zh-TW.md)的規則，例如未知的選項 id、缺少投票者編號，或排序重複。 |
| `BUDGET_EXCEEDED: …`          | 某張平方投票選票花費超過 `voiceCredits`（Σ 票數² > 預算）。有效的平方投票場次不可能出現這種選票。         |
| `… did not return valid JSON` | 資料集 URL 回傳的內容不是 JSON。                                                                          |

### NOT_ANCHORED

```text
NOT_ANCHORED: the platform has no anchor record for this session
```

目前還沒有東西可以驗證。原因欄會說明是以下三種情況中的哪一種：

| 原因                                                               | 說明                                                                                      |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `the platform has no anchor record for this session`               | metadata endpoint 回傳 `404`。場次不存在、尚未結束，或從未錨定。                          |
| `the platform reports anchorStatus … with no registry address yet` | 承諾已計算但尚未上鏈（`PENDING` 或 `COMPUTED`），或錨定失敗（`FAILED`）。請稍後再試。     |
| `0x… has no commitment for this session`                           | 已讀取 registry，但其中沒有這個 `sessionId` 的紀錄。請檢查場次 id、網路與 registry 地址。 |

如果平台顯示場次已錨定，registry 中卻沒有承諾，這是值得回報的不一致。

### UNSUPPORTED

資料集宣告的 `schemaVersion` 是這個驗證工具沒有實作的版本。這不是驗證失敗：該場次很可能是以較新的格式錨定的。請升級後再執行一次：

```bash
npx @civicue/voting-anchor-verifier@latest verify …
```

### 錯誤

錯誤會以 `error: …` 的形式輸出到 stderr，結束碼為 `4`，不會給出驗證結果。

| 訊息                                                               | 解法                                                                  |
| ------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `--session is required`、`--network must be one of …`              | 補上缺少的參數。                                                      |
| `session id must be 24 hex characters`                             | 請傳入 24 字元的 session id 字串，不是 `bytes32` 的 `sessionId`。     |
| `pass --platform (or --contract) to locate the session's registry` | 加上 `--platform`，或同時使用 `--contract` 與 `--dataset-url`。       |
| `session was anchored on chain 84532, not base (8453)`             | metadata 指出場次在另一個網路上。請改用它指名的 `--network`。         |
| `RPC endpoint is on chain …, expected …`                           | `--rpc-url` 指向了其他鏈。                                            |
| `could not fetch metadata` / `could not fetch dataset`             | endpoint 無法連線，或回傳了 404 以外的錯誤狀態。請檢查 URL 後重試。   |
| `could not read 0x… on …`                                          | RPC 呼叫失敗，或該地址不是 `AnchorRegistry`。請檢查地址並換一個 RPC。 |

## 結束碼

| 結束碼 | 結果         |
| ------ | ------------ |
| `0`    | PASS         |
| `1`    | FAIL         |
| `2`    | NOT_ANCHORED |
| `3`    | UNSUPPORTED  |
| `4`    | 錯誤         |

每種結果各有自己的結束碼，所以腳本可以分辨結果遭竄改（`1`）、尚未錨定（`2`），以及驗證工具需要升級（`3`）：

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

## JSON 輸出

`--json` 會把同一份報告輸出成單一 JSON 物件。`bigint` 值（`timestamp`、`blockNumber`）以十進位字串輸出。欄位如下：

| 欄位                        | 出現時機     | 內容                                                                                                                                                    |
| --------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `outcome`                   | 一律         | `PASS`、`FAIL`、`NOT_ANCHORED` 或 `UNSUPPORTED`。錯誤不會以 JSON 回報。                                                                                 |
| `reason`                    | 非 PASS 時   | 一句話說明原因。                                                                                                                                        |
| `session`                   | 一律         | `{ id, sessionId }`。                                                                                                                                   |
| `network`、`chainId`        | 一律         | 讀取的網路。                                                                                                                                            |
| `contract`                  | 取得地址後   | 實際讀取的 registry 地址。                                                                                                                              |
| `metadataUrl`、`datasetUrl` | 有使用時     | 下載過的 URL。                                                                                                                                          |
| `onChain`                   | 讀取鏈上後   | 來自 `getAnchor` 的 `{ merkleRoot, tallyHash, timestamp, blockNumber }`。                                                                               |
| `recomputed`                | 計算完成後   | `{ schemaVersion, dataset, merkleRoot, tally, tallyHash }`。`dataset` 是正規化後的資料集，`tally` 是完整的標準計票結果，包含 `RANKED_CHOICE` 的每一輪。 |
| `checks`                    | 一律         | `[{ name, ok, expected?, actual? }]`。`expected` 是鏈上的值，`actual` 是重新計算的值。                                                                  |
| `resultDiff`                | 摘要不一致時 | `{ options: [{ id, published, recomputed }], winner?, turnout? }`。                                                                                     |
| `warnings`                  | 一律         | 需要留意、但不影響結果的事項。                                                                                                                          |

稽核時最有用的欄位是 `recomputed.tally`：它就是被雜湊成 `tallyHash` 的那個物件。

## 當作函式庫使用

CLI 只是 `verifySession` 的一層薄包裝。函式庫也個別提供各個元件：

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
  // contract、datasetUrl、rpcUrl：與 CLI 參數相同
});
if (report.outcome !== "PASS") console.error(formatReport(report));

// 不需任何網路存取即可重新計算：
const { merkleRoot, tallyHash, tally } = computeCommitment(datasetJson);
const key = sessionIdToBytes32("6650a3b2c1d0e9f8a7b6c5d4");
```

`verifySession` 會以報告的形式回傳 `PASS`、`FAIL`、`NOT_ANCHORED` 與 `UNSUPPORTED`；在 CLI 會以 `4` 結束的情況下，它會丟出 `VerifyError`。

## 在本機試用

不需要 Base 或真正的平台，就能跑完整個流程。

最快的方式是 [mock 平台](../../mock-platform/README.zh-TW.md)的 devnet。它會為每種投票方式與邊界情況錨定一個場次、提供驗證 API，並為每個場次印出 `verify` 指令：

```bash
pnpm --filter @civicue/voting-anchor-mock-platform devnet
```

驗證工具自己的端對端測試也會在本機鏈上執行：

- 安裝 [Foundry](https://getfoundry.sh)。
- Build 合約：`pnpm --filter @civicue/voting-anchor-contracts build`。
- 執行端對端測試：`pnpm --filter @civicue/voting-anchor-verifier test`。`test/e2e.test.ts` 中的測試會：
  - 以 Base Sepolia 的 chain id 啟動 `anvil`；
  - 部署 `AnchorRegistry`，並錨定部分 conformance vectors 的承諾；
  - 用本機 HTTP server 提供[驗證 API](verification-api.zh-TW.md)；
  - 對它們執行 build 好的 CLI，涵蓋 PASS、被竄改的資料集（FAIL）與未錨定的場次（NOT_ANCHORED）。

想要手動試，請先 build 兩個套件，然後在 repo 根目錄依序執行以下步驟。

1. 啟動一條假扮 Base Sepolia 的本機鏈。它會印出有資金的帳號；下面的 `<account0>` 是第一個。

   ```bash
   anvil --chain-id 84532   # 在獨立的終端機中執行
   ```

2. 部署 registry，以 `<account0>` 同時作為 owner 與 relayer。記下 `Deployed to:` 後面的地址。

   ```bash
   (cd packages/contracts && forge create src/AnchorRegistry.sol:AnchorRegistry --broadcast \
     --rpc-url http://127.0.0.1:8545 --unlocked --from <account0> \
     --constructor-args <account0> <account0>)
   ```

3. 複製一個 conformance vector 的資料集，並計算它的承諾：

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

4. 用上一步印出的三個值錨定它：

   ```bash
   cast send <registry> "anchor(bytes32,bytes32,bytes32)" <sessionId> <merkleRoot> <tallyHash> \
     --rpc-url http://127.0.0.1:8545 --unlocked --from <account0>
   ```

5. 提供資料集（在另一個終端機執行 `python3 -m http.server 8000 --directory /tmp/anchor-demo`），然後驗證：

   ```bash
   node packages/verifier/dist/cli.js verify --session 65f1c2a9e4b0d3f7a8c91e20 --network base-sepolia \
     --rpc-url http://127.0.0.1:8545 --contract <registry> \
     --dataset-url http://127.0.0.1:8000/ballots.json
   ```

修改 `/tmp/anchor-demo/ballots.json` 中的任一張選票，再執行一次第 5 步，就會看到 FAIL。
