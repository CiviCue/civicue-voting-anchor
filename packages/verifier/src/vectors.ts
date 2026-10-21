import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { Hex } from "viem";

/**
 * A conformance vector. Exactly one of `expected.error` or the hash pair is set. When
 * `bindVersion` is present, the dataset is processed under the rules of its own
 * `schemaVersion` but with `bindVersion` bound into both hashes — it proves the version is
 * committed by `merkleRoot` and `tallyHash`.
 */
export interface ConformanceVector {
  /** Path under `vectors/`, e.g. `v1/majority/basic.json`. */
  readonly path: string;
  readonly description: string;
  readonly bindVersion?: number;
  readonly dataset: unknown;
  readonly expected:
    | {
        readonly merkleRoot: Hex;
        readonly tallyHash: Hex;
        readonly error?: never;
      }
    | {
        readonly error:
          "INVALID_DATASET" | "BUDGET_EXCEEDED" | "UNSUPPORTED_SCHEMA_VERSION";
      };
}

/** Absolute path of the packaged `vectors/` directory. */
export const vectorsDir = fileURLToPath(
  new URL("../vectors/", import.meta.url),
);

/** Loads every conformance vector, sorted by path. Vectors of a released schema version never change. */
export function loadVectors(): ConformanceVector[] {
  return readdirSync(vectorsDir, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => {
      const path = join(vectorsDir, file);
      const vector = JSON.parse(readFileSync(path, "utf8")) as Omit<
        ConformanceVector,
        "path"
      >;
      return {
        path: relative(vectorsDir, path).split("\\").join("/"),
        ...vector,
      };
    });
}
