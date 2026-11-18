export type Arguments = Record<string, unknown>;

export interface StoreAPI {
  call(operation: string, args: Arguments): Promise<unknown>;
}

export interface Env {
  STORE: DurableObjectNamespace;
  MCP_TOKEN: string;
}
