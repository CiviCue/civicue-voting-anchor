import { keccak256, stringToBytes, type Hex } from "viem";

const SESSION_ID = /^[0-9a-f]{24}$/;

/** Lowercases a session id and checks it is 24 hex characters. */
export function normalizeSessionId(id: string): string {
  const normalized = id.trim().toLowerCase();
  if (!SESSION_ID.test(normalized)) {
    throw new TypeError(`session id must be 24 hex characters, got "${id}"`);
  }
  return normalized;
}

/** The on-chain key: `keccak256(bytes(lowercaseSessionIdString))`. Accepts any letter case. */
export function sessionIdToBytes32(id: string): Hex {
  return keccak256(stringToBytes(normalizeSessionId(id)));
}
