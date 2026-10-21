import { getAddress, isAddress, type Address, type Hex } from "viem";
import {
  fetchJson,
  HttpError,
  verificationEndpoints,
  type AnchorMetadata,
} from "./api.ts";
import {
  NETWORKS,
  readAnchor as readAnchorOnChain,
  type NetworkName,
  type OnChainAnchor,
  type ReadAnchorOptions,
} from "./chain.ts";
import {
  computeCommitment,
  finalTotals,
  type Commitment,
} from "./commitment.ts";
import { DatasetError, UnsupportedSchemaVersionError } from "./errors.ts";
import { normalizeSessionId, sessionIdToBytes32 } from "./session-id.ts";

export type Outcome = "PASS" | "FAIL" | "NOT_ANCHORED" | "UNSUPPORTED";

export interface VerifyOptions {
  /** CiviCue platform session id (24 hex characters, any case). */
  readonly session: string;
  readonly network: NetworkName;
  /** Platform base URL; the metadata and dataset URLs are derived from it. */
  readonly platform?: string;
  /** Registry address override, e.g. before the metadata endpoint is live. */
  readonly contract?: string;
  /** Dataset URL override, e.g. an archived copy. */
  readonly datasetUrl?: string;
  readonly rpcUrl?: string;
  /** Injection points for tests. */
  readonly fetch?: typeof fetch;
  readonly readAnchor?: (options: ReadAnchorOptions) => Promise<OnChainAnchor>;
}

export interface Check {
  readonly name: "merkleRoot" | "tallyHash" | "resultSummary";
  readonly ok: boolean;
  /** The value committed on chain (or published by the platform, for `resultSummary`). */
  readonly expected?: string;
  /** The value recomputed from the dataset. */
  readonly actual?: string;
}

export interface OptionDelta {
  readonly id: string;
  /** Votes in the platform's published result summary (`null` if the option is missing there). */
  readonly published: number | null;
  /** Votes recomputed from the dataset (`null` if the option is not in the dataset). */
  readonly recomputed: number | null;
}

export interface ResultDiff {
  /** Options whose votes differ. */
  readonly options: readonly OptionDelta[];
  readonly winner?: {
    readonly published: string | null;
    readonly recomputed: string | null;
  };
  readonly turnout?: {
    readonly published: number;
    readonly recomputed: number;
  };
}

export interface VerificationReport {
  readonly outcome: Outcome;
  /** Why the outcome is not PASS, in one sentence. */
  readonly reason?: string;
  readonly session: { readonly id: string; readonly sessionId: Hex };
  readonly network: NetworkName;
  readonly chainId: number;
  readonly contract?: Address;
  readonly metadataUrl?: string;
  readonly datasetUrl?: string;
  readonly onChain?: OnChainAnchor;
  readonly recomputed?: Commitment;
  readonly checks: readonly Check[];
  /** Differences between the published result summary and the recomputed tally; absent when they agree or no summary was fetched. */
  readonly resultDiff?: ResultDiff;
  readonly warnings: readonly string[];
}

/** Thrown for problems that prevent a verdict (bad arguments, unreachable endpoints). */
export class VerifyError extends Error {
  override readonly name = "VerifyError";
}

/**
 * Fetches the on-chain commitment and the published dataset for a session, recomputes
 * `merkleRoot` and `tallyHash`, and compares them. PASS requires both to match (and the
 * platform's result summary, when available, to agree with the recomputed tally).
 */
