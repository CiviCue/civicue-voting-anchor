// Sessions the devnet and the rehearsal tests are seeded with: every voting method and the edge
// cases the canonical schema calls out. Ids are derived from the scenario name, so they are stable.
import { keccak256, stringToHex } from "viem";
import type { VotingMethod } from "./encoder.ts";
import {
  castBallot,
  closeSession,
  computeRcvResult,
  createSession,
  type BallotPayload,
  type Store,
} from "./platform.ts";

export interface Scenario {
  name: string;
  method: VotingMethod;
  options: string[];
  budget?: number;
  ballots: BallotPayload[];
}

const pick = (...optionIds: string[]): BallotPayload => ({ optionIds });
const alloc = (allocations: Record<string, number>): BallotPayload => ({
  allocations,
});
const rank = (...rankedOptions: string[]): BallotPayload => ({ rankedOptions });

export const SCENARIOS: Scenario[] = [
  {
    name: "majority-basic",
    method: "MAJORITY",
    options: ["A", "B", "C"],
    ballots: [pick("A"), pick("B"), pick("A"), pick("C"), pick("A")],
  },
  {
    name: "majority-tie",
    method: "MAJORITY",
    options: ["A", "B", "C"],
    ballots: [pick("A"), pick("B"), pick("B"), pick("A")],
  },
  {
    name: "majority-multi-select-and-blank",
    method: "MAJORITY",
    options: ["A", "B", "C"],
    ballots: [pick("C", "A"), pick(), pick("B", "C"), pick("C")],
  },
  {
    name: "majority-unicode-options",
    method: "MAJORITY",
    options: ["公園", "圖書館", "Ä", "é"],
    ballots: [pick("公園"), pick("圖書館", "é"), pick("公園", "Ä")],
  },
  {
    name: "quadratic-basic",
    method: "QUADRATIC",
    options: ["A", "B", "C"],
    budget: 10,
    ballots: [
      alloc({ A: 2, B: 1 }),
      alloc({ C: 3 }),
      alloc({ A: 1, B: 1, C: 2 }),
    ],
  },
  {
    name: "quadratic-zero-allocations",
    method: "QUADRATIC",
    options: ["A", "B"],
    budget: 9,
    ballots: [alloc({ A: 3, B: 0 }), alloc({}), alloc({ A: 0, B: 2 })],
  },
  {
    name: "quadratic-tie",
    method: "QUADRATIC",
    options: ["A", "B"],
    budget: 4,
    ballots: [alloc({ A: 2 }), alloc({ B: 2 })],
  },
  {
    name: "ranked-first-round-majority",
    method: "RANKED_CHOICE",
    options: ["A", "B", "C"],
    ballots: [rank("A", "B"), rank("A"), rank("B", "C")],
  },
  {
    name: "ranked-elimination",
    method: "RANKED_CHOICE",
    options: ["A", "B", "C", "D"],
    ballots: [
      rank("A", "B"),
      rank("A", "C"),
      rank("A"),
      rank("B", "C", "D"),
      rank("B", "D"),
      rank("D", "B"),
      rank("D", "C"),
      rank("C", "D", "A"),
    ],
  },
  {
    name: "ranked-exhausted-and-partial",
    method: "RANKED_CHOICE",
    options: ["A", "B", "C"],
    ballots: [
      rank("A"),
      rank("A"),
      rank("B"),
      rank("B", "A"),
      rank("C"),
      rank(),
      rank("C", "B"),
    ],
  },
  // Round 2 ties B and C at 3; round 1 (B 3, C 2) breaks the tie, so C is eliminated.
  {
    name: "ranked-backward-tie-break",
    method: "RANKED_CHOICE",
    options: ["A", "B", "C", "D"],
    ballots: [
      rank("A"),
      rank("A"),
      rank("A"),
      rank("A"),
      rank("B"),
      rank("B"),
      rank("B"),
      rank("C"),
      rank("C"),
      rank("D", "C"),
    ],
  },
  // B, C, D tie for last in round 1 with no earlier round, so the smallest id (B) goes first.
  {
    name: "ranked-tie-by-id",
    method: "RANKED_CHOICE",
    options: ["A", "B", "C", "D"],
    ballots: [
      rank("A"),
      rank("A"),
      rank("A"),
      rank("B"),
      rank("B"),
      rank("C", "B"),
      rank("C", "B"),
      rank("D", "C"),
      rank("D", "A"),
    ],
  },
  {
    name: "ranked-final-tie",
    method: "RANKED_CHOICE",
    options: ["A", "B", "C"],
    ballots: [rank("A", "C"), rank("B", "C"), rank("C")],
  },
  {
    name: "ranked-all-exhausted",
    method: "RANKED_CHOICE",
    options: ["A", "B"],
    ballots: [rank(), rank()],
  },
  // A void (流局) session: closes with no ballots and is never anchored.
  {
    name: "void-no-ballots",
    method: "MAJORITY",
    options: ["A", "B"],
    ballots: [],
  },
];

/** A stable 24-hex-character id derived from a label. */
export const sessionIdFor = (label: string): string =>
  keccak256(stringToHex(label)).slice(2, 26);

/** Creates, fills, and closes a scenario's session (plus computeRcvResult for ranked choice). */
export function seedScenario(store: Store, scenario: Scenario): string {
  const id = sessionIdFor(scenario.name);
  createSession(store, {
    id,
    votingSystem: scenario.method,
    options: scenario.options,
    ...(scenario.budget !== undefined && { budget: scenario.budget }),
  });
  scenario.ballots.forEach((payload, index) =>
    castBallot(store, id, sessionIdFor(`${scenario.name}#${index}`), payload),
  );
  closeSession(store, id);
  if (scenario.method === "RANKED_CHOICE") computeRcvResult(store, id);
  return id;
}
