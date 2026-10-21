import type { VerificationReport } from "./verify.ts";

/** What a PASS establishes; printed with every PASS. */
export const GUARANTEE =
  "PASS means the published ballots are tallied correctly under the session's voting method, " +
  "and neither the ballots nor the tally changed after they were anchored on-chain.";

/** Renders a report as plain text for a terminal. */
export function formatReport(report: VerificationReport): string {
  const lines: string[] = [];
  const row = (
    label: string,
    value: string | number | bigint | undefined,
  ): void => {
    if (value !== undefined) lines.push(`  ${label.padEnd(14)}${value}`);
  };

  lines.push(
    `${report.outcome}${report.reason ? `: ${report.reason}` : ""}`,
    "",
  );
  row(
    "session",
    `${report.session.id} (sessionId ${report.session.sessionId})`,
  );
  row("network", `${report.network} (chain ${report.chainId})`);
  row("registry", report.contract);
  row("metadata", report.metadataUrl);
  row("dataset", report.datasetUrl);
  if (report.onChain && report.onChain.timestamp !== 0n) {
    row(
      "anchored at",
      `block ${report.onChain.blockNumber}, ${new Date(Number(report.onChain.timestamp) * 1000).toISOString()}`,
    );
  }
  if (report.recomputed) {
    const { tally } = report.recomputed;
    row("schema", `v${report.recomputed.schemaVersion}, ${tally.votingMethod}`);
    row("ballots", tally.ballotCount);
    row(
      "winner",
      tally.winners.length === 0
        ? "none"
        : tally.winners.join(", ") + (tally.winners.length > 1 ? " (tie)" : ""),
    );
  }

  if (report.checks.length > 0) {
    lines.push("", "Checks:");
    for (const check of report.checks) {
      lines.push(`  ${check.ok ? "✓" : "✗"} ${check.name}`);
      if (!check.ok && check.expected !== undefined) {
        lines.push(
          `      on-chain    ${check.expected}`,
          `      recomputed  ${check.actual}`,
        );
      }
    }
  }

  const diff = report.resultDiff;
  if (diff) {
    lines.push("", "Published result summary vs recomputed tally:");
    for (const option of diff.options) {
      const gap =
        option.published !== null && option.recomputed !== null
          ? difference(option.published, option.recomputed)
          : "";
      lines.push(
        `  ${option.id}: published ${option.published ?? "—"}, recomputed ${option.recomputed ?? "—"}${gap}`,
      );
    }
    if (diff.winner)
      lines.push(
        `  winner: published ${diff.winner.published ?? "none"}, recomputed ${diff.winner.recomputed ?? "none"}`,
      );
    if (diff.turnout)
      lines.push(
        `  turnout: published ${diff.turnout.published}, recomputed ${diff.turnout.recomputed}${difference(diff.turnout.published, diff.turnout.recomputed)}`,
      );
  } else if (
    report.checks.some((check) => check.name === "tallyHash" && !check.ok)
  ) {
    const hasSummary = report.checks.some(
      (check) => check.name === "resultSummary",
    );
    lines.push(
      "",
      hasSummary
        ? "The published result summary matches the recomputed tally, so the on-chain tallyHash commits to a different tally."
        : "The chain stores only tallyHash, so no per-option delta is available; pass --platform to compare with the published result summary.",
    );
  }

  if (report.warnings.length > 0) {
    lines.push(
      "",
      "Warnings:",
      ...report.warnings.map((warning) => `  - ${warning}`),
    );
  }
  if (report.outcome === "PASS") lines.push("", GUARANTEE);
  if (report.outcome === "UNSUPPORTED")
    lines.push(
      "",
      "Upgrade: npx @civicue/voting-anchor-verifier@latest verify …",
    );
  return lines.join("\n");
}

/** States in words how far the published number is from the recomputed one, e.g. " (published 3 fewer)". */
function difference(published: number, recomputed: number): string {
  const gap = published - recomputed;
  return ` (published ${Math.abs(gap)} ${gap > 0 ? "more" : "fewer"})`;
}
