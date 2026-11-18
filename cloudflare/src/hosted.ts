import { createRemoteJWKSet, jwtVerify } from 'jose';
import { serveMcp } from './serve';
export { ProjectStore } from './store';

interface HostedEnv {
  STORE: DurableObjectNamespace;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  CF_ACCESS_OWNER_EMAIL?: string;
}

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export default {
  async fetch(request: Request, env: HostedEnv, ctx: ExecutionContext): Promise<Response> {
    if (new URL(request.url).pathname !== '/mcp') return new Response('Not found', { status: 404 });
    const { CF_ACCESS_TEAM_DOMAIN: issuer, CF_ACCESS_AUD: audience, CF_ACCESS_OWNER_EMAIL: owner } = env;
    if (!issuer || !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer)
      || !audience || !/^[a-f0-9]{64}$/.test(audience) || !owner || !/^[^\s@]+@[^\s@]+$/.test(owner)) {
      return new Response('Access is not configured', { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }

    // Access handles OAuth at the edge. The origin independently verifies its signed assertion.
    const assertion = request.headers.get('Cf-Access-Jwt-Assertion');
    const deny = () => new Response('Access denied', { status: 403, headers: { 'Cache-Control': 'no-store' } });
    if (!assertion || assertion.length > 4096) return deny();
    try {
      let keys = keySets.get(issuer);
      if (!keys) {
        keys = createRemoteJWKSet(new URL('/cdn-cgi/access/certs', issuer), { timeoutDuration: 5000 });
        keySets.set(issuer, keys);
      }
      const { payload } = await jwtVerify(assertion, keys, {
        algorithms: ['RS256'], issuer, audience, requiredClaims: ['exp', 'iat', 'sub', 'email'],
      });
      if (typeof payload.email !== 'string' || payload.email.toLowerCase() !== owner.toLowerCase()) return deny();
    } catch {
      return deny();
    }
    return serveMcp(request, env, ctx);
  },
} satisfies ExportedHandler<HostedEnv>;
