export { canonicalJson } from "./canonical-json.ts";
export { normalizeSessionId, sessionIdToBytes32 } from "./session-id.ts";
export { merkleRoot } from "./merkle.ts";
export {
  DatasetError,
  UnsupportedSchemaVersionError,
  type DatasetErrorCode,
} from "./errors.ts";
export {
  computeCommitment,
  finalTotals,
  SUPPORTED_SCHEMA_VERSIONS,
  type Commitment,
  type Dataset,
  type SchemaVersion,
  type Tally,
} from "./commitment.ts";
export * as v1 from "./v1/index.ts";
export {
  fetchJson,
  HttpError,
  verificationEndpoints,
  type AnchorMetadata,
  type AnchorStatus,
  type ResultSummary,
} from "./api.ts";
export {
  isNetworkName,
  NETWORKS,
  readAnchor,
  type NetworkName,
  type OnChainAnchor,
  type ReadAnchorOptions,
} from "./chain.ts";
export {
  verifySession,
  VerifyError,
  type Check,
  type OptionDelta,
  type Outcome,
  type ResultDiff,
  type VerificationReport,
  type VerifyOptions,
} from "./verify.ts";
export { formatReport, GUARANTEE } from "./report.ts";
