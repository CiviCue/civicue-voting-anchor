import type { Address, Hex } from "viem";
import { normalizeSessionId } from "./session-id.ts";

/**
 * The public verification API contract (docs/verification-api.md). The CiviCue platform
 * implements it; the verifier derives both URLs from a platform base URL and a session id.
 */
export function verificationEndpoints(
  platform: string,
  sessionId: string,
): { metadata: string; dataset: string } {
  const base = new URL(platform);
  if (base.protocol !== "https:" && base.protocol !== "http:") {
    throw new TypeError(`platform must be an http(s) URL, got "${platform}"`);
  }
  const root = `${base.origin}${base.pathname.replace(/\/+$/, "")}`;
  const metadata = `${root}/v2/voting/sessions/${normalizeSessionId(sessionId)}/anchor`;
  return { metadata, dataset: `${metadata}/dataset` };
}

export type AnchorStatus = "PENDING" | "COMPUTED" | "ANCHORED" | "FAILED";

/** `GET /v2/voting/sessions/:id/anchor` response body. */
export interface AnchorMetadata {
  readonly sessionId: string;
  readonly votingMethod: "MAJORITY" | "QUADRATIC" | "RANKED_CHOICE";
  readonly anchorStatus: AnchorStatus;
  readonly schemaVersion: number;
  readonly merkleRoot: Hex;
  readonly tallyHash: Hex;
  readonly anchorTxHash: Hex | null;
  readonly anchorContract: Address | null;
  readonly chainId: number | null;
  readonly result: ResultSummary;
}

/** Human-readable outcome; must agree with what `tallyHash` commits to. */
export interface ResultSummary {
  /** The single winning option id, or `null` on a tie or when there is no winner. */
  readonly winner: string | null;
  /** Number of ballots in the dataset. */
  readonly turnout: number;
  /** Votes per option. For RANKED_CHOICE, only the options in the final round, with their final-round counts. */
  readonly options: readonly { readonly id: string; readonly votes: number }[];
}

export class HttpError extends Error {
  override readonly name = "HttpError";
  readonly url: string;
  readonly status: number;

  constructor(url: string, status: number) {
    super(`GET ${url} returned HTTP ${status}`);
    this.url = url;
    this.status = status;
  }
}

/** Fetches and parses a JSON document. Throws {@link HttpError} on a non-2xx response. */
export async function fetchJson(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  const response = await fetchImpl(url, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new HttpError(url, response.status);
  const body = await response.text();
  try {
    return JSON.parse(body);
  } catch {
    throw new SyntaxError(`GET ${url} did not return valid JSON`);
  }
}
