# 公開驗證 API，第 1 版

[English](verification-api.md) | **繁體中文**

> 本文件譯自英文版。若兩者有出入，以英文版為準。

本文件是 CiviCue 平台部署為已錨定投票場次提供之 HTTP API 的權威定義。平台實作它，驗證工具使用它。兩個 endpoint 都是公開的，不需要驗證身分，也不因場次屬於哪個模組而有所不同。

驗證工具用平台 base URL 與場次 id 組出兩個 URL，所以平台永遠不需要回傳指向自己的 URL。路徑相對於 base URL，base URL 可以包含路徑前綴：

```
{platform}/v2/voting/sessions/{id}/anchor            metadata
{platform}/v2/voting/sessions/{id}/anchor/dataset    標準 ballots.json
```

`{id}` 是場次 24 字元的十六進位 session id（先轉小寫）。它在鏈上的鍵值是 `sessionId = keccak256(bytes(id))`。見 [`@civicue/voting-anchor-contracts` `fixtures/session-id.json`](../../contracts/fixtures/session-id.json)。

## `GET /v2/voting/sessions/:id/anchor`

這個 endpoint 回傳場次的驗證欄位，以及一份人類可讀的結果摘要。

```jsonc
{
  "sessionId": "6650a3b2c1d0e9f8a7b6c5d4",
  "votingMethod": "QUADRATIC", // MAJORITY | QUADRATIC | RANKED_CHOICE
  "anchorStatus": "ANCHORED", // PENDING | COMPUTED | ANCHORED | FAILED
  "schemaVersion": 1, // 計算承諾時所用的標準格式版本
  "merkleRoot": "0x…", // bytes32
  "tallyHash": "0x…", // bytes32
  "anchorTxHash": "0x…", // 錨定前為 null
  "anchorContract": "0x…", // 這個場次錨定所在的 AnchorRegistry 地址；錨定前為 null
  "chainId": 84532, // 8453（Base）或 84532（Base Sepolia）；錨定前為 null
  "result": {
    "winner": "C", // 唯一勝出的選項 id；平手或沒有勝出者時為 null
    "turnout": 3, // 資料集中的選票數
    "options": [
      { "id": "A", "votes": 3 },
      { "id": "B", "votes": 2 },
      { "id": "C", "votes": 5 },
    ],
  },
}
```

| 狀態碼 | 時機                                                     |
| ------ | -------------------------------------------------------- |
| `200`  | 場次已結束，且有錨定紀錄（`anchorStatus` 不是 `NONE`）。 |
| `404`  | 場次不存在、尚未結束，或沒有錨定紀錄。                   |

規則：

- `anchorContract` 與 `chainId` 指出這個場次確切的 registry。registry 可能重新部署，所以客戶端不得假設只有一個永久地址。
- `result` 必須與 `tallyHash` 所承諾的內容一致。驗證工具會把 `result` 與自己重新計算的結果比對，任何差異都回報為失敗。
  - `options` 恰好是[標準計票結果](canonical-schema-v1.zh-TW.md#計票結果與-tallyhash)中各選項的票數，順序不限。
  - 對 `MAJORITY` 與 `QUADRATIC` 而言，就是 `totals`，所以每個選項都會列出，包括得 `0` 票的選項。
  - 對 `RANKED_CHOICE` 而言，是最後一輪的 `totals`：只列出最後一輪仍在場上的選項，以及它們最後一輪的票數。被淘汰的選項**不**列出。列出被淘汰的選項，即使寫 `0` 票，也算不一致。淘汰過程由計票結果中的 `rounds` 承諾，驗證工具會重新計算。
  - `winner` 是計票結果中唯一的勝出者；計票結果沒有勝出者或有多位勝出者時為 `null`。
- 回應中沒有 `datasetUrl` 欄位，因為資料集的路徑可以從本規格推得。
- 回應不得揭露結束前的結果、投票者身分或投票資格規則。

## `GET /v2/voting/sessions/:id/anchor/dataset`

這個 endpoint 回傳場次的標準選票資料集（`ballots.json`），格式依該場次 `schemaVersion` 對應的[標準選票格式](canonical-schema-v1.zh-TW.md)定義。回應的類型是 `application/json`。

| 狀態碼 | 時機                                                                           |
| ------ | ------------------------------------------------------------------------------ |
| `200`  | 場次的承諾已計算完成（`anchorStatus` 為 `COMPUTED`、`ANCHORED` 或 `FAILED`）。 |
| `404`  | 其他情況。                                                                     |

規則：

- 同一個場次的每一次回應，都必須在標準格式下產生該場次的 `merkleRoot` 與 `tallyHash`。各次回應的位元組不必完全相同，但正規化後的資料集必須相同。
- 資料集的任何副本，例如封存的副本，都可以拿來和鏈上的 root 驗證。驗證工具以 `--dataset-url` 接受這類副本。

## 驗證工具如何使用這個 API

1. `GET …/anchor` 回傳 `anchorContract`、`chainId` 與 `result`。metadata endpoint 無法使用時，可用 `--contract` 取代 `anchorContract`。
2. 在鏈上讀取 `AnchorRegistry(anchorContract).getAnchor(sessionId)`。如果 `timestamp` 為 `0`，表示場次尚未錨定。
3. `GET …/anchor/dataset` 回傳資料集。`--dataset-url` 可以取代這個 URL。
4. 重新計算 `merkleRoot` 與 `tallyHash`，與鏈上的值比對，並把 `result` 與重新計算的計票結果比對。

驗證工具不採信 metadata 中的任何雜湊欄位。雜湊一律取自鏈上。
