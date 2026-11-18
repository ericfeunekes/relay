# Validated requirements

## Finding and sharing work

Participants need a shared context they can discover and use across sessions.

- **R1.1** Participants can find projects and their lanes and contribute to the
  same shared work without requiring a local folder.
  - A connected Codex task posts a finding through MCP. A separately connected
    ChatGPT participant without filesystem access finds the project and lane,
    reads the finding, and replies in context; both see the same checklist owner
    and result. A connected Claude task can join that work.
  - A worker creates a lane for a distinct question, identifies the
    outcome it belongs to, and another participant can find it from the project.

- **R1.2** Participants can understand the source and context of a contribution.
  - A feed post identifies its author and the discussion it addresses. Corrections
    appear as new contextual posts; the original posts remain unchanged.
  - A finding links to its evidence or artifact, and a proposal remains distinct
    from an accepted decision.
  - Two workers post different answers to the same question concurrently; both
    remain available with their authors and context, and the orchestrator records
    the resolution or outstanding decision.

- **R1.3** A fresh or resumed agent can find the guidance and current context needed
  to use Agent Mail appropriately without Eric re-explaining the process.
  - With installed product guidance alone, a fresh ChatGPT, Codex or Claude agent can
    recognize when shared collaboration helps, discover the available operations,
    find the relevant outcome, and contribute a question or finding.
  - Given only the installed guidance, an agent handles a bounded research
    question directly in an existing lane without adding another lane,
    orchestrator or separate review.
    For a recurring check, it records the result while retaining the standing
    responsibility rather than declaring that responsibility complete.
  - A replacement session can find its role, owned work, scope, current direction,
    pending review, checkpoint and next authorized action. A resumed orchestrator
    finds a requested substantive edit and delegates it to an independent worker.
    Its role guidance permits planning and discussion while directing substantive
    deliverables to independent workers.

- **R1.4** Eric and agents can choose and change the amount of collaboration without
  losing prior work or requiring every workflow step.
  - Eric asks one researcher for an answer. Its findings, sources and Eric's
    acceptance or follow-up remain findable in an existing lane without an
    additional lane, plan, orchestrator or separate reviewer. Adding a second
    worker preserves that context.
  - A team uses delegated lane steps where useful. Eric can say "two workers,
    no separate reviewer" or change the arrangement while work continues;
    existing ownership and review history retain their meaning.

- **R1.5** Participants can create and edit shared plans and discuss the whole
  plan or any span without losing contributions or their context.
  - Eric leaves a whole-plan comment on a plan and a comment on one phrase;
    another agent can find both and respond in context.
  - An author changes or deletes the commented passage. The comment remains
    available with its original context and the change or removal apparent,
    rather than silently attaching to unrelated text.
  - Claude and Codex edit the same plan from an earlier revision. A saved
    change is not silently overwritten; a conflicting writer can see the other
    change and what remains to resolve.

## Shared checklist

Coordinated work needs visible ownership and a trustworthy distinction between
contributing a result and accepting it.

- **R2.1** Anyone can clarify the work or add a missing item where the team can see it.
  - A worker finds missing acceptance evidence and adds an unclaimed item explaining
    its effect on the outcome. The orchestrator includes it in the plan or explains
    why it is unnecessary.
  - The orchestrator sees and assesses new work before declaring the outcome complete;
    adding an item does not silently claim it or authorize unrelated work.
  - An optional improvement or future idea remains in the feed until accepted as
    actionable work; it does not become an unfinished checklist obligation merely
    because someone proposes it.

- **R2.2** The shared record distinguishes ownership, submitted work, integrated results,
  and work closed without integration.
  - Two MCP-connected workers try to claim the same available item. One succeeds;
    the other can tell its claim failed, find the current owner, and choose an
    appropriate next action without changing that ownership.
  - A worker submits a lane result linked to evidence or an artifact. It remains
    awaiting overall review until the orchestrator accepts the integrated result,
    requests a revision, or closes the contribution with a reason.
  - On a revision, the original owner can see what must change and submit an updated
    result. The earlier contribution and review remain available.
  - A rejected or superseded contribution is closed with its reason visible,
    without being represented as integrated.

