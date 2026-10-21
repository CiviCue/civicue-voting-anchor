# @civicue/voting-anchor-mock-platform

[English](README.md) | **繁體中文**

依照本 repo 的公開文件建立的 CiviCue 平台錨定流程 mock，用來在本機鏈上演練端對端驗證。它只在 workspace 內使用，不會發布。

有了它，不需要平台的資料庫、部署或 relayer，就能讓驗證工具去驗證另一份獨立實作的標準格式。

## 模擬的範圍

| 模組               | 規格                                                             | 行為                                                                                                                                                                                  |
| ------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/platform.ts`  | [驗證 API](../verifier/docs/verification-api.zh-TW.md)           | 場次與選票。投票時驗證選票，並即時更新各選項的計數。`closeSession` 會設為 `PENDING`，流局場次（投票人數 0）除外。排序複選要等各輪計算完成。                                           |
| `src/producer.ts`  | [標準選票格式 v1](../verifier/docs/canonical-schema-v1.zh-TW.md) | 每次請求時重新產生資料集，依 `hash(ballotId)` 的順序為投票者編號。計票結果取自場次記錄的狀態，而不是重新計票。保存 `merkleRoot`、`tallyHash` 與 `anchorSchemaVersion`（`COMPUTED`）。 |
| `src/encoder.ts`   | [標準選票格式 v1](../verifier/docs/canonical-schema-v1.zh-TW.md) | 標準 JSON、leaf、Merkle tree 與計票結果的編碼。                                                                                                                                       |
| `src/worker.ts`    | [`AnchorRegistry`](../contracts/README.zh-TW.md)                 | 錨定 `COMPUTED` 與 `FAILED` 的場次，等待確認後記為 `ANCHORED`。發生錯誤時記為 `FAILED`。已經錨定的場次會被對帳，而不是重新送出。                                                      |
| `src/api.ts`       | [驗證 API](../verifier/docs/verification-api.zh-TW.md)           | `GET …/anchor` 與 `GET …/anchor/dataset`。                                                                                                                                            |
| `src/scenarios.ts` | —                                                                | 涵蓋每種投票方式與格式邊界情況的場次（平手、耗盡的選票、回顧先前輪次的平手處理、Unicode 選項 id、流局場次）。                                                                         |

mock 不會 import 驗證工具的程式碼。編碼器與排序複選的計票只依據公開文件撰寫，所以 PASS 代表兩份獨立的實作結果一致。

平台透過 ERC-4337 smart account 送出交易；這裡的 relayer 是一般的 anvil 帳號。驗證工具只讀取 `getAnchor`，所以兩者對它沒有差別。

## 執行 devnet

需要 Foundry 的 `anvil`，並先 build contracts 與 verifier 套件：

```bash
pnpm --filter @civicue/voting-anchor-contracts build
pnpm --filter @civicue/voting-anchor-verifier build
pnpm --filter @civicue/voting-anchor-mock-platform devnet   # --rpc-port 8545 --api-port 8787
```

它會以 Base Sepolia 的 chain id 啟動 anvil、部署 `AnchorRegistry`、讓每個場次走完結束 → producer → worker 的流程，並持續提供驗證 API。它會印出每個場次的 id，以及驗證該場次的指令：

```bash
node packages/verifier/dist/cli.js verify --network base-sepolia \
  --rpc-url http://127.0.0.1:8545 --platform http://127.0.0.1:8787 --session <id>
```

## 測試

```bash
pnpm --filter @civicue/voting-anchor-mock-platform test
```

| 檔案                     | 涵蓋內容                                                                                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/producer.test.ts`  | 以 mock producer 執行 conformance vectors（平台的 CI 必須通過的內容）、錨定狀態的流轉、API 的狀態規則，以及 900 個隨機場次，其承諾必須與驗證工具重新計算的結果一致。        |
| `test/rehearsal.test.ts` | 在 anvil 上：worker 的失敗、重試與對帳路徑。每個場次都必須在驗證工具 CLI 中 PASS。每種竄改都必須 FAIL，並出現預期的檢查結果與各選項差異。缺少 anvil 或合約 build 時會略過。 |

竄改的情境包括：

- 每種投票方式各自的：改一張選票、對調兩張選票、刪除或新增一張選票；
- 調高平方投票的預算、超出預算的選票、未知的選項；
- 重新標上 schema 版本；
- 公布的摘要與錨定的計票結果不同；
- 排序複選的摘要列出了被淘汰的選項；
- 平台的 bug：錨定的計票結果與選票不符。
