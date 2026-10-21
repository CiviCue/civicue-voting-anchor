// The off-chain producer: turns a PENDING session
// into a COMPUTED one with a persisted merkleRoot + tallyHash, and regenerates the canonical
// dataset on demand from the session's ballots. No dataset blob is stored.
import { createHash } from "node:crypto";
import {
  encodeCommitment,
  topOptions,
  type Dataset,
  type DatasetRow,
  type Tally,
} from "./encoder.ts";
import type { Store, VotingSession } from "./platform.ts";

/** The schema version new sessions are computed under. */
export const CURRENT_SCHEMA_VERSION = 1;

/**
 * Regenerates the anonymized dataset. `voter` numbers come from ordering the ballots on
 * `hash(ballotId)`, so the output is reproducible with no stored mapping and carries no
 * submission order. The session's persisted schema version is used once it exists.
 */
export function buildDataset(store: Store, session: VotingSession): Dataset {
  const ordered = store
    .ballotsOf(session.id)
    .map((ballot) => ({
      ballot,
      key: createHash("sha256").update(ballot.ballotId).digest("hex"),
    }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const ballots = ordered.map(
    ({ ballot }, index) =>
      ({ voter: index + 1, ...ballot.payload }) as DatasetRow,
  );
  return {
    schemaVersion: session.anchorSchemaVersion ?? CURRENT_SCHEMA_VERSION,
    votingMethod: session.votingSystem,
    options: session.options.map((option) => option.id),
    ...(session.votingSystem === "QUADRATIC" && {
      voiceCredits: session.budget!,
    }),
    ballots,
  };
}

/**
 * The tally as the platform recorded it: live per-option counters for MAJORITY and QUADRATIC,
 * and computeRcvResult's rounds for RANKED_CHOICE. This is the value the anchor vouches for.
 */
export function recordedTally(
  session: VotingSession,
  schemaVersion: number,
): Tally {
  const base = {
    schemaVersion,
    votingMethod: session.votingSystem,
    ballotCount: session.turnout,
  };
  if (session.votingSystem === "RANKED_CHOICE") {
    const rounds = session.rcvRounds;
    if (!rounds) throw new Error(`session ${session.id} has no RCV result yet`);
    const last = rounds.at(-1)!;
    const active = Object.values(last.totals).reduce(
      (sum, votes) => sum + votes,
      0,
    );
    const majority = Object.keys(last.totals).filter(
      (id) => last.totals[id]! * 2 > active,
    );
    const winners =
      active === 0
        ? []
        : majority.length === 1
          ? majority
          : Object.keys(last.totals).sort();
    return { ...base, rounds, winners };
  }
  const totals = Object.fromEntries(
    session.options.map((option) => [option.id, option.votes]),
  );
  return {
    ...base,
    totals,
    ...(session.votingSystem === "QUADRATIC" && {
      voiceCredits: session.budget!,
    }),
    winners: topOptions(totals),
  };
}

/** Computes every PENDING session. Already computed sessions are never touched (idempotent). */
export function computePending(store: Store): VotingSession[] {
  const computed: VotingSession[] = [];
  for (const session of store.sessions.values()) {
    if (session.anchorStatus !== "PENDING") continue;
    const dataset = buildDataset(store, session);
    const { merkleRoot, tallyHash } = encodeCommitment(
      dataset,
      recordedTally(session, dataset.schemaVersion),
    );
    Object.assign(session, {
      anchorSchemaVersion: dataset.schemaVersion,
      merkleRoot,
      tallyHash,
      anchorStatus: "COMPUTED",
    });
    computed.push(session);
  }
  return computed;
}