- **R2.3** Workers can manage delegated lane steps together without routing each step
  through the orchestrator.
  - Independent Claude and Codex tasks share a lane and checklist. Either can
    add or clarify a missing step and claim authorized work without claiming it for
    the other worker.
  - A worker completes a delegated step and records its evidence. Its peer observes
    that completion and advances the dependent work without an orchestrator relay.
  - Workers can check off delegated lane steps; the completed steps remain distinct
    from the orchestrator's acceptance of the whole lane contribution.

- **R2.4** Participants can review and accept a particular plan revision into linked
  actionable work while keeping proposals distinct from accepted work.
  - Proposed steps cannot be claimed as checklist work. An authorized AI reviewer
    accepts a plan revision without a human approval step; human or mixed review
    can be chosen for other work. Its steps become ordinary
    checklist items in the selected existing lane, which may be another lane,
    defaulting to the plan's lane. The accepted source steps and resulting items
    are findable from each other. Directly adding authorized checklist work still needs no plan.
  - Eric reviews a water-reserve plan while its author revises it. Acceptance
    identifies the revision being accepted and exposes a change since review
    before promoting different steps. Repeating or retrying acceptance creates
    no duplicate items. If interrupted, what became actionable and what remains
    unaccepted is visible; incomplete promotion is not shown as complete.
  - Later plan edits retain the accepted revision and its links. Changes needing
    reconciliation with active items are visible; editing or removing a source
    step does not silently rewrite or delete its linked work, or authorize new
    steps. The checklist remains the record of actionable work and its state;
    revised proposals need explicit acceptance and reconciliation.

- **R2.5** Each lane retains its tasks and plans and has at most one current
  plan, which can close only after every lane task is resolved.
  - Participants revise the current plan and add tasks while it is active.
    Another plan cannot become current or replace it until it closes; the closed
    plan, revisions, comments and task links remain available afterward.
  - A lane contains completed work and one blocked, open, working or submitted
    task. Its plan cannot close until every task is completed or explicitly
    closed with a reason, including tasks added independently of that plan.
    New tasks created in another selected lane remain linked to the source plan
    but follow that lane's closeout; they do not extend this gate to other lanes.
  - A participant sets aside a task or plan. It remains visible with its explicit
    closure reason rather than being deleted or removed. Moving or relabeling
    work, or replacing the plan, cannot bypass unresolved lane tasks.

## Orchestration and review

Responsibility and current direction must remain clear when work changes,
waits, or continues in another session.

- **R3.1** The orchestrator retains responsibility across worker returns and waits.
  - When one of several workers finishes, the orchestrator reviews that contribution
    and assigns any necessary integration edits while the others continue. A quiet
    bounded wait while another worker is running does not mark the work blocked
    or complete.
  - An idle worker has a requested revision. The orchestrator continues that worker
    and reviews the updated submission; recording a post alone is not treated as
    starting the worker.
  - Work needs Eric's answer overnight. The question, affected work, resumption
    condition and responsible person or runtime remain visible while other
    authorized work continues. Eric answers once in context; he can tell whether
    that answer will be picked up or what he must continue. Resumed work uses his
    answer, without model turns spent merely polling overnight.

- **R3.2** Relevant shared information receives a disposition against the overall outcome.
  - On continuation and before completion, the orchestrator considers new discussion
    across the lanes involved, plan revisions and comments, changed checklist
    items, worker results and states, and Eric's replies. Material questions and
    proposals receive a disposition.
  - A worker asks a clarification and returns. The orchestrator answers from evidence,
    requests a revision, or leaves the required decision and its effect visible.
    Reading the question does not resolve it or justify accepting the result.

- **R3.3** Independent challenge can change the plan or the acceptance of a result.
  - A reviewer can identify that the current set of tasks will not achieve the outcome.
  - The orchestrator records how the gap was addressed or why it was set aside.

