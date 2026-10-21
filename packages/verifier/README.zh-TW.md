# @civicue/voting-anchor-verifier

[English](README.md) | **繁體中文**

這個套件能獨立驗證一場已錨定在 Base 上的 CiviCue 投票。給定場次 id，它會：

1. 從 `AnchorRegistry` 讀取該場次的承諾（`merkleRoot`、`tallyHash`），
2. 下載公開的選票資料集，
3. 依該場次的投票方式（多數決、平方投票或排序複選）重新計算 Merkle root 與計票結果，
4. 回報重新計算的值是否與鏈上承諾一致。

平台回報的雜湊值它一概不採信，因為這些值都直接取自鏈上。驗證工具是唯讀的，不會送出任何交易。

## PASS 代表什麼

PASS 代表公開的選票已依該場次的投票方式正確計票，而且選票與計票結果在錨定上鏈之後都沒有被更改過。

[驗證原理](docs/how-it-works.zh-TW.md)說明為什麼 PASS 值得信任。[CLI 使用指南](docs/cli.zh-TW.md)詳細說明每個選項、輸出與結果。

## CLI

```bash
npx @civicue/voting-anchor-verifier verify \
  --session 6650a3b2c1d0e9f8a7b6c5d4 \
  --network base-sepolia \
  --platform https://<platform-api-base-url>
```

| 選項                   | 說明                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| `--session <id>`       | 場次 id（24 字元的十六進位 session id，大小寫皆可，使用前先轉小寫）                                    |
| `--network <name>`     | `base` 或 `base-sepolia`                                                                               |
| `--platform <url>`     | 平台 API 的 base URL。metadata 與資料集的 URL 由它推導（[API 規格](docs/verification-api.zh-TW.md)）。 |
| `--contract <address>` | `AnchorRegistry` 地址，覆寫 metadata 中的 `anchorContract`                                             |
| `--dataset-url <url>`  | 覆寫資料集 URL，例如改用 `ballots.json` 的封存副本                                                     |
| `--rpc-url <url>`      | JSON-RPC endpoint（預設為該網路的公開 RPC）                                                            |
| `--json`               | 以 JSON 輸出完整報告                                                                                   |

如果平台沒有提供 metadata endpoint，可以不帶 `--platform`，改用 `--contract` 與 `--dataset-url`。

| 結束碼 | 結果                                                                             |
| ------ | -------------------------------------------------------------------------------- |
| `0`    | PASS                                                                             |
| `1`    | FAIL：雜湊或平台公布的結果摘要不一致，或資料集無效，例如某張平方投票選票超出預算 |
| `2`    | 尚未錨定：registry 中沒有這個場次的承諾                                          |
| `3`    | 不支援：資料集使用了這個驗證工具不認得的 schema 版本。請升級套件。               |
| `4`    | 錯誤：參數有誤，或 endpoint、RPC 無法連線                                        |

FAIL 時，報告會列出 `merkleRoot` 與 `tallyHash` 中哪一個不一致，並附上兩邊的值。它也會逐一列出平台公布的結果與重新計算結果在各選項上的差異。

## 函式庫

```ts
import {
  computeCommitment,
  formatReport,
  verifySession,
} from "@civicue/voting-anchor-verifier";

const report = await verifySession({
  session: "6650a3b2c1d0e9f8a7b6c5d4",
  network: "base-sepolia",
  platform: "https://<platform-api-base-url>",
});
console.log(report.outcome, formatReport(report));

// 從手上已有的資料集重新計算：
const { merkleRoot, tallyHash, tally } = computeCommitment(
  JSON.parse(ballotsJson),
);
```

## 規格

- [標準選票格式 v1](docs/canonical-schema-v1.zh-TW.md) 定義資料集格式、leaf 雜湊、Merkle tree，以及各投票方式的計票結果序列化方式。
- [公開驗證 API](docs/verification-api.zh-TW.md) 定義平台要實作的 endpoint 路徑與回應格式。
- Conformance vectors 放在 [`vectors/`](vectors)，以 `@civicue/voting-anchor-verifier/vectors`（`loadVectors()`）匯出。

## 開發

```bash
pnpm --filter @civicue/voting-anchor-contracts build   # 驗證工具使用的 ABI（需要 Foundry）
pnpm --filter @civicue/voting-anchor-verifier test     # 單元測試、vectors 與 anvil 端對端測試
pnpm --filter @civicue/voting-anchor-verifier lint
```

端對端測試只有在已安裝 Foundry 的 `anvil`，且 `packages/contracts` 已 build 過時才會執行。測試會把 `AnchorRegistry` 部署到本機鏈上、錨定 vectors 的承諾，再對一個實作 API 規格的本機 HTTP server 執行 CLI。

## 發布

`pnpm publish` 會把 `workspace:*` 相依改寫成目前的 `@civicue/voting-anchor-contracts` 版本。兩個套件請從同一個 commit 發布，並先發布 contracts 套件：

```bash
pnpm --filter @civicue/voting-anchor-contracts publish
pnpm --filter @civicue/voting-anchor-verifier publish
npx -y @civicue/voting-anchor-verifier@<version> verify --help   # 在乾淨的機器上執行
```
