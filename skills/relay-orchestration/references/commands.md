# Setup and commands

## Install and choose storage

Extract the archive's `relay-orchestration/` directory into the host's
supported skill directory (for Codex, `~/.codex/skills/`), or the corresponding project skill directory. Retain the
whole folder. Load the skill using the host's normal skill discovery or explicit
invocation. No changes to global agent or model configuration are required.

Resolve `scripts/whiteboard.py` relative to this installed skill, not the caller's
working directory. Choose an absolute database path in a project folder that all
participants can access on the same host. Set these shell variables to the actual
paths; the placeholders below must be replaced:

```sh
BOARD_SCRIPT="/absolute/installed/relay-orchestration/scripts/whiteboard.py"
BOARD_DB="/absolute/shared/project/.scratch/collaboration.sqlite3"
python3 "$BOARD_SCRIPT" --db "$BOARD_DB" init
python3 "$BOARD_SCRIPT" --db "$BOARD_DB" board project
```

Initialize once for a new project. `init` can be repeated without clearing
existing history; `board` rejects duplicate names. Existing work needs only the
shared paths, not another initialization. All commands emit JSON on success;
invalid transitions, missing databases, and other errors exit nonzero. Do not
substitute a private database after an access error. Correct the access/path
problem or report it. Do not edit database tables directly to bypass a guard.

## Read, discuss, and assign

```sh
python3 "$BOARD_SCRIPT" --db "$BOARD_DB" boards
python3 "$BOARD_SCRIPT" --db "$BOARD_DB" show project
python3 "$BOARD_SCRIPT" --db "$BOARD_DB" post project --actor coordinator --body-file assignment.md
python3 "$BOARD_SCRIPT" --db "$BOARD_DB" add project 'Prepare the requested result' --actor coordinator
```

Use a body file for substantial text. It is read from the command's working
directory; use an absolute path if another cwd would be ambiguous. `--body` is
also available for short text. For contextual replies, add `--reply-to` followed
by the actual returned post number from the same board.

`show` returns the full current checklist plus later posts and events, ending at
its committed `cursor`. Save one cursor per board and use `show BOARD --after
CURSOR` on return. Reads do not consume another reader's state. A cursor is an
event position, not a post number. Board discovery requires `boards` separately.

## Claim, submit, and review

The capitalized shell variables below represent numbers actually returned by
`add` and `post`, not literal identifiers to invent. Supply the relevant values
before running the commands.

```sh
python3 "$BOARD_SCRIPT" --db "$BOARD_DB" claim "$ITEM" --actor author
python3 "$BOARD_SCRIPT" --db "$BOARD_DB" post project --actor author --body-file result.md
python3 "$BOARD_SCRIPT" --db "$BOARD_DB" submit "$ITEM" --actor author --post "$RESULT_POST"
python3 "$BOARD_SCRIPT" --db "$BOARD_DB" post project --actor coordinator --reply-to "$RESULT_POST" --body-file review.md
python3 "$BOARD_SCRIPT" --db "$BOARD_DB" accept "$ITEM" --actor coordinator --post "$REVIEW_POST"
```

`claim` atomically assigns an open item; a concurrent claimant loses without
changing its owner. Only the working owner can submit. Review requires a
submitted item. The assigned reviewer uses
`revise` instead of `accept` with a review post to return work to the same owner.
The owner then edits and submits again. `close ITEM --actor ACTOR --post POST`
closes an unfinished item without claiming integration. Result/review posts must
be on the item's board. Actor labels and assigned-reviewer discipline rely on
trusted participants; they are not access controls.

## Track host tasks and waiting

After actually creating a host task, record its returned handle:

```sh
python3 "$BOARD_SCRIPT" --db "$BOARD_DB" link "$ITEM" --actor coordinator --runtime codex --thread "$TASK_HANDLE" --host local
python3 "$BOARD_SCRIPT" --db "$BOARD_DB" wait project --after "$CURSOR" --timeout 30
```

The supported runtime labels are `codex` and `claude`. `link` records metadata;
it does not create a task. `wait` returns on a committed board event or timeout,
with the current checklist, cursor, and `timed_out`. The CLI does not detect host
task completion. At an assigned checkpoint, post any pending dependency and
return; continuing later needs an available host mechanism or explicit follow-up.

After the linked task is actually retired and its item is `done` or `closed`:

```sh
python3 "$BOARD_SCRIPT" --db "$BOARD_DB" archived "$ITEM" --actor coordinator
```

This records retirement only. Preserve the database as shared project evidence;
stop only temporary processes owned by this work, not unrelated automation.
Use `python3 "$BOARD_SCRIPT" --help` or a command's `--help` for exact arguments.