- **R3.4** Workers can respond to relevant shared work without an orchestrator relay.
  - During active work, a worker reads updates from relevant project lanes and their
    discussion, answers a peer's clarification or challenge in the shared feed,
    and updates its assigned contribution where warranted.
  - After submitting, a worker watches relevant discussion through an agreed review
    checkpoint. It can respond to requested changes within its scope; at the
    checkpoint, any pending review or need for explicit continuation remains visible.

- **R3.5** Affected work follows Eric's current direction, and interruptions preserve
  enough context to continue or close it truthfully.
  - Eric says "PRD only, no README edits" while an author is working. On receiving
    the correction at its next coordination boundary, the author stops further
    README edits and reports any already made. The current direction and affected
    assignments are clear; unaffected work continues.
  - Eric pauses an outcome. Participants observing the pause start no new work;
    running workers can be stopped through their host, with partial work retained
    rather than shown as done. On resume, a fresh session can continue from the
    record without Eric restating the outcome and decisions.

- **R3.6** Recurring work retains useful continuity between finite checks without
  requiring workers to remain active between them.
  - A school-admin check records a form needing Eric and its due date. The next
    authorized check finds the prior recorded open and handled items, assesses
    new information, and records its own result, including no change. A form
    recorded as handled is not raised again as needing Eric.
  - The standing responsibility and next expected action are visible, including
    who or what will run an arranged check and whether continuation is available.
    Eric can end the standing work; further checks cease and history remains.
    Finishing one check does not falsely complete the standing responsibility.

- **R3.7** In coordinated lane work, participants can identify one current
  orchestrator for that lane and deliberately change that ownership.
  - A Codex session explicitly claims lane orchestration through MCP. An
    independently connected Claude session sees the owning runtime and session;
    a conflicting claimant learns who owns it without displacing them. Another
    lane can have its own orchestrator without a project-wide claim.
  - Ownership persists when the owning session resumes and changes through release
    or deliberate handoff. A successor can find the responsibility and pending
    work. A forked worker does not inherit the claim from copied context.
  - When the owning session has ended or cannot resume, Eric or a participant
    authorized by the chosen workflow can deliberately reassign orchestration to
    another session. The record retains the previous owner and the change, and the new owner can find pending work.

## Visibility and cleanup

Eric and agents need an understandable current picture without repeatedly
reading settled history, and a completion claim they can trust.

- **R4.1** Eric can inspect the shared checklist and see the current state of the work.
  - With one item working and another submitted, he can distinguish the active owner
    from the contribution awaiting review and inspect its result.
  - After integration, he can find the result and acceptance even after its worker
    task has been archived.
  - When a choice needs him, he can find the question, why it matters, and the decision
    needed; unrelated authorized work can continue.

- **R4.2** Completed contributions and their dispositions remain available;
  chat archiving is optional housekeeping and does not gate outcome completion.
  - An integrated research contribution and its acceptance remain findable whether
    its chat is left unarchived or archived. An archival record, when used,
    reflects an actual host action rather than performing or proving that action.
  - A worker awaiting a revision remains available for that follow-up, with any
    need for explicit continuation visible.
  - A bounded outcome is reported complete only after required work is verified
    and contributions are accepted or explicitly closed with reasons. Leaving
    finished chats unarchived does not prevent completion. Any continuing
    standing responsibility is shown separately.

- **R4.3** Eric and agents can catch up on changes to work they follow without
  rereading unchanged history, while retaining access to its context.
  - Eric returns the next morning and sees what needs him and what it blocks,
    results accepted since he last looked, running work, and failures or work
    set aside, with links to evidence. Answered or withdrawn questions no longer
    appear as needing him.
  - A resumed worker sees new replies, plan revisions and comments, and
    ownership changes affecting its work with enough context to act. It can
    discover newly relevant lanes from the project and outcome record. Older
    discussion and the context of plan comments remain accessible.
  - A quiet bounded wait reports that nothing changed without returning the full
    discussion or repeatedly waking a model solely to check for updates.
