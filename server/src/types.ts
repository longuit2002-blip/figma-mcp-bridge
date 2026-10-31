export interface BridgeRequest {
  type: string;
  requestId: string;
  nodeIds?: string[];
  params?: Record<string, unknown>;
}

export interface BridgeResponse {
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

export interface RPCResponse {
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

export const bridgeTimeoutMs = (requestType: string): number =>
  requestType.startsWith("get_") && requestType !== "get_screenshot"
    ? READ_TIMEOUT_MS
    : DEFAULT_TIMEOUT_MS;

export const followerTimeoutMs = (requestType: string): number =>
  bridgeTimeoutMs(requestType) + FOLLOWER_TIMEOUT_MARGIN_MS;

export enum Role {
  Unknown = 0,
  Leader = 1,
  Follower = 2,
}
