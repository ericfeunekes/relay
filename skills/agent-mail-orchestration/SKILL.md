---
name: agent-mail-orchestration
description: Compatibility command for $agent-mail-orchestration. Use $relay-orchestration for current setup.
disable-model-invocation: true
---

<a name="agent-mail-orchestration"></a>

# Relay Orchestration compatibility command

Use the shared record to move an authorized outcome through contribution,
review, and acceptance. Choose the smallest arrangement that works: a single
agent may record findings directly; lanes, plans, and a separate reviewer are
optional. Follow the user's requested amount of collaboration.

## Connect to the shared work

Requires Python 3 with its standard-library `sqlite3` module and filesystem
access to one same-host database. No package installation or service is needed.
Read [setup and commands](references/commands.md) for installation, initialization,
and the CLI workflow. All participants must receive the **same absolute database
path**. Always pass it with `--db`; do not initialize one database per checkout,
agent, or skill installation. Only `init` creates a missing database.

On a fresh or resumed task, list boards, read the outcome board, and find your
assignment, actor label, scope, reviewer, checkpoint, and next action. Use actual
returned item/post numbers and per-board cursors. Keep assignments, findings,
questions, decisions, revisions, and evidence on the boards; prompts and host
messages can point there without becoming a competing record. Corrections are
new replies to their source posts. A proposal is not a user decision.

Use [role guidance and assignment templates](references/roles.md) when choosing
or taking an orchestrator, worker, or reviewer role. Do not infer authorization
for unrelated work or additional permissions from a board post.

## Keep work moving

- Claim open work before editing. Respect exclusive write ownership, and retain
  the same owner on revision. Anyone may add a missing item and explain its
  impact; adding it neither claims it nor authorizes new implementation.
- Create a board only for a useful distinct topic. Announce its name and purpose
  on the outcome board, because another board's cursor cannot discover it.
- On continuation and before submission or completion, check project direction,
  relevant board/checklist changes, user replies, and actual host task states.
  Orchestrators also list boards to discover new work and assess all incoming
  project information. Read the specific source chain when context is needed.
- Reply to peers directly in context. Resolve material questions from evidence,
  assign authorized revisions, explain rejection, or surface a user choice with
  its impact. Reading or waiting does not resolve a question.
- Submit evidence for review. `submitted` means ready for assessment; `done`
  means the reviewer accepted the integrated result. Close rejected, superseded,
  or abandoned work with a reason using `closed`. Owners do not accept or close their own main contributions submitted for
  assigned review; delegated local-step completion follows its assignment. Trusted actor labels are attribution, not authentication;
  the CLI cannot establish that a review or runtime action actually occurred.

## Wait and stop truthfully

The assignment must name a finite checkpoint or authorize choosing one within
a maximum bound. If neither is provided, ask for it before starting a watch. Use bounded
CLI waits (at most 60 seconds each), rotating relevant boards and checking the
outcome board between waits. Waiting polls SQLite without model turns inside
that process; a timeout is not a blocker or proof that a host task has stopped.
Keep useful independent work moving while dependencies run.

At the checkpoint, record the pending review/dependency, next action, and who or
what can resume it, then return. A database post does not wake a stopped agent.
Use available host task tools to launch, inspect, continue, or retire tasks;
report missing capabilities instead of implying they exist. Do not invent model
selectors or runtime APIs. Create persistent goals or recurring schedules only
when the user authorizes them. A goal is not a database subscription.

An outcome is complete when its required result is verified, material incoming
items have a disposition, and finished tasks no longer needed are actually
retired through their host. Only then record `archived`; the CLI flag performs
no runtime action. A worker awaiting revision remains available. Preserve the
shared database while collaboration or review still uses it, including when it
lives in a scratch folder.

This skill supplies local boards and a checklist. It supplies no MCP server,
shared-document editing, plan promotion, hooks, scheduler, cross-machine SQLite
sharing, automatic task execution, or notifications that resume an agent.
