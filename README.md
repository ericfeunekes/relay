<a name="agent-mail"></a>

# Relay

Relay, formerly Agent Mail, uses a private hosted MCP service for collaboration
through a shared feed and checklist. The stdio MCP server and SQLite CLI
support local testing.
See [hosted client setup](cloudflare/README.md#personal-cloudflare-worker) and
the [PRD](PRD.md).

## Connect through local MCP

Install the locked server dependencies from this checkout:

```sh
uv sync --locked
```

Configure an MCP client to launch this checkout's `.venv/bin/python` with these
arguments, replacing both placeholders with absolute paths:

```sh
.venv/bin/python -m agent_mail.server --db /absolute/shared/collaboration.sqlite3 --project-root /absolute/project
```

Set the launch working directory to this checkout, or use an installed package.
The database, its default `project` stream and project directory must already
exist. Initialize a new run with the CLI below; join existing work with its
assigned database. Every client participating in that work must point to the
same SQLite file on that host. The
server uses stdin/stdout for MCP messages and does not open an interactive
console or configure a host connection.

Install the complete [Relay skill](skills/relay/SKILL.md) folder through the
host's supported skill installation mechanism and connect the MCP server
separately. Invoke it with `$relay` to discover guidance and current operations.
The [Relay Orchestration skill](skills/relay-orchestration/SKILL.md) uses the
stdlib SQLite CLI and is invoked with `$relay-orchestration`. The original
`$agent-mail` and `$agent-mail-orchestration` commands and folders are available
for existing installs and links. Invoke the repository skills explicitly.
The Marketplace Keep context skill is available for automatic selection.

The Python stdio server exposes streams, contextual feed posts, checklist changes,
incremental reads and bounded waits. It does not implement plan editing,
comments on plans, plan promotion or persistent orchestrator claims from the PRD.
Actor labels are trusted attribution. Shared-state updates and retirement
records do not control host tasks; the service supplies no scheduler, automatic
wake-up or hosted transport. Connecting through an SDK client does not prove
native Codex or Claude host installation.

## Personal Codex dogfooding

Use your existing hosted Relay MCP connection to find the shared project
listed as `Agent Mail` (project 2) and read your assigned lane. If your client
needs a connection, follow the [hosted Relay client setup](cloudflare/README.md#personal-cloudflare-worker).

The original stdio record is retained at the main checkout's
`.scratch/collaboration.sqlite3` symlink, which points to the physical database
in the original worktree. Preserve the physical database and its containing
directory until the history is deliberately relocated. Use the local MCP and
SQLite commands in this README for explicit local experiments.

## Run the experiment

To join an existing run, use its assigned checkout and read
[the shared workflow](docs/dogfooding.md). The commands below initialize a run.

Python 3 and its standard-library SQLite support are sufficient.

```sh
python3 scripts/whiteboard.py init
python3 scripts/whiteboard.py board project
python3 scripts/whiteboard.py boards
python3 scripts/whiteboard.py show project
```

The initialized database is `.scratch/collaboration.sqlite3`. To initialize a
different shared path, pass `--db /absolute/shared/collaboration.sqlite3` to each
CLI command. The database contains the
working discussions and checklist and is ignored by Git. Preserve it while the
experiment or its review remains in use. The same script can be called by its
absolute path from independent tasks; its default database stays in this checkout.

Read [the shared workflow](docs/dogfooding.md) before participating. The task
coordinating the outcome uses [the orchestrator instructions](docs/orchestrator.md);
other tasks use [the worker instructions](docs/worker.md).

## Check the tool

```sh
.venv/bin/python -m unittest discover -s tests -v
```

The full suite uses the server environment above. The whiteboard checks run
separate CLI processes against actual SQLite files,
including competing claims, committed-update waiting, review/revision transitions,
and invalid cross-board references. They do not prove automatic agent wake-ups,
app-task archival, or cross-machine access. Those claims need their own boundary
observations.

For the required shared development workflows and cloud setup, see
[development setup](docs/development-setup.md). Earlier client and orchestration
research is in [collaboration direction](docs/collaboration-direction.md); its
subscriber-wake experiments are research context, not this experiment's scope.
