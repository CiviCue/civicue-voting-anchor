#!/usr/bin/env node
import { parseArgs } from "node:util";
import { isNetworkName, NETWORKS } from "./chain.ts";
import { formatReport } from "./report.ts";
import { verifySession, VerifyError, type Outcome } from "./verify.ts";

/** Distinct exit codes so scripts can tell a mismatch from a missing anchor or an old verifier. */
const EXIT_CODES = {
  PASS: 0,
  FAIL: 1,
  NOT_ANCHORED: 2,
  UNSUPPORTED: 3,
  ERROR: 4,
} as const satisfies Record<Outcome | "ERROR", number>;

const HELP = `Usage: voting-anchor-verifier verify --session <id> --network <${Object.keys(NETWORKS).join("|")}> [options]

Recompute a CiviCue voting session's Merkle root and tally from its published ballot
dataset and compare them with the commitment anchored in AnchorRegistry. Read-only.

Options:
  --session <id>        Session id (24 hex characters, any case)
  --network <name>      ${Object.keys(NETWORKS).join(" | ")}
  --platform <url>      Platform API base URL; the metadata and dataset URLs are derived from it
  --contract <address>  AnchorRegistry address override (otherwise read from the metadata)
  --dataset-url <url>   Dataset URL override, e.g. an archived copy of ballots.json
  --rpc-url <url>       JSON-RPC endpoint (default: the network's public RPC)
  --json                Print the report as JSON
  -h, --help            Show this help

Exit codes: 0 PASS, 1 FAIL, 2 not anchored, 3 unsupported schema version, 4 error.
`;

async function main(argv: readonly string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        session: { type: "string" },
        network: { type: "string" },
        platform: { type: "string" },
        contract: { type: "string" },
        "dataset-url": { type: "string" },
        "rpc-url": { type: "string" },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (error) {
    return usage((error as Error).message);
  }
  const { values, positionals } = parsed;
  if (values.help) {
    process.stdout.write(HELP);
    return EXIT_CODES.PASS;
  }
  if (positionals.length !== 1 || positionals[0] !== "verify")
    return usage("expected the `verify` command");
  if (!values.session) return usage("--session is required");
  if (!values.network || !isNetworkName(values.network)) {
    return usage(
      `--network must be one of ${Object.keys(NETWORKS).join(", ")}`,
    );
  }

  try {
    const report = await verifySession({
      session: values.session,
      network: values.network,
      platform: values.platform,
      contract: values.contract,
      datasetUrl: values["dataset-url"],
      rpcUrl: values["rpc-url"],
    });
    process.stdout.write(
      values.json
        ? `${JSON.stringify(report, (_, value) => (typeof value === "bigint" ? value.toString() : value), 2)}\n`
        : `${formatReport(report)}\n`,
    );
    return EXIT_CODES[report.outcome];
  } catch (error) {
    process.stderr.write(
      `error: ${error instanceof VerifyError ? error.message : String(error)}\n`,
    );
    return EXIT_CODES.ERROR;
  }
}

function usage(message: string): number {
  process.stderr.write(`error: ${message}\n\n${HELP}`);
  return EXIT_CODES.ERROR;
}

process.exitCode = await main(process.argv.slice(2));
