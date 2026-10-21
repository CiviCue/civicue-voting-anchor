import assert from "node:assert/strict";
import { describe, test } from "node:test";
import sessionIdFixture from "@civicue/voting-anchor-contracts/fixtures/session-id.json" with { type: "json" };
import { concatHex, keccak256 } from "viem";
import {
  canonicalJson,
  merkleRoot,
  normalizeSessionId,
  sessionIdToBytes32,
  verificationEndpoints,
} from "../src/index.ts";

describe("sessionId", () => {
  for (const { input, normalized, sessionId } of sessionIdFixture.cases) {
    test(`matches the contracts fixture for ${input}`, () => {
      assert.equal(normalizeSessionId(input), normalized);
      assert.equal(sessionIdToBytes32(input), sessionId);
    });
  }

  test("rejects anything but a 24-hex-character session id", () => {
    for (const bad of [
      "",
      "65f1c2a9e4b0d3f7a8c91e2",
      "65f1c2a9e4b0d3f7a8c91e20a",
      "zzf1c2a9e4b0d3f7a8c91e20",
    ]) {
      assert.throws(() => sessionIdToBytes32(bad), TypeError);
    }
  });
});

describe("canonicalJson", () => {
  test("sorts keys recursively, keeps array order, no whitespace", () => {
    assert.equal(
      canonicalJson({ b: [3, 1], a: { d: null, c: true } }),
      '{"a":{"c":true,"d":null},"b":[3,1]}',
    );
  });

  test("sorts keys by UTF-16 code units and escapes like JSON.stringify", () => {
    assert.equal(
      canonicalJson({ é: 1, z: 2, "😀": 3, '"q"': 4 }),
      '{"\\"q\\"":4,"z":2,"é":1,"😀":3}',
    );
  });

  test("rejects non-integer, negative and unsafe numbers", () => {
    for (const bad of [1.5, -1, Number.MAX_SAFE_INTEGER + 1, Number.NaN])
      assert.throws(() => canonicalJson(bad), TypeError);
    assert.throws(() => canonicalJson(undefined), TypeError);
  });
});

describe("merkleRoot", () => {
  const leaf = (n: number) => keccak256(`0x${n.toString(16).padStart(2, "0")}`);
  const node = (l: `0x${string}`, r: `0x${string}`) =>
    keccak256(concatHex(["0x01", l, r]));

  test("single leaf is the root", () =>
    assert.equal(merkleRoot([leaf(1)]), leaf(1)));

  test("promotes an unpaired node instead of duplicating it", () => {
    const [a, b, c] = [leaf(1), leaf(2), leaf(3)];
    assert.equal(merkleRoot([a, b, c]), node(node(a, b), c));
  });

  test("rejects an empty tree", () =>
    assert.throws(() => merkleRoot([]), RangeError));
});

describe("verificationEndpoints", () => {
  test("derives both paths from the platform base and lowercases the id", () => {
    assert.deepEqual(
      verificationEndpoints(
        "https://api.example.org/",
        "6650A3B2C1D0E9F8A7B6C5D4",
      ),
      {
        metadata:
          "https://api.example.org/v2/voting/sessions/6650a3b2c1d0e9f8a7b6c5d4/anchor",
        dataset:
          "https://api.example.org/v2/voting/sessions/6650a3b2c1d0e9f8a7b6c5d4/anchor/dataset",
      },
    );
  });

  test("keeps a base path prefix", () => {
    assert.equal(
      verificationEndpoints(
        "https://example.org/api",
        "65f1c2a9e4b0d3f7a8c91e20",
      ).metadata,
      "https://example.org/api/v2/voting/sessions/65f1c2a9e4b0d3f7a8c91e20/anchor",
    );
  });

  test("rejects non-http platforms", () =>
    assert.throws(() =>
      verificationEndpoints("file:///etc", "65f1c2a9e4b0d3f7a8c91e20"),
    ));
});
