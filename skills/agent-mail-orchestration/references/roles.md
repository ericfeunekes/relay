# Roles and templates

## Orchestrator

Own the requested outcome through assessment, acceptance, verification, and
cleanup. Delegate substantive deliverables and integration edits to independent
host tasks with explicit write ownership. Directly handle a requested small edit
of one or two patches, or a short lookup requiring a search and one or two
source fetches; delegate if it grows beyond that. Subagents can support small
bounded work. One agent handling a bounded direct task needs no orchestrator.

Record assignments on a board/checklist, then send host tasks pointers to that
record. Establish that the required task tools are available; a CLI post does
not launch them. Keep checking actual task handles through finite waits, and
continue the same task for a requested revision when it lacks an active watch.
Do not restart a confirmed running task merely because a board wait timed out.

Inspect submitted artifacts and evidence; assign any required changes to their
write owner. Accept only integrated, verified results. When independent coverage
review is useful or requested, give a fresh reviewer the whole checklist and
actual outcomes, not just a proposed plan. Disposition its findings in context.
Do not declare success merely because each task returned.

Assignment template (a board post linked to a checklist item):

```text
Outcome and source direction:
Owner actor and assigned reviewer:
Relevant boards and shared database/script absolute paths:
Exclusive write scope and do-not-touch material:
Done condition and evidence required:
Delegated peer-step authority, if any:
Finite review checkpoint, or maximum bound within which owner may choose:
Runtime task handle after launch:
```

Only add a separate lane board when it helps collaborators manage distinct work.
Its participants may add, claim, complete, and review delegated peer steps when
the lane assignment authorizes that. Step completion does not accept the overall
lane contribution or retire another task; lane acceptance remains with its
assigned reviewer.

## Worker

Claim the assigned open item, read its source discussion and current direction,
and work within scope. Retain the claim on revision. Post findings, questions,
and evidence where peers can respond. Identify gaps or incompatible assumptions
that affect the requested outcome, including defects in your own assignment.

Submit the result post against the main assigned item, then watch relevant
boards through its finite checkpoint. Do not accept or close your own main contribution.
At the checkpoint, leave pending review and resumption needs visible. Without
an active watch or host continuation mechanism, a future database post alone
will not start another turn.

Result template:

```text
Result/artifact and installation or use steps:
Evidence at the boundary claimed:
Remaining limitations or user choices:
Relevant board cursors:
Pending review and checkpoint/resumption condition:
```

## Reviewer

Use the artifact, source contract, and actual evidence. For independent challenge,
start without the author's conversation unless transcript or intent evidence is
the review's subject. Review the whole outcome when assigned coverage review;
otherwise stay within the named contribution. State specific defects with their
consequence and the evidence needed to resolve them. Do not rewrite the owner's
files without assigned write authority or accept another contribution unless
assigned that responsibility.

Review template:

```text
Artifact and scope inspected:
Defect, consequence, and supporting source/evidence (or no actionable findings):
Needed revision or acceptance recommendation:
Unresolved uncertainty:
```

A review recommendation does not itself change the item state. The assigned
reviewer records `accept`, `revise`, or `close` using a contextual review post.
