/**
 * Serializes `value` to canonical JSON: the RFC 8785 (JCS) encoding restricted to
 * non-negative safe integers. Object keys are sorted by UTF-16 code units, there is no
 * whitespace, strings use `JSON.stringify` escaping, and array order is preserved.
 *
 * @throws {TypeError} for any other number, `undefined`, or a non-JSON value.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(
        `canonical numbers must be non-negative safe integers, got ${value}`,
      );
    }
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    const object = value as Record<string, unknown>;
    const members = Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`);
    return `{${members.join(",")}}`;
  }
  throw new TypeError(`cannot canonicalize a value of type ${typeof value}`);
}
