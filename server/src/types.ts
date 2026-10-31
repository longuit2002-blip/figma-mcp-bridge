export interface BridgeRequest {
  type: string;
  requestId: string;
  nodeIds?: string[];
  params?: Record<string, unknown>;
}

export interface TreeTruncationMeta {
  treeTruncated?: boolean;
  truncationReason?: string;
  omittedRoots?: number;
}

export const pickTreeTruncation = (source: TreeTruncationMeta): TreeTruncationMeta =>
  source.treeTruncated
    ? {
        treeTruncated: true,
        truncationReason: source.truncationReason,
        omittedRoots: source.omittedRoots,
      }
    : {};

export interface BridgeResponse extends TreeTruncationMeta {
  type: string;
  requestId: string;
  data?: unknown;
  error?: string;
}

export interface RPCRequest {
  tool: string;
  nodeIds?: string[];
  params?: Record<string, unknown>;
  fileKey?: string;
}

export interface RPCResponse extends TreeTruncationMeta {
  data?: unknown;
  error?: string;
}

export interface ConnectedFile {
  fileKey: string;
  fileName: string;
}

const READ_TIMEOUT_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 180_000;
const FOLLOWER_TIMEOUT_MARGIN_MS = 30_000;

const READ_TIMEOUT_REQUEST_TYPES: ReadonlySet<string> = new Set([
  "get_metadata",
  "get_styles",
  "get_variable_defs",
]);

export const bridgeTimeoutMs = (requestType: string): number =>
  READ_TIMEOUT_REQUEST_TYPES.has(requestType) ? READ_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;

export const followerTimeoutMs = (requestType: string): number =>
  bridgeTimeoutMs(requestType) + FOLLOWER_TIMEOUT_MARGIN_MS;

export enum Role {
  Unknown = 0,
  Leader = 1,
  Follower = 2,
}
