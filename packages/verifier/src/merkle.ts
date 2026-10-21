import { concatHex, keccak256, type Hex } from "viem";

const NODE_PREFIX: Hex = "0x01";

/**
 * Builds the Merkle root over `leaves` in order. An internal node is
 * `keccak256(0x01 ‖ left ‖ right)`; an unpaired last node is promoted to the next level
 * unchanged (never duplicated). A single leaf is its own root.
 *
 * Leaves are domain-separated by their schema tag, whose first byte is never `0x01`, so a
 * leaf preimage cannot collide with an internal-node preimage.
 */
export function merkleRoot(leaves: readonly Hex[]): Hex {
  if (leaves.length === 0)
    throw new RangeError("cannot build a Merkle tree with no leaves");
  let level = [...leaves];
  while (level.length > 1) {
    const next: Hex[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      const right = level[i + 1];
      next.push(
        right === undefined
          ? left
          : keccak256(concatHex([NODE_PREFIX, left, right])),
      );
    }
    level = next;
  }
  return level[0]!;
}
