// Leak guard: checks that content bound for the public repository holds no forbidden paths and no
// matches for private deny-list patterns. Secrets are gitleaks' job; this covers the rest.
//
//   node scripts/leak-guard.ts --diff <base>   lines and paths added since <base> (pull requests)
//   node scripts/leak-guard.ts --all           every tracked file (pushes to main, manual runs)
//
// Public tier: `.github/leak-guard/denylist.txt`, path regexes only. Private tier: the
// LEAK_DENYLIST environment variable, one regex per line, matched case-insensitively against
// paths and content. The private patterns are never printed: the Actions logs of a public repo
// are public, so a private hit reports only file, line, and the pattern's index.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export interface Pattern {
  index: number;
  regex: RegExp;
}

export interface Finding {
  file: string;
  line?: number;
  tier: "public" | "private";
  index: number;
}

export interface FileChange {
  path: string;
  lines: { line: number; text: string }[];
}

const PUBLIC_DENYLIST = ".github/leak-guard/denylist.txt";

/** Parses one regex per line, skipping blank lines and `#` comments. Indexes are 1-based. */
export function parsePatterns(
  text: string,
  flags: string,
): { patterns: Pattern[]; invalid: number[] } {
  const patterns: Pattern[] = [];
  const invalid: number[] = [];
  let index = 0;
  for (const raw of text.split("\n")) {
    const source = raw.trim();
    if (source === "" || source.startsWith("#")) continue;
    index++;
    try {
      patterns.push({ index, regex: new RegExp(source, flags) });
    } catch {
      invalid.push(index);
    }
  }
  return { patterns, invalid };
}

/** Lockfile integrity hashes are base64, so short patterns match them by chance. */
function skipLine(path: string, text: string): boolean {
  return path.endsWith("pnpm-lock.yaml") && text.includes("integrity:");
}

export function scan(
  changes: FileChange[],
  publicPatterns: Pattern[],
  privatePatterns: Pattern[],
): Finding[] {
  const findings: Finding[] = [];
  for (const { path, lines } of changes) {
    for (const p of publicPatterns) {
      if (p.regex.test(path))
        findings.push({ file: path, tier: "public", index: p.index });
    }
    for (const p of privatePatterns) {
      if (p.regex.test(path))
        findings.push({ file: path, tier: "private", index: p.index });
    }
    for (const { line, text } of lines) {
      if (skipLine(path, text)) continue;
      for (const p of privatePatterns) {
        if (p.regex.test(text))
          findings.push({ file: path, line, tier: "private", index: p.index });
      }
    }
  }
  return findings;
}

/** Collects added lines per file from `git diff --unified=0` output. Deleted files are dropped. */
export function parseDiff(diff: string): FileChange[] {
  const changes: FileChange[] = [];
  let current: FileChange | undefined;
  let next = 0;
  for (const text of diff.split("\n")) {
    if (text.startsWith("diff --git ")) {
      current = undefined;
    } else if (text.startsWith("+++ ")) {
      const target = text.slice(4);
      current =
        target === "/dev/null"
          ? undefined
          : { path: target.replace(/^b\//, ""), lines: [] };
      if (current) changes.push(current);
    } else if (text.startsWith("@@")) {
      const match = /\+(\d+)/.exec(text);
      next = match ? Number(match[1]) : 0;
    } else if (current && text.startsWith("+")) {
      current.lines.push({ line: next++, text: text.slice(1) });
    }
  }
  return changes;
}

function git(args: string[]): string {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
}

function diffChanges(base: string): FileChange[] {
  const diff = git([
    "diff",
    "--unified=0",
    "--no-color",
    "--no-ext-diff",
    "--no-renames",
    `${base}...HEAD`,
  ]);
  return parseDiff(diff);
}

function trackedChanges(): FileChange[] {
  const changes: FileChange[] = [];
  for (const entry of git(["ls-files", "-z", "--stage"]).split("\0")) {
    if (entry === "") continue;
    const [meta = "", path = ""] = entry.split("\t");
    if (meta.startsWith("160000")) continue; // submodule
    const content = readFileSync(path);
    if (content.includes(0)) {
      changes.push({ path, lines: [] }); // binary: path rules only
      continue;
    }
    const lines = content
      .toString("utf8")
      .split("\n")
      .map((text, i) => ({ line: i + 1, text }));
    changes.push({ path, lines });
  }
  return changes;
}

export function format(f: Finding): string {
  const where = f.line === undefined ? f.file : `${f.file}:${f.line}`;
  return `${where}: ${f.tier} deny-list pattern #${f.index}`;
}

function main(argv: string[]): number {
  const mode = argv[0];
  if (mode !== "--all" && !(mode === "--diff" && argv[1])) {
    console.error("usage: leak-guard.ts --diff <base> | --all");
    return 2;
  }

  const pub = parsePatterns(readFileSync(PUBLIC_DENYLIST, "utf8"), "");
  if (pub.invalid.length > 0) {
    console.error(
      `invalid public pattern(s): ${pub.invalid.map((i) => `#${i}`).join(", ")}`,
    );
    return 2;
  }
  const secret = process.env.LEAK_DENYLIST ?? "";
  const priv = parsePatterns(secret, "i");
  if (priv.invalid.length > 0) {
    console.error(
      `invalid private pattern(s): ${priv.invalid.map((i) => `#${i}`).join(", ")}`,
    );
    return 2;
  }
  if (secret.trim() === "") {
    console.log(
      "private tier skipped: LEAK_DENYLIST is not set (expected on pull requests from forks)",
    );
  }

  const changes = mode === "--all" ? trackedChanges() : diffChanges(argv[1]!);
  const findings = scan(changes, pub.patterns, priv.patterns);
  console.log(
    `checked ${changes.length} file(s) against ${pub.patterns.length} public and ${priv.patterns.length} private pattern(s)`,
  );
  for (const f of findings) console.log(`::error::${format(f)}`);
  if (findings.length > 0) {
    console.log(
      "A public-tier hit means the file must not live in this repo. A private-tier hit means the line " +
        "holds something that does not belong in this public repository; reword it. Maintainers can look up private pattern " +
        "indexes; see AGENTS.md.",
    );
    return 1;
  }
  return 0;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
