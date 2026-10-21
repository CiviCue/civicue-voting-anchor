# civicue-voting-anchor

[English](README.md) | **繁體中文**

CiviCue 投票結果的開源鏈上錨定（anchor）與驗證工具。

投票場次結束後，CiviCue 平台會公開一份匿名化的選票資料集，並把對這份資料的承諾（`merkleRoot` + `tallyHash`）錨定在 Base 鏈上。第三方要獨立檢查這份承諾所需的一切，都在這個 repo 裡：

- `packages/contracts`：`AnchorRegistry` Solidity 合約（Foundry）。每個場次存一筆只能寫入一次的承諾。
- `packages/verifier`：TypeScript 函式庫與 `verify` CLI。它從公開的資料集重新計算 Merkle root 與依投票方式而定的計票結果，再和鏈上紀錄比對。

投票系統本身維持閉源。這裡開源的是合約、標準選票格式（canonical ballot schema）與驗證工具。

平台要實作的介面規格如下：

- [標準選票格式](packages/verifier/docs/canonical-schema-v1.zh-TW.md)：資料集格式、leaf 雜湊、Merkle tree 與計票結果的序列化方式，並以 [conformance vectors](packages/verifier/vectors) 逐位元組固定。
- [公開驗證 API](packages/verifier/docs/verification-api.zh-TW.md)：metadata 與資料集兩個 endpoint。

驗證一個場次：

```bash
npx @civicue/voting-anchor-verifier verify --session <id> --network base --platform <platform-api-base-url>
```

## 通過驗證代表什麼

- 公開的結果自錨定以來沒有被更改過。
- 這個結果是**公開的**選票依照該場次投票方式（多數決、平方投票或排序複選）計算出的正確結果。

為什麼 PASS 值得信任，請見[驗證原理](packages/verifier/docs/how-it-works.zh-TW.md)；詳細用法請見 [CLI 使用指南](packages/verifier/docs/cli.zh-TW.md)。

## 開發

需要 Node `^24.16.0`、pnpm 10，以及 [Foundry](https://getfoundry.sh)（`packages/contracts` 使用）。

```bash
git submodule update --init --recursive
pnpm install
pnpm build
pnpm test
```

[`packages/mock-platform`](packages/mock-platform/README.zh-TW.md) 是依公開文件建立的平台錨定流程 mock（投票、producer、worker 與驗證 API）。它可以啟動一個本機 devnet，讓驗證工具直接連上去。

## 參與貢獻與安全性

請參閱 [CONTRIBUTING.zh-TW.md](CONTRIBUTING.zh-TW.md)。漏洞請依 [SECURITY.md](SECURITY.md) 的說明私下回報。

## 授權

Apache-2.0
