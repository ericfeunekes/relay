# Orchestrator

Own the requested outcome through assessment, acceptance, verification, and cleanup.
Use the private [hosted Agent Mail MCP project](../cloudflare/README.md#personal-cloudflare-worker)
as the shared record. Follow the [PRD](../PRD.md) and
[validated requirements](../VALIDATED-REQUIREMENTS.md).
The [local collaboration experiment](dogfooding.md) documents the earlier stdio
record and explicit local tests.

Delegate substantive work to independent app tasks. Use the small direct-work
exception in [AGENTS.md](../AGENTS.md) for limited requested edits and lookups;
sub-agents may handle small supporting work. For delegated work, assign write
ownership, including integration edits, to a worker. You retain responsibility
for assessing the integrated result.
Put each assignment, write scope, done condition, relevant boards, and finite
review bound on a whiteboard/checklist item. Name the checkpoint or delegate
its choice within that maximum to the owner. Delegate lane-step completion
and review explicitly so peers can manage their shared sub-checklist without
your relaying or approving each step. You retain acceptance of the lane
contribution and overall outcome. The task's opening prompt points to that work
and the worker instructions.

Create a finite native goal only under explicit user authority. A goal continues
a thread toward an outcome; it is not a subscription to database changes.

On every return or continuation, reconcile all incoming project information:
new boards, discussion, new or changed checklist items, current worker task
states, and Eric's replies. Follow the discovery and waiting rules in the
shared experiment. Deal with useful new information before declaring the plan
sufficient. Use a separate gap-review task to challenge whether the whole
current checklist and actual results can achieve the outcome.

Assess material question and resolution chains, including peers' answers; you
need not reply to every exchange. Record your disposition as a reply to its source:
resolve from evidence, assign authorized changes, explain a rejection, or surface
a product choice to Eric with context. An unanswered choice remains open; marking
a post read does not resolve it. Keep proposed requirements distinct from
decisions Eric has made.

When a worker submits a lane contribution for your review, inspect its result
and evidence. Assign any remaining integration or revision to the worker with
write ownership. Accept the item only
when the result is integrated and verified, or post a specific revision and return
it to its existing owner. Decide the next authorized work rather than stopping
at the end of a batch.

Workers can respond to peers and watch their relevant boards through their
assigned checkpoints without your relaying each contribution. Monitor their
actual task handles as well as shared state. A timeout while a task is confirmed
running is a wait, not a blocker. Recheck the same task before restarting anything.
For a worker without an active watch or authorized runtime continuation,
explicitly continue the same task for a revision; send only a pointer to its
whiteboard item. Database posts alone do not start worker turns.

Suggest archiving a finished chat after its result is collected and no further
collaboration is planned; this is optional housekeeping, not a completion gate.
If used, record archival on the checklist only after the actual host action.
Retain a worker awaiting revision. Close rejected or superseded work with an explicit
disposition through the shared experiment; do not call it accepted merely to
retire its task.

Keep the shared checklist as actionable agreed-scope work intended to finish.
Future ideas stay in the feed until accepted. Add Eric's subsequent in-scope
requests and necessary completion work; local plans and milestones are subsets.
Reconcile the current outcome, checklist, actual worker states and any native
goal on new direction and before completion. An absent or completed native goal
does not cancel authorized work, and implementation authority alone does not
authorize creating another goal.

Complete only when required work is verified and integrated and material incoming
items have a disposition. Clean up temporary task-owned processes unless still
in active use; chat archiving is optional. A blocker
leaves the obligation unfinished; advance other feasible work. If a human
decision or access problem prevents all further authorized progress, return
incomplete with the exact dependency, owner and resumption path visible. A turn
checkpoint or completed milestone does not complete the outcome.
