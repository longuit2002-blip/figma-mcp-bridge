import { followerTimeoutMs } from "./types.js";
import type { BridgeResponse, ConnectedFile, RPCRequest, RPCResponse } from "./types.js";

const linkSignals = (sources: AbortSignal[]): { signal: AbortSignal; dispose: () => void } => {
  const controller = new AbortController();
  const listeners: Array<() => void> = [];
  const dispose = () => {
    for (const remove of listeners) remove();
    listeners.length = 0;
  };
  for (const source of sources) {
    if (source.aborted) {
      controller.abort(source.reason);
      break;
    }
    const onAbort = () => {
      controller.abort(source.reason);
      dispose();
    };
    source.addEventListener("abort", onAbort, { once: true });
    listeners.push(() => source.removeEventListener("abort", onAbort));
  }
  return { signal: controller.signal, dispose };
};

/**
 * Follower proxies MCP tool calls to the leader via HTTP /rpc.
 */
export class Follower {
  constructor(private leaderUrl: string) {}

  send(
    requestType: string,
    nodeIds?: string[],
    fileKey?: string,
    signal?: AbortSignal
  ): Promise<BridgeResponse> {
    return this.sendWithParams(requestType, nodeIds, undefined, fileKey, signal);
  }

  async sendWithParams(
    requestType: string,
    nodeIds?: string[],
    params?: Record<string, unknown>,
    fileKey?: string,
    signal?: AbortSignal
  ): Promise<BridgeResponse> {
    const rpcReq: RPCRequest = { tool: requestType };
    if (nodeIds && nodeIds.length > 0) rpcReq.nodeIds = nodeIds;
    if (params && Object.keys(params).length > 0) rpcReq.params = params;
    if (fileKey) rpcReq.fileKey = fileKey;

    const timeoutSignal = AbortSignal.timeout(followerTimeoutMs(requestType));
    const linked = linkSignals(signal ? [timeoutSignal, signal] : [timeoutSignal]);
    try {
      const response = await fetch(`${this.leaderUrl}/rpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rpcReq),
        signal: linked.signal,
      });

      if (!response.ok) {
        // The leader answers validation failures with a 400 whose body names the
        // offending field — surface it instead of a bare status code (#35).
        const body = (await response.json().catch(() => null)) as RPCResponse | null;
        throw new Error(body?.error ?? `Leader returned status ${response.status}`);
      }

      const rpcResp = (await response.json()) as RPCResponse;

      if (rpcResp.error) {
        throw new Error(rpcResp.error);
      }

      return {
        type: requestType,
        requestId: "",
        data: rpcResp.data,
      };
    } finally {
      linked.dispose();
    }
  }

  async listConnectedFiles(): Promise<ConnectedFile[]> {
    const response = await fetch(`${this.leaderUrl}/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "list_files" } as RPCRequest),
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      throw new Error(`Leader returned status ${response.status}`);
    }

    const rpcResp = (await response.json()) as RPCResponse;
    if (rpcResp.error) {
      throw new Error(rpcResp.error);
    }

    return (rpcResp.data as ConnectedFile[]) ?? [];
  }

  async ping(): Promise<boolean> {
    try {
      const response = await fetch(`${this.leaderUrl}/ping`, {
        signal: AbortSignal.timeout(2_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
