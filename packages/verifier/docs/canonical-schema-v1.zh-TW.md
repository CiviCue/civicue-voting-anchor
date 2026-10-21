# 標準選票格式，第 1 版

[English](canonical-schema-v1.md) | **繁體中文**

> 本文件譯自英文版。若兩者有出入，以英文版為準。

本文件是公開的選票資料集（`ballots.json`）如何對應到鏈上錨定的兩個值 `merkleRoot` 與 `tallyHash` 的權威定義。CiviCue 平台的 producer 照著它實作，本套件中的驗證工具也實作了它。[Conformance vectors](../vectors/v1) 逐位元組固定了它。本文件與 vectors 有出入時，以 vectors 為準。

第 1 版已凍結。標準位元組、leaf 雜湊、樹的結構或計票結果的序列化方式若有任何改變，都需要新的 `schemaVersion`。新增不納入雜湊的資料集欄位（見[忽略的欄位](#忽略的欄位)）則不需要。

## 資料集

```jsonc
{
  "schemaVersion": 1,
  "votingMethod": "QUADRATIC", // "MAJORITY" | "QUADRATIC" | "RANKED_CHOICE"
  "voiceCredits": 10, // 僅限 QUADRATIC：每位投票者一致的預算
  "options": ["A", "B", "C"],
  "ballots": [
    { "voter": 1, "allocations": { "A": 2, "B": 1 } },
    { "voter": 2, "allocations": { "C": 3 } },
  ],
}
```

| 欄位            | 規則                                                                                   |
| --------------- | -------------------------------------------------------------------------------------- |
| `schemaVersion` | 整數 `1`。任何其他值都會回報為**不支援**，而不是驗證失敗。                             |
| `votingMethod`  | `MAJORITY`、`QUADRATIC` 或 `RANKED_CHOICE`。                                           |
| `options`       | 非空陣列，元素為彼此不同、非空的選項 id 字串。                                         |
| `voiceCredits`  | 僅限 `QUADRATIC`。正整數。                                                             |
| `ballots`       | 非空的選票陣列。每筆的 `voter` 是正整數，且 `n` 筆選票的 `voter` 值集合恰好是 `1..n`。 |

每筆選票帶有一個依投票方式而定的欄位：

| `votingMethod`  | 選票欄位        | 規則                                                                              |
| --------------- | --------------- | --------------------------------------------------------------------------------- |
| `MAJORITY`      | `optionIds`     | 由 `options` 中彼此不同的選項 id 組成的陣列。可以是空的（空白票）。               |
| `QUADRATIC`     | `allocations`   | 把 `options` 中的選項 id 對應到非負整數的物件。可以是空的。                       |
| `RANKED_CHOICE` | `rankedOptions` | 由 `options` 中彼此不同的選項 id 組成的陣列，最偏好的在前。可以只排部分或是空的。 |

違反上述任一規則的資料集無法重現承諾，驗證會失敗（`INVALID_DATASET`）。

投票者編號不帶有任何身分資訊。producer 依選票內部 id 的雜湊排序來指派 `voter` 編號。這個編號存在的唯一目的，是讓每位投票者的規則可以被檢查。

### 忽略的欄位

上面沒有列出的欄位，不論在最上層或在選票中，都會被忽略。它們不納入雜湊，因此不受錨定保護。

## 標準形式

雜湊之前，資料集會先被正規化。對同一份邏輯上的資料集，不論輸入順序為何，每個實作都必須產生相同的正規化結果：

- `options` 經過排序。
- `ballots` 依 `voter` 遞增排列。
- `MAJORITY` 的 `optionIds` 經過排序。
- `QUADRATIC` 中值為 `0` 的分配項目會被移除。
- `RANKED_CHOICE` 的 `rankedOptions` 保持原本順序，因為順序就是選票內容。

「排序」一律指依 UTF-16 code unit 遞增排列，也就是 JavaScript `Array.prototype.sort()` 的預設順序。

### 標準 JSON

值以 [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) JSON Canonicalization Scheme 序列化，並限縮在這裡會出現的值：

- 物件的 key 依 UTF-16 code unit 排序。沒有空白。
- 字串依 ECMAScript `JSON.stringify` 的方式跳脫，再以 UTF-8 編碼。
- 數字只能是不超過 2^53 − 1 的非負整數，以十進位表示，沒有正負號、指數、小數或前導零。
- 陣列保持原順序。`null` 只會出現在計票結果的 `eliminated` 欄位。

## Leaf 與 `merkleRoot`

每筆正規化後的選票成為一個 leaf。選票物件恰好只包含 `voter` 與它的投票方式欄位：

```
leaf = keccak256( utf8("civicue.ballot.v1") ‖ 0x00 ‖ utf8(canonicalJson(row)) )
```

例如，選票 `{"optionIds":["A"],"voter":1}` 會以 18 位元組的前綴 `civicue.ballot.v1\0` 進行雜湊。標籤中含有 schema 版本，因此 `merkleRoot` 也承諾了版本。

樹依選票順序（依 `voter`）以 leaf 建構：

```
node = keccak256( 0x01 ‖ left ‖ right )
```

每一層由左到右兩兩配對。如果某一層的節點數是奇數，最後一個節點原封不動地升到下一層，絕不複製。只有一個 leaf 時，它本身就是 root。leaf 的原像以 `c`（`0x63`）開頭，節點的原像以 `0x01` 開頭，因此兩者不會碰撞。

## 計票結果與 `tallyHash`

```
tallyHash = keccak256( utf8(canonicalJson(tally)) )
```

計票結果物件的內容依投票方式而定。每份計票結果都包含 `schemaVersion`、`votingMethod`、`ballotCount`（選票筆數）與 `winners`，因此 `tallyHash` 承諾了版本與投票方式。

### `MAJORITY`

每筆選票中每個被選的選項 id 加一票。

```text
{"ballotCount":5,"schemaVersion":1,"totals":{"A":3,"B":1,"C":1},"votingMethod":"MAJORITY","winners":["A"]}
```

- `totals` 列出每個選項，包括得 `0` 票的選項。
- `winners` 列出總票數最高的選項，經過排序。平手時有多個項目；所有選項都是 `0` 票時為空陣列。

### `QUADRATIC`

先檢查預算。每筆選票各分配的 `votes²` 總和必須不超過 `voiceCredits`。只要有任何一筆超過，驗證就失敗（`BUDGET_EXCEEDED`），不產生計票結果。接著依選項加總分配的票數。

```text
{"ballotCount":3,"schemaVersion":1,"totals":{"A":3,"B":2,"C":5},"voiceCredits":10,"votingMethod":"QUADRATIC","winners":["C"]}
```

`totals` 與 `winners` 遵循 `MAJORITY` 的規則。計票結果包含 `voiceCredits`，所以檢查選票時所用的預算也被承諾了。

### `RANKED_CHOICE`

計票結果是一次即時決選（instant runoff）的重演。開始時，每個選項都在場上。每一輪：

1. 每筆選票只計一次，算給它排名最高、且仍在場上的選項。沒有剩下任何選項的選票稱為**耗盡**（exhausted）。令 `active` 為未耗盡的選票數。
2. 如果 `active` 為 `0`，競賽結束，沒有勝出者（`winners: []`）。
3. 如果某個選項的票數超過 `active` 的一半（`votes × 2 > active`），它勝出。
4. 如果所有仍在場上的選項票數都相同，競賽以平手結束，`winners` 列出全部這些選項，經過排序。
5. 否則，淘汰票數最少的選項。如果有多個選項同為最少，就從最近一輪往前回顧先前各輪，每次只保留在該輪中票數最少的那些平手選項，直到只剩一個選項為止。回顧到第 1 輪仍然平手時，淘汰 id 最小的選項。

```text
{"ballotCount":8,"rounds":[{"eliminated":"C","exhausted":0,"totals":{"A":3,"B":2,"C":1,"D":2}},{"eliminated":"B","exhausted":0,"totals":{"A":3,"B":2,"D":3}},{"eliminated":null,"exhausted":0,"totals":{"A":3,"D":5}}],"schemaVersion":1,"votingMethod":"RANKED_CHOICE","winners":["D"]}
```

- `rounds` 依序列出每一輪。每一輪的 `totals` 只涵蓋該輪仍在場上的選項。`exhausted` 是耗盡的選票數。`eliminated` 是該輪結束後被淘汰的選項，最後一輪為 `null`。
- `winners` 是一個選項、平手的那些選項，或空陣列。

## 版本管理

- 版本同時綁定在兩個雜湊中：透過 leaf 標籤（`civicue.ballot.v<N>`），以及計票結果的 `schemaVersion` 欄位。宣告不同的版本會讓 `merkleRoot` 與 `tallyHash` 都改變（見 [`vectors/v1/version-binding`](../vectors/v1/version-binding)）。
- 驗證工具永久保留每一個已發布的版本，所以以舊版錨定的場次仍可驗證。
- producer 會保存每個場次計算時所用的版本，並以該版本重新產生資料集。

## Conformance vectors

`vectors/v<schemaVersion>/<group>/*.json`，每個檔案的格式如下：

```jsonc
{
  "description": "…",
  "bindVersion": 2, // 選填：以這個版本綁定進雜湊，取代 dataset.schemaVersion
  "dataset": {/* ballots.json */},
  "expected": { "merkleRoot": "0x…", "tallyHash": "0x…" }, // 或 { "error": "INVALID_DATASET" | "BUDGET_EXCEEDED" | "UNSUPPORTED_SCHEMA_VERSION" }
}
```

vectors 隨 npm 套件一起發布。producer 的 CI 會固定一個套件版本，並執行每一個 vector：

```ts
import { loadVectors } from "@civicue/voting-anchor-verifier/vectors";

for (const vector of loadVectors()) {
  // 對 vector.dataset 執行 producer 的編碼器（有 vector.bindVersion 時綁定該版本），
  // 並斷言結果等於 vector.expected。
}
```

也可以直接匯入原始檔案，例如 `@civicue/voting-anchor-verifier/vectors/v1/majority/basic.json`。已發布版本的 vectors 永遠不會改變。修正會放進新版本，除非能證明 vector 本身有誤。
