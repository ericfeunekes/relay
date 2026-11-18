import { createMcpHandler } from 'agents/mcp/server';
import { createServer } from './mcp';
import type { StoreAPI } from './contracts';

export function serveMcp<T extends { STORE: DurableObjectNamespace }>(request: Request, env: T, ctx: ExecutionContext) {
  const store = env.STORE.get(env.STORE.idFromName('agent-mail')) as unknown as StoreAPI;
  return createMcpHandler(() => createServer(store), { corsOptions: false })(request, env, ctx);
}