export async function verifySession(
  options: VerifyOptions,
): Promise<VerificationReport> {
  const fetchImpl = options.fetch ?? fetch;
  const readAnchor = options.readAnchor ?? readAnchorOnChain;
  const id = normalize(options.session);
  const chainId = NETWORKS[options.network].id;
  const warnings: string[] = [];
  const endpoints = options.platform
    ? endpointsFor(options.platform, id)
    : undefined;
  let report = {
    session: { id, sessionId: sessionIdToBytes32(id) },
    network: options.network,
    chainId,
    metadataUrl: endpoints?.metadata,
    checks: [] as Check[],
    warnings,
  };
  const finish = (
    fields: { outcome: Outcome; reason?: string } & Partial<VerificationReport>,
  ): VerificationReport => ({
    ...report,
    ...fields,
  });

  // 0. Metadata: the session's registry address and the published result summary.
  let metadata: AnchorMetadata | undefined;
  if (!options.contract && !endpoints)
    throw new VerifyError(
      "pass --platform (or --contract) to locate the session's registry",
    );
  if (endpoints) {
    try {
      metadata = (await fetchJson(
        endpoints.metadata,
        fetchImpl,
      )) as AnchorMetadata;
    } catch (error) {
      if (options.contract) {
        warnings.push(
          `metadata unavailable (${message(error)}); continuing with --contract`,
        );
      } else if (error instanceof HttpError && error.status === 404) {
        return finish({
          outcome: "NOT_ANCHORED",
          reason: "the platform has no anchor record for this session",
        });
      } else {
        throw new VerifyError(`could not fetch metadata: ${message(error)}`);
      }
    }
  }
  if (metadata && metadata.chainId !== null && metadata.chainId !== chainId) {
    throw new VerifyError(
      `session was anchored on chain ${metadata.chainId}, not ${options.network} (${chainId})`,
    );
  }
  const contract = resolveContract(options.contract, metadata, warnings);
  if (!contract) {
    return finish({
      outcome: "NOT_ANCHORED",
      reason: `the platform reports anchorStatus ${metadata?.anchorStatus ?? "unknown"} with no registry address yet`,
    });
  }
  report = { ...report, contract } as typeof report;

  // 1. On-chain commitment.
  let onChain: OnChainAnchor;
  try {
    onChain = await readAnchor({
      network: options.network,
      contract,
      sessionId: report.session.sessionId,
      rpcUrl: options.rpcUrl,
    });
  } catch (error) {
    throw new VerifyError(
      `could not read ${contract} on ${options.network}: ${message(error)}`,
    );
  }
  if (onChain.timestamp === 0n) {
    return finish({
      outcome: "NOT_ANCHORED",
      reason: `${contract} has no commitment for this session`,
      onChain,
    });
  }

  // 2. Dataset.
  const datasetUrl = options.datasetUrl ?? endpoints?.dataset;
  if (!datasetUrl)
    throw new VerifyError(
      "pass --platform or --dataset-url to locate the dataset",
    );
  let dataset: unknown;
  try {
    dataset = await fetchJson(datasetUrl, fetchImpl);
  } catch (error) {
    if (error instanceof SyntaxError)
      return finish({
        outcome: "FAIL",
        reason: error.message,
        onChain,
        datasetUrl,
      });
    throw new VerifyError(`could not fetch dataset: ${message(error)}`);
  }

  // 3. Recompute.
  let recomputed: Commitment;
  try {
    recomputed = computeCommitment(dataset);
  } catch (error) {
    if (error instanceof UnsupportedSchemaVersionError) {
      return finish({
        outcome: "UNSUPPORTED",
        reason: error.message,
        onChain,
        datasetUrl,
      });
    }
    if (error instanceof DatasetError) {
      return finish({
        outcome: "FAIL",
        reason: `${error.code}: ${error.message}`,
        onChain,
        datasetUrl,
      });
    }
    throw error;
  }

  // 4. Compare.
  const checks: Check[] = [
    {
      name: "merkleRoot",
      ok: same(onChain.merkleRoot, recomputed.merkleRoot),
      expected: onChain.merkleRoot,
      actual: recomputed.merkleRoot,
    },
    {
      name: "tallyHash",
      ok: same(onChain.tallyHash, recomputed.tallyHash),
      expected: onChain.tallyHash,
      actual: recomputed.tallyHash,
    },
  ];
  const resultDiff = metadata?.result
    ? diffResult(metadata, recomputed)
    : undefined;
  if (metadata?.result)
    checks.push({ name: "resultSummary", ok: resultDiff === undefined });
  else
    warnings.push(
      "no published result summary to compare (metadata not fetched)",
    );

  const failed = checks.filter((check) => !check.ok).map((check) => check.name);
  return finish({
    outcome: failed.length === 0 ? "PASS" : "FAIL",
    reason:
      failed.length === 0 ? undefined : `mismatch in ${failed.join(", ")}`,
    onChain,
    datasetUrl,
    recomputed,
    checks,
    resultDiff,
  });
}

function normalize(session: string): string {
  try {
    return normalizeSessionId(session);
  } catch (error) {
    throw new VerifyError(message(error));
  }
}

function endpointsFor(
  platform: string,
  id: string,
): { metadata: string; dataset: string } {
  try {
    return verificationEndpoints(platform, id);
  } catch (error) {
    throw new VerifyError(message(error));
  }
}

function resolveContract(
  override: string | undefined,
  metadata: AnchorMetadata | undefined,
  warnings: string[],
): Address | undefined {
  if (override !== undefined) {
    if (!isAddress(override, { strict: false }))
      throw new VerifyError(`--contract is not an address: ${override}`);
    const address = getAddress(override);
    if (metadata?.anchorContract && !same(metadata.anchorContract, address)) {
      warnings.push(
        `--contract ${address} overrides the platform's anchorContract ${metadata.anchorContract}`,
      );
    }
    return address;
  }
  if (!metadata?.anchorContract) return undefined;
  if (!isAddress(metadata.anchorContract, { strict: false })) {
    throw new VerifyError(
      `metadata anchorContract is not an address: ${metadata.anchorContract}`,
    );
  }
  return getAddress(metadata.anchorContract);
}

/** Compares the platform's result summary with the recomputed tally; `undefined` when they agree. */
function diffResult(
  metadata: AnchorMetadata,
  recomputed: Commitment,
): ResultDiff | undefined {
  const totals = finalTotals(recomputed);
  const published = new Map(
    (metadata.result.options ?? []).map((option) => [option.id, option.votes]),
  );
  const ids = [
    ...new Set([...Object.keys(totals), ...published.keys()]),
  ].sort();
  const options = ids
    .map((id) => ({
      id,
      published: published.get(id) ?? null,
      recomputed: Object.hasOwn(totals, id) ? totals[id]! : null,
    }))
    .filter((row) => row.published !== row.recomputed);

  const winners = recomputed.tally.winners;
  const winner = winners.length === 1 ? winners[0]! : null;
  const { turnout } = metadata.result;
  const diff: ResultDiff = {
    options,
    ...(metadata.result.winner !== winner && {
      winner: { published: metadata.result.winner, recomputed: winner },
    }),
    ...(turnout !== recomputed.tally.ballotCount && {
      turnout: { published: turnout, recomputed: recomputed.tally.ballotCount },
    }),
  };
  return options.length > 0 || diff.winner || diff.turnout ? diff : undefined;
}

function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
