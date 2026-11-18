# Local collaboration experiment

The shared whiteboards and checklist live in `.scratch/collaboration.sqlite3`.
Use the connected local stdio MCP tools or `python3 scripts/whiteboard.py`
from this checkout, or its absolute path from another task. The CLI's default
database is anchored to the script's checkout, not the caller's current
directory. All participants must use this same shared database; do not
initialize a private copy in another checkout. See [README.md](../README.md)
for the MCP connection.

The database is the collaboration record. Keep assignments, questions,
findings, proposed requirements, decisions, and requests for revision on its
whiteboards. Anyone may create a whiteboard, post or reply, clarify work, and
add a checklist item. A post is not automatically an accepted product decision.
Eric decides product choices; assigned workers write deliverables and integrate
authorized changes; the orchestrator assesses and accepts their results.
Change the database only through `whiteboard.py` or the connected MCP tools.
Record corrections as posts, including the old and corrected information and
the reason; do not bypass a command's guard with a direct database edit.

Run `python3 scripts/whiteboard.py --help` for the commands. The common path is:

```sh
python3 scripts/whiteboard.py boards
python3 scripts/whiteboard.py show prd
python3 scripts/whiteboard.py post prd --actor worker-name --body-file .scratch/findings.md
python3 scripts/whiteboard.py add prd 'Clarify a missing outcome' --actor worker-name
python3 scripts/whiteboard.py claim 1 --actor worker-name
python3 scripts/whiteboard.py submit 1 --actor worker-name --post 3
```

Use your assigned actor label. It is attribution within this trusted local
experiment, not authentication. Checklist and post numbers above are examples;
use the numbers actually returned by the tool. Replies and result/review links
must stay on the checklist item's whiteboard. Link a response or disposition
to its source post with `post --reply-to` so the discussion retains its context.

## Discovering and watching work

When creating a board, announce its name and purpose on the existing board for
the shared outcome. Board creation is not covered by another board's cursor.
On each orchestrator return, run `boards`, compare the list with previously known
boards, and read new boards as well as updates on existing ones. Participants
check all boards when reassessing coverage.

`show BOARD` returns the checklist and discussion. Its `cursor` is a committed
event position for that board. `show BOARD --after POSITION` returns later posts
and events plus the current checklist. Keep a separate cursor for each board;
reads do not consume anyone else's state.

`wait BOARD --after POSITION --timeout 45` waits for a post or checklist change,
or returns `timed_out: true`. Watch the global `project` board plus relevant lane
boards and their checklists. Use actual bounded wait calls while working or
awaiting review, then read and respond to relevant updates. When following more
than one board, check updates on each relevant board between waits and rotate
the board being waited on. A timeout on one board says nothing about the others
or whether a native task is running. Worker watches end at acceptance,
closure/retirement, or the checkpoint recorded within the assignment's finite
review bound. SQLite waits observe commits while their
process runs; delivering the result as a new model turn requires a separately
supported host mechanism. A database post alone does not wake a stopped agent.
A worker without an active watch or authorized runtime continuation needs an
explicit continuation. A native goal continues a thread and is not a database
subscription.

## Review and retirement

A lane board may use its checklist as the project's shared sub-checklist.
Participants can add, clarify, claim, and complete delegated peer steps directly;
the lane assignment identifies that authority. The orchestrator accepts each
lane's submitted contribution and the overall outcome, rather than every peer
step. These use the existing boards and checklist, not a separate nested schema.

Checklist states distinguish a contribution from integration:

- `open`: available work.
- `working`: claimed by one owner.
- `submitted`: owner has linked a result post for review.
- `done`: the assigned reviewer has linked acceptance of the integrated result.
- `closed`: unfinished work has a linked disposition without claiming integration.

The assigned reviewer uses `revise` with a review post to return submitted work
to its existing owner. `link` records the actual worker task address. After
archiving that task through its runtime, `archived` records the disposition;
it does not archive the runtime task itself. For rejected, superseded, or
abandoned work, post the reason on its board and use
`close ITEM --actor ACTOR --post POST` to link that disposition. This closes an
`open`, `working`, or `submitted` item without calling it integrated. Record
`archived` only for a linked `done` or `closed` item after actual runtime
retirement; lane steps without their own runtime task need no archival record.

The database retains discussion and completed work as evidence. It is ignored
by Git and must not be removed as disposable scratch while this experiment or
its review remains in use. Retiring a runtime task does not dispose of this
shared record.

This is a same-host SQLite experiment with a standard-library CLI and a local
stdio MCP interface over the same store. It is not a cross-machine database or
an automatic wake dispatcher.
