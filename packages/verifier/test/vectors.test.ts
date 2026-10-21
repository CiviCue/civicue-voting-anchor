import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  computeCommitment,
  DatasetError,
  UnsupportedSchemaVersionError,
  v1,
} from "../src/index.ts";
import { loadVectors, type ConformanceVector } from "../src/vectors.ts";

const vectors = loadVectors();
const byPath = (path: string): ConformanceVector =>
  vectors.find((vector) => vector.path === path)!;

function run(
  vector: ConformanceVector,
): { merkleRoot: string; tallyHash: string } | { error: string } {
  try {
    const { merkleRoot, tallyHash } =
      vector.bindVersion === undefined
        ? computeCommitment(vector.dataset)
        : v1.commitV1(vector.dataset, vector.bindVersion);
    return { merkleRoot, tallyHash };
  } catch (error) {
    if (error instanceof UnsupportedSchemaVersionError)
      return { error: "UNSUPPORTED_SCHEMA_VERSION" };
    if (error instanceof DatasetError) return { error: error.code };
    throw error;
  }
}

describe("conformance vectors", () => {
  test("covers every method and the version binding", () => {
    for (const dir of [
      "majority",
      "quadratic",
      "ranked-choice",
      "version-binding",
    ]) {
      assert.ok(
        vectors.some((vector) => vector.path.startsWith(`v1/${dir}/`)),
        dir,
      );
    }
  });

  for (const vector of vectors) {
    test(vector.path, () => assert.deepEqual(run(vector), vector.expected));
  }

  test("input ordering does not change the commitment", () => {
    assert.deepEqual(
      byPath("v1/majority/unordered-input.json").expected,
      byPath("v1/majority/basic.json").expected,
    );
  });

  test("binding a different schemaVersion changes both hashes", () => {
    const v1Expected = byPath("v1/majority/basic.json").expected;
    const v2Expected = byPath(
      "v1/version-binding/majority-bound-v2.json",
    ).expected;
    assert.ok(!("error" in v1Expected) && !("error" in v2Expected));
    assert.notEqual(v2Expected.merkleRoot, v1Expected.merkleRoot);
    assert.notEqual(v2Expected.tallyHash, v1Expected.tallyHash);
  });
});
