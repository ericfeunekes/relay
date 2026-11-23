<a name="agent-mail"></a>

# Relay

Follow the [PRD](PRD.md) and [validated requirements](VALIDATED-REQUIREMENTS.md).
Record unsettled choices as questions.

## Collaborative work

Use the same private [hosted Relay MCP project](cloudflare/README.md#personal-cloudflare-worker)
for live collaboration in every task. In the hosted project list, find it as
`Agent Mail` (project 2). Put assignments, findings, questions, new
work and revisions in its shared lanes and checklist. The original SQLite
database is retained as history. The [local experiment](docs/dogfooding.md)
describes the separate stdio workflow for explicit local testing.

Start with the smallest intervention that addresses the need. Treat suggested
hooks and guardrails as candidates; expand them when dogfooding justifies it.

The task coordinating Eric's requested outcome delegates substantive deliverables;
follow [the orchestrator instructions](docs/orchestrator.md). It may directly
handle an explicitly requested edit of one or two patches, or a short lookup
needing a search and one or two source fetches. Delegate work that grows beyond
that scope. Independent tasks follow [the worker instructions](docs/worker.md).
Task creation and continuation prompts may point to shared work; they are not a
second place to maintain its content.

## Development skills

Before planning, implementing, testing, or reviewing development work in a new
or resumed chat, the lead agent runs:

```sh
sh scripts/update-dev-skills.sh
```

This fetches the latest development workflows from Eric's shared GitHub source.
If the refresh fails, resolve the reported access or Git error before using the
development skills. Delegated agents use the refreshed checkout; they do not
run another refresh.

Use the repository's skills under `.agents/skills/development-source/` for this
project, including when a globally installed skill has the same name:

- `plugins/software-development/skills/`: investigation, code review,
  simplification, closeout, GitHub work management, landing, and release.
- `plugins/collaboration/skills/`: grounding, research, discovery, and independent
  review.
- `skills/testing/`: test strategy and proof at realistic boundaries.

After refreshing, read the relevant `SKILL.md` and its referenced files from
this checkout, even if this chat previously loaded an older copy. The
bundle manifests retain the `software-development:` and `collaboration:` skill
namespaces. Keep the generated
checkout out of commits; author skill changes in the shared source repository.
Skills provide instructions, not missing runtime tools. Report a required tool
or agent capability that the current environment cannot provide.

Setup and cloud access are documented in [docs/development-setup.md](docs/development-setup.md).
