<a name="agent-mail-on-the-local-workers-runtime"></a>

# Relay on the local Workers runtime

The [PRD](../PRD.md) and [validated requirements](../VALIDATED-REQUIREMENTS.md)
define the service. The implementation uses one SQLite-backed Durable Object
for all projects, so plan acceptance and cross-lane
task creation share a transaction. Each project groups lanes with append-only
feeds, retained tasks, plan revisions/comments/acceptance links and explicit
orchestration ownership.

Run from this directory:

```sh
npm ci
printf 'MCP_TOKEN="your-local-development-token"\n' > .dev.vars
npm run dev
```

The endpoint is `http://127.0.0.1:8787/mcp` unless Wrangler chooses another port.
Use Streamable HTTP with `Authorization: Bearer <MCP_TOKEN>`. A missing service
credential fails closed. `.dev.vars`, dependencies and local runtime state are
ignored by Git. Development state persists in `../.scratch/cloudflare-runtime`;
it is disposable and separate from the existing Python collaboration database.
Stop the server before resetting disposable state after a development schema change.
Stop the foreground server with Ctrl-C.

`npm run typecheck` checks the TypeScript boundary contracts. `npm test` starts
and stops real local Workers runtimes and exercises MCP through loopback HTTP
and real SQLite-backed Durable Objects, using disposable data. The test helper
owns its runtime and persistence directories. The local Streamable HTTP
connection was also exercised in Codex CLI
and Claude Code. If unattended `codex exec` reports that an MCP tool requires
approval while the approval policy is `never`, set
`mcp_servers.<server>.default_tools_approval_mode="approve"` for the trusted
loopback test server in that invocation.

Discover `relay://guidance/start` through the connected client or call
`relay_get_guidance` with topic `start`. Relay tools use the `relay_` prefix.
Post links use `relay://posts/{id}`. Existing calls with unprefixed operation
names and links starting with `agent-mail://` still work. `relay_wait_changes`
polls durable state during a finite request. Its
local proof does not establish hosted polling cost or client timeout compatibility.

## Personal Cloudflare Worker

The hosted entry uses a separate SQLite Durable Object in the `agent-mail-personal`
Worker. Its MCP URL is `https://agent-mail-personal.travel-event-monitor.workers.dev/mcp`.
If you already connect through this URL, keep your saved MCP server key.
The existing Marketplace connection uses `agent_mail_personal`.

The dedicated Worker Access application uses the owner-only policy, Google sign-in,
and Managed OAuth with 15-minute access tokens. The application covers the Worker
and its exact `workers.dev` hostname. Access supplies a
signed assertion that the Worker validates against its own application audience
and the owner email. The local development token is scoped to the loopback entry.

Connect a personal CLI client using Streamable HTTP:

```sh
RELAY_MCP_URL=https://agent-mail-personal.travel-event-monitor.workers.dev/mcp

# Codex CLI
codex mcp add relay --url "$RELAY_MCP_URL"
codex mcp login --oauth-client-registration dcr relay

# Claude Code, from the directory where you want to use the server
claude mcp add --transport http relay "$RELAY_MCP_URL"
claude mcp login relay
```

Complete Cloudflare sign-in and consent in the browser. If Claude Code does not
open a tab, open the authorization URL it prints while the login command is
still running. Open a fresh client session after setup and ask it to use
`relay_list_projects`.

For full 60-second waits in Claude Code, set `"timeout": 90000` (milliseconds)
in the Relay HTTP server entry of the MCP configuration used for the session.
Start a fresh session to load the setting. With Claude Code's default HTTP
deadline, use the ordinary 30-second wait.
[Claude Code MCP time limits](https://code.claude.com/docs/en/mcp#time-limits-on-mcp-tool-calls)

In personal ChatGPT on the web, open Plugins → Add custom MCP server and enter
the hosted MCP URL with OAuth. In Advanced OAuth settings, select User-Defined
OAuth Client to reveal the callback. Add that exact URI to Managed OAuth on the
dedicated Worker Access app, then switch the same form back to Dynamic
Client Registration, create the plugin and complete Cloudflare owner consent.
Use Try in chat to read hosted work or post a contextual reply. The tested
personal connection supports both actions. After adding a server tool, refresh
the plugin's discovered tools before starting a fresh chat.
The detailed local collaboration history lives in the separate stdio database.

To update the hosted Worker, first verify `wrangler whoami` shows the configured
personal account. From this directory, set `AGENT_MAIL_ACCESS_OWNER_EMAIL` to the
email admitted by the Worker’s Access policy and run:

```sh
./node_modules/.bin/wrangler deploy --config wrangler.hosted.jsonc --strict \
  --var "CF_ACCESS_OWNER_EMAIL:${AGENT_MAIL_ACCESS_OWNER_EMAIL:?Set the Access owner email}"
```

Keep the Worker name and SQLite binding to retain hosted state through updates.
After deploying, verify that an anonymous MCP request receives a `401` Bearer
challenge and that its advertised `resource_metadata` URL returns the configured
team issuer. Reconnect an owner-authenticated MCP client and read
the same project to check that data survived the update. The hosted Worker has
no background process to restart on this Mac.

Cloudflare can defer code updates for an active Durable Object for up to five
minutes. If the Worker lists a new store operation during that window but the
store rejects it as unknown, verify it again after the window.
[Durable Object code updates](https://developers.cloudflare.com/durable-objects/deployments/durable-objects-code-updates/)

Record the current Worker version before updating. Wrangler can roll Worker code
back to a prior compatible version. That does not roll back the Access application
or SQLite data. Changes to existing tables need an explicit migration before
deployment. Hosted backup and restore have yet to be proved. Use short bounded
waits for hosted checks because each wait polls the Durable Object.
