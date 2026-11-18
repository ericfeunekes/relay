import { serveMcp } from './serve';
import type { Env } from './contracts';
export { ProjectStore } from './store';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (new URL(request.url).pathname !== '/mcp') return new Response('Not found', { status: 404 });
    // This credential is for the loopback development Worker.
    if (!env.MCP_TOKEN) return new Response('Service credential is not configured', { status: 503 });
    if (request.headers.get('Authorization') !== `Bearer ${env.MCP_TOKEN}`) {
      return new Response('Unauthorized', { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } });
    }
    return serveMcp(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
