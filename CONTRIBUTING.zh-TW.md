# 參與貢獻

[English](CONTRIBUTING.md) | **繁體中文**

感謝你協助讓 CiviCue 的投票錨定更容易驗證。回報錯誤、獨立實作驗證工具、修正文件，我們都很歡迎。

## 環境設定

需要 Node `^24.16.0`、pnpm 10 與 [Foundry](https://getfoundry.sh)。

```bash
git submodule update --init --recursive
pnpm install
pnpm build
pnpm test
```

## 提出修改

- 小修正以外的修改，請先開 issue，在寫程式之前先對做法取得共識。
- commit 訊息與 PR 標題請使用 [Conventional Commits](https://www.conventionalcommits.org)。
- 請讓 CI 保持通過：合約測試（100% 行覆蓋率）、gas snapshot、Slither、驗證工具與 mock-platform 的測試、Prettier，以及 leak guard。
- 修改標準選票格式或計票規則時，必須一併附上 conformance vectors。平台會跑同一組 vectors，雙方必須逐位元組一致。
- 給使用者看的文件會同時提供英文與繁體中文。如果你只能寫其中一種，請在 PR 中註明，維護者會補上另一種。

## 這個 repo 包含什麼

這個 repo 只包含錨定機制中開源的部分：合約、標準選票格式、驗證工具，以及相關文件。CiviCue 平台本身是閉源的，平台如何營運的細節也不在這個 repo 的範圍內。`leak-guard` 檢查會確保這一點。如果它標出你 PR 中的某一行，維護者會協助你改寫。

## 發佈套件

這段寫給維護者。`packages/` 下的每個套件各自發佈：

1. 把該套件 `package.json` 的版本號更新合進 `main`。
2. 在 `main` 的那個 commit 上打 tag `@civicue/<package>@<version>`，再 push 這個 tag。
3. 到 Actions 裡的 `release` workflow，核准 `npm` environment。

workflow 會建置、測試並打包套件，再帶著 npm provenance 發佈。任何人都能從發佈的 tarball 追溯到建置它的 commit 和 workflow 執行紀錄。

## 安全性問題

請不要用公開 issue 回報漏洞，請參閱 [SECURITY.md](SECURITY.md)。
