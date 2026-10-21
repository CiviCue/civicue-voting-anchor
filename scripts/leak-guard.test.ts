import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { format, parseDiff, parsePatterns, scan } from "./leak-guard.ts";

const publicPatterns = parsePatterns(
  readFileSync(".github/leak-guard/denylist.txt", "utf8"),
  "",
).patterns;
const privatePatterns = parsePatterns(
  "# comment\n\n\\bsecretvendor\\b\nproject-[0-9]+\n",
  "i",
).patterns;

describe("parsePatterns", () => {
  it("numbers patterns from 1, skipping comments and blank lines", () => {
    assert.deepEqual(
      privatePatterns.map((p) => p.index),
      [1, 2],
    );
  });

  it("reports invalid patterns by index only", () => {
    assert.deepEqual(parsePatterns("ok\n(unclosed\n", "i").invalid, [2]);
  });
});

describe("public tier", () => {
  const blocked = (path: string) =>
    scan([{ path, lines: [] }], publicPatterns, []).length > 0;

  it("blocks env files but allows .env.example", () => {
    assert.ok(blocked(".env"));
    assert.ok(blocked(".env.production"));
    assert.ok(blocked("packages/contracts/.env.local"));
    assert.ok(!blocked(".env.example"));
    assert.ok(!blocked("packages/verifier/src/env.ts"));
  });

  it("blocks key material files", () => {
    assert.ok(blocked("deploy/operator.pem"));
    assert.ok(blocked("keystore/owner.json"));
    assert.ok(blocked("id_ed25519"));
    assert.ok(!blocked("packages/verifier/src/keys.ts"));
  });

  it("never matches file content", () => {
    const findings = scan(
      [
        {
          path: "README.md",
          lines: [{ line: 1, text: "deploy/operator.pem" }],
        },
      ],
      publicPatterns,
      [],
    );
    assert.deepEqual(findings, []);
  });
});

describe("private tier", () => {
  it("matches content case-insensitively and reports file, line, and index", () => {
    const findings = scan(
      [
        {
          path: "docs/a.md",
          lines: [{ line: 7, text: "we use SecretVendor here" }],
        },
      ],
      [],
      privatePatterns,
    );
    assert.deepEqual(findings, [
      { file: "docs/a.md", line: 7, tier: "private", index: 1 },
    ]);
  });

  it("never prints the pattern or the line content", () => {
    const [finding] = scan(
      [
        {
          path: "docs/a.md",
          lines: [{ line: 7, text: "deployed to project-42" }],
        },
      ],
      [],
      privatePatterns,
    );
    assert.ok(finding);
    const out = format(finding);
    assert.equal(out, "docs/a.md:7: private deny-list pattern #2");
    assert.ok(!out.includes("project"));
  });

  it("respects word boundaries", () => {
    const findings = scan(
      [
        {
          path: "a.md",
          lines: [{ line: 1, text: "secretvendors and mysecretvendor" }],
        },
      ],
      [],
      privatePatterns,
    );
    assert.deepEqual(findings, []);
  });

  it("skips lockfile integrity lines", () => {
    const findings = scan(
      [
        {
          path: "pnpm-lock.yaml",
          lines: [
            {
              line: 3,
              text: "    resolution: {integrity: sha512-SecretVendor==}",
            },
          ],
        },
      ],
      [],
      privatePatterns,
    );
    assert.deepEqual(findings, []);
  });

  it("also checks paths", () => {
    const findings = scan(
      [{ path: "scripts/secretvendor.ts", lines: [] }],
      [],
      privatePatterns,
    );
    assert.deepEqual(findings, [
      { file: "scripts/secretvendor.ts", tier: "private", index: 1 },
    ]);
  });
});

describe("parseDiff", () => {
  it("collects added lines with their new line numbers and drops deleted files", () => {
    const diff = [
      "diff --git a/docs/a.md b/docs/a.md",
      "--- a/docs/a.md",
      "+++ b/docs/a.md",
      "@@ -3,0 +4,2 @@",
      "+first",
      "+second",
      "@@ -10 +12 @@",
      "-old",
      "+third",
      "diff --git a/gone.md b/gone.md",
      "--- a/gone.md",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-bye",
    ].join("\n");
    assert.deepEqual(parseDiff(diff), [
      {
        path: "docs/a.md",
        lines: [
          { line: 4, text: "first" },
          { line: 5, text: "second" },
          { line: 12, text: "third" },
        ],
      },
    ]);
  });
});
