/** Real local runtime for tests: the Wrangler CLI serves workerd + SQLite Durable Objects over loopback HTTP. */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const root = fileURLToPath(new URL('..', import.meta.url));
const scratch = path.join(root, '..', '.scratch', 'cloudflare-tests');
const wrangler = path.join(root, 'node_modules', '.bin', 'wrangler');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer().once('error', reject).listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** Connects an MCP SDK client over Streamable HTTP with the service bearer token. */
export async function connect(url, token, actor = 'test') {
  const transport = new StreamableHTTPClientTransport(new URL('/mcp', url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: actor, version: '0.0.0' });
  await client.connect(transport);
  return client;
}

/** Calls a tool and returns its parsed JSON result; an isError result throws its message. */
export async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content.map(part => part.text ?? '').join('');
  if (result.isError) throw new Error(text);
  return JSON.parse(text);
}

/**
 * Starts `wrangler dev` on a free loopback port with disposable persisted state.
 * restart() stops the process and starts a new one on the same persisted state.
 */
export async function startRuntime({ entrypoint = 'src/index.ts', persistTo, token = randomUUID() } = {}) {
  await mkdir(scratch, { recursive: true });
  const owned = persistTo === undefined;
  const state = persistTo ?? await mkdtemp(path.join(scratch, 'run-'));
  let child, url, log = '', client;
  const clients = new Set();

  async function launch() {
    const port = await freePort(), inspector = await freePort();
    log = '';
    child = spawn(wrangler, ['dev', entrypoint, '--ip', '127.0.0.1', '--port', String(port),
      '--inspector-port', String(inspector), '--persist-to', state, '--var', `MCP_TOKEN:${token}`,
      '--show-interactive-dev-session=false'], {
      cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1', WRANGLER_LOG_PATH: path.join(state, 'logs') },
    });
    child.stdout.on('data', chunk => { log += chunk; });
    child.stderr.on('data', chunk => { log += chunk; });
    // An unlaunchable executable reports through 'error' rather than 'exit'.
    const ended = new Promise(resolve => {
      child.once('exit', code => resolve(`exited (${code})`));
      child.once('error', error => resolve(`failed to start (${error.message})`));
    });
    url = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 90_000;
    while (true) {
      const ending = await Promise.race([ended, new Promise(resolve => setTimeout(() => resolve(undefined), 250))]);
      if (ending !== undefined) throw new Error(`wrangler ${ending} before serving:\n${log}`);
      // Unauthenticated probe: the real worker answers 401 once it is serving.
      // An unconfigured service answers 503 instead.
      const status = await fetch(`${url}/mcp`, { method: 'POST' }).then(response => response.status, () => 0);
      if (status === (token ? 401 : 503)) return;
      if (Date.now() > deadline) throw new Error(`wrangler did not serve within 90s:\n${log}`);
    }
  }

  async function launchOrClean() {
    try { await launch(); } catch (error) {
      await halt();
      if (owned) await rm(state, { recursive: true, force: true });
      throw error;
    }
  }

  async function halt() {
    for (const each of clients) await each.close().catch(() => {});
    clients.clear();
    client = undefined;
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise(resolve => child.once('exit', resolve));
    process.kill(-child.pid, 'SIGTERM');
    const timer = setTimeout(() => process.kill(-child.pid, 'SIGKILL'), 10_000);
    await exited;
    clearTimeout(timer);
  }

  await launchOrClean();
  const runtime = {
    get url() { return url; },
    token,
    persistTo: state,
    get log() { return log; },
    async connect(actor) {
      const each = await connect(url, token, actor);
      clients.add(each);
      return each;
    },
    async call(name, args = {}) {
      client ??= await runtime.connect('test');
      return call(client, name, args);
    },
    /** Closes every connected client; reconnect participants afterwards. */
    async restart() { await halt(); await launchOrClean(); },
    async stop() {
      await halt();
      if (owned) await rm(state, { recursive: true, force: true });
    },
  };
  return runtime;
}
