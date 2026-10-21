// The voting side of the mock platform: ballots update live per-option counters as they are
// cast, ranked-choice results come from a separate computeRcvResult step, and closing a session
// raises the anchor flag. The producer only reads this state; it never recounts ballots itself.
import type { Hex } from "viem";
import type { Round, VotingMethod } from "./encoder.ts";

export type AnchorStatus =
  "NONE" | "PENDING" | "COMPUTED" | "ANCHORED" | "FAILED";

export type BallotPayload =
  | { optionIds: string[] }
  | { allocations: Record<string, number> }
  | { rankedOptions: string[] };

export interface VotingSession {
  id: string;
  votingSystem: VotingMethod;
  options: { id: string; votes: number }[];
  /** QUADRATIC only: the uniform per-voter voice-credit budget. */
  budget?: number;
  status: "ACTIVE" | "COMPLETED";
  turnout: number;
  result: { winner: string | null };
  /** RANKED_CHOICE only: written by computeRcvResult after close. */
  rcvRounds?: Round[];
  anchorStatus: AnchorStatus;
  anchorSchemaVersion?: number;
  merkleRoot?: Hex;
  tallyHash?: Hex;
  anchorTxHash?: Hex;
  anchorContract?: Hex;
  chainId?: number;
}

export interface Ballot {
  ballotId: string;
  sessionId: string;
  payload: BallotPayload;
}

export class BallotRejected extends Error {
  readonly code: "INVALID_BALLOT" | "BUDGET_EXCEEDED";

  constructor(code: BallotRejected["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export class Store {
  readonly sessions = new Map<string, VotingSession>();
  readonly ballots: Ballot[] = [];

  session(id: string): VotingSession {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`no session ${id}`);
    return session;
  }

  ballotsOf(sessionId: string): Ballot[] {
    return this.ballots.filter((ballot) => ballot.sessionId === sessionId);
  }
}

export function createSession(
  store: Store,
  init: {
    id: string;
    votingSystem: VotingMethod;
    options: string[];
    budget?: number;
  },
): VotingSession {
  if (!/^[0-9a-f]{24}$/.test(init.id))
    throw new Error(`not a 24-hex-character session id: ${init.id}`);
  const session: VotingSession = {
    id: init.id,
    votingSystem: init.votingSystem,
    options: init.options.map((id) => ({ id, votes: 0 })),
    ...(init.budget !== undefined && { budget: init.budget }),
    status: "ACTIVE",
    turnout: 0,
    result: { winner: null },
    anchorStatus: "NONE",
  };
  store.sessions.set(session.id, session);
  return session;
}

/** Validates a ballot, stores it, and updates the live counters atomically. */
export function castBallot(
  store: Store,
  sessionId: string,
  ballotId: string,
  payload: BallotPayload,
): void {
  const session = store.session(sessionId);
  if (session.status !== "ACTIVE")
    throw new BallotRejected("INVALID_BALLOT", "session is closed");
  const known = new Set(session.options.map((option) => option.id));
  const distinctKnown = (ids: string[]) =>
    new Set(ids).size === ids.length && ids.every((id) => known.has(id));
  const counter = (id: string) =>
    session.options.find((option) => option.id === id)!;

  if (session.votingSystem === "MAJORITY" && "optionIds" in payload) {
    if (!distinctKnown(payload.optionIds))
      throw new BallotRejected("INVALID_BALLOT", "bad selection");
    for (const id of payload.optionIds) counter(id).votes += 1;
  } else if (session.votingSystem === "QUADRATIC" && "allocations" in payload) {
    const entries = Object.entries(payload.allocations);
    if (
      !entries.every(
        ([id, votes]) =>
          known.has(id) && Number.isSafeInteger(votes) && votes >= 0,
      )
    )
      throw new BallotRejected("INVALID_BALLOT", "bad allocation");
    const cost = entries.reduce((sum, [, votes]) => sum + votes * votes, 0);
    if (cost > session.budget!)
      throw new BallotRejected(
        "BUDGET_EXCEEDED",
        `costs ${cost} of ${session.budget}`,
      );
    for (const [id, votes] of entries) counter(id).votes += votes;
  } else if (
    session.votingSystem === "RANKED_CHOICE" &&
    "rankedOptions" in payload
  ) {
    if (!distinctKnown(payload.rankedOptions))
      throw new BallotRejected("INVALID_BALLOT", "bad ranking");
  } else {
    throw new BallotRejected(
      "INVALID_BALLOT",
      `payload does not match ${session.votingSystem}`,
    );
  }
  store.ballots.push({ ballotId, sessionId, payload });
  session.turnout += 1;
}

/**
 * Closes a session (`votingService.closeSession()`). MAJORITY and QUADRATIC tallies are final at
 * close, so they become PENDING at once. RANKED_CHOICE waits for computeRcvResult. A void
 * session (turnout 0) is never anchored.
 */
export function closeSession(store: Store, sessionId: string): void {
  const session = store.session(sessionId);
  session.status = "COMPLETED";
  if (session.votingSystem === "RANKED_CHOICE") return;
  const best = Math.max(0, ...session.options.map((option) => option.votes));
  const leaders = session.options.filter((option) => option.votes === best);
  session.result.winner =
    best > 0 && leaders.length === 1 ? leaders[0]!.id : null;
  if (session.turnout > 0) session.anchorStatus = "PENDING";
}

/** The platform's instant-runoff count, run after close; marks the session PENDING when done. */
export function computeRcvResult(store: Store, sessionId: string): void {
  const session = store.session(sessionId);
  if (
    session.votingSystem !== "RANKED_CHOICE" ||
    session.status !== "COMPLETED"
  )
    throw new Error("computeRcvResult needs a closed RANKED_CHOICE session");
  const rankings = store
    .ballotsOf(sessionId)
    .map(
      (ballot) => (ballot.payload as { rankedOptions: string[] }).rankedOptions,
    );
  const rounds: Round[] = [];
  let standing = session.options.map((option) => option.id);
  let winners: string[] = [];

  for (;;) {
    const totals: Record<string, number> = Object.fromEntries(
      standing.map((id) => [id, 0]),
    );
    let exhausted = 0;
    for (const ranking of rankings) {
      const choice = ranking.find((id) => standing.includes(id));
      if (choice === undefined) exhausted += 1;
      else totals[choice]! += 1;
    }
    const round: Round = { totals, exhausted, eliminated: null };
    rounds.push(round);
    const active = rankings.length - exhausted;
    const counts = standing.map((id) => totals[id]!);
    const majority = standing.find((id) => totals[id]! * 2 > active);
    if (active === 0) break;
    if (majority !== undefined) {
      winners = [majority];
      break;
    }
    if (counts.every((count) => count === counts[0])) {
      winners = [...standing].sort();
      break;
    }
    round.eliminated = loser(standing, rounds);
    standing = standing.filter((id) => id !== round.eliminated);
  }

  session.rcvRounds = rounds;
  session.result.winner = winners.length === 1 ? winners[0]! : null;
  if (session.turnout > 0) session.anchorStatus = "PENDING";
}

/** Fewest votes this round; ties broken by earlier rounds, most recent first, then by smallest id. */
function loser(standing: string[], rounds: Round[]): string {
  const fewest = (candidates: string[], round: Round) => {
    const low = Math.min(...candidates.map((id) => round.totals[id]!));
    return candidates.filter((id) => round.totals[id] === low);
  };
  let tied = fewest(standing, rounds.at(-1)!);
  for (let i = rounds.length - 2; i >= 0 && tied.length > 1; i--)
    tied = fewest(tied, rounds[i]!);
  return [...tied].sort()[0]!;
}
