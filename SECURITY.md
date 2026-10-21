# Security policy

**English** | [繁體中文](#安全性政策)

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue or PR.

Include what you found, how to reproduce it, and what an attacker could achieve. We will acknowledge the report, keep you updated while we investigate, and credit you in the advisory unless you prefer otherwise.

## Scope

- `packages/contracts`: the `AnchorRegistry` contract and its deployments listed in `deployments/`.
- `packages/verifier`: the verifier library and CLI, the canonical schema, and the conformance vectors. A way to make the verifier report PASS for a dataset or result that does not match the on-chain commitment is in scope and especially valuable.

Out of scope are the limits documented in [What a PASS does not prove](packages/verifier/docs/how-it-works.md#what-a-pass-does-not-prove), such as ballot-set authenticity and dataset availability. If you find an issue in the CiviCue platform itself, report it through the same channel and we will route it.

---

# 安全性政策

## 回報漏洞

請透過 GitHub 私下回報漏洞：打開 repo 的 **Security** 分頁，選擇 **Report a vulnerability**。請不要開公開的 issue 或 PR。

請說明你發現了什麼、如何重現，以及攻擊者能做到什麼。我們會確認收到回報，在調查期間持續告知進度，並在公告中致謝，除非你不希望具名。

## 範圍

- `packages/contracts`：`AnchorRegistry` 合約，以及 `deployments/` 中列出的部署。
- `packages/verifier`：驗證工具的函式庫與 CLI、標準選票格式，以及 conformance vectors。任何能讓驗證工具對不符合鏈上承諾的資料集或結果回報 PASS 的方法都在範圍內，而且特別有價值。

[PASS 不能證明的事](packages/verifier/docs/how-it-works.zh-TW.md#pass-不能證明的事)中列出的限制不在範圍內，例如選票集合的真實性與資料集的可取得性。如果你發現的是 CiviCue 平台本身的問題，請透過同一個管道回報，我們會轉交處理。
