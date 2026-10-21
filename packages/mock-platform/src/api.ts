// The public verification API (packages/verifier/docs/verification-api.md), served from the store.
import { createServer, type RequestListener, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { canonicalDataset } from "./encoder.ts";
import type { Store, VotingSession } from "./platform.ts";
import { buildDataset } from "./producer.ts";

const ROUTE = /^\/v2\/voting\/sessions\/([0-9a-f]{24})\/anchor(\/dataset)?$/;
const DATASET_SERVED: VotingSession["anchorStatus"][] = [
  "COMPUTED",
  "ANCHORED",
  "FAILED",
];

/** `GET …/anchor`: verification fields plus the human-readable result summary. */
export function anchorMetadata(session: VotingSession) {
  const counts =
    session.votingSystem === "RANKED_CHOICE"
      ? Object.entries(session.rcvRounds!.at(-1)!.totals).map(
          ([id, votes]) => ({ id, votes }),
        )
      : session.options.map(({ id, votes }) => ({ id, votes }));
  return {
    sessionId: session.id,
    votingMethod: session.votingSystem,
    anchorStatus: session.anchorStatus,
    schemaVersion: session.anchorSchemaVersion ?? null,
    merkleRoot: session.merkleRoot ?? null,
    tallyHash: session.tallyHash ?? null,
    anchorTxHash: session.anchorTxHash ?? null,
    anchorContract: session.anchorContract ?? null,
    chainId: session.chainId ?? null,
    result: {
      winner: session.result.winner,
      turnout: session.turnout,
      options: counts,
    },
  };
}

/**
 * Routes the two endpoints. `overrides` lets a test serve something other than the store's
 * view at a path, such as a tampered summary or an archived dataset copy.
 */
export function apiHandler(
  store: Store,
  overrides = new Map<string, unknown>(),
): RequestListener {
  return (req, res) => {
    const send = (status: number, body: unknown) =>
      res
        .writeHead(status, { "content-type": "application/json" })
        .end(JSON.stringify(body));
    const url = req.url ?? "";
    if (req.method !== "GET") return send(405, { error: "method not allowed" });
    if (overrides.has(url)) return send(200, overrides.get(url));

    const match = ROUTE.exec(url);
    const session = match && store.sessions.get(match[1]!);
    if (
      !session ||
      session.status !== "COMPLETED" ||
      session.anchorStatus === "NONE"
    )
      return send(404, { error: "no anchor record" });
    if (!match[2]) return send(200, anchorMetadata(session));
    if (!DATASET_SERVED.includes(session.anchorStatus))
      return send(404, { error: "not computed" });
    return send(200, canonicalDataset(buildDataset(store, session)));
  };
}

export async function serveApi(
  store: Store,
  port = 0,
  overrides?: Map<string, unknown>,
): Promise<{ server: Server; url: string }> {
  const server = createServer(apiHandler(store, overrides));
  await new Promise<void>((resolve) =>
    server.listen(port, "127.0.0.1", resolve),
  );
  return {
    server,
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  };
}
