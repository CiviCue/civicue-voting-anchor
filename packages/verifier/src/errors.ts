export type DatasetErrorCode = "INVALID_DATASET" | "BUDGET_EXCEEDED";

/** The dataset cannot reproduce a valid commitment: it is malformed or breaks a voting rule. */
export class DatasetError extends Error {
  override readonly name = "DatasetError";
  readonly code: DatasetErrorCode;

  constructor(code: DatasetErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** The dataset declares a `schemaVersion` this verifier does not implement. */
export class UnsupportedSchemaVersionError extends Error {
  override readonly name = "UnsupportedSchemaVersionError";
  readonly schemaVersion: unknown;

  constructor(schemaVersion: unknown, supported: readonly number[]) {
    super(
      `schemaVersion ${JSON.stringify(schemaVersion)} is not supported by this verifier ` +
        `(supported: ${supported.join(", ")}); upgrade @civicue/voting-anchor-verifier`,
    );
    this.schemaVersion = schemaVersion;
  }
}

export function invalid(message: string): DatasetError {
  return new DatasetError("INVALID_DATASET", message);
}
