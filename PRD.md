# Agent Mail product requirements

This PRD holds requirements awaiting validation. See
[Validated requirements](VALIDATED-REQUIREMENTS.md) for behavior already verified.

## Goals

Give Eric and his ChatGPT, Codex and Claude agents a running record of what
happened, what they tried, and why they changed direction. Eric can keep the
record on his own, work with an agent, or coordinate several agents on an
outcome or recurring responsibility. He can steer work and judge results from
the contributions and evidence without relaying messages between tasks.

## Users

- **Eric** sets the outcome, steers the work, and decides product questions.
- **Agents** work directly for Eric or take roles appropriate to the outcome.
  In coordinated work, the orchestrator assigns work, assesses coverage,
  reviews results, and accepts the integrated outcome. Independent workers
  produce and integrate assigned changes, contribute findings and questions,
  and challenge each other's work.

## Overview

A project groups channels, called *lanes* in the existing tools and validated
requirements. A project has an identity independent of any local folder.
Repository or folder references can provide optional context. Through MCP,
ChatGPT, Codex and Claude participants can find and contribute to the same
project without access to a shared filesystem.
Installed guidance helps a fresh agent recognize appropriate use, choose useful
collaboration, and find its role and next action.

A channel is an append-only running log. Eric and his agents can leave dated
posts and replies about progress, observations, feedback and decisions,
including why they changed an approach or set it aside. A channel can consist
entirely of posts. Participants can use a checklist to track work and add a
shared plan when they need to agree on an approach. One researcher can work
directly, and Eric can add collaborators or change direction while keeping
the record.

Participants follow relevant discussions, clarify work, identify missing
tasks, and revise their contributions within scope. A plan can propose steps
for acceptance into a selected channel's checklist. Participants can also add
tasks directly. A channel has at most one current plan, which participants
revise in place. Before it closes, every task in its channel must be completed
or explicitly closed with a reason. Another plan can become current after
closeout. The closed plan, revisions, comments and task history remain
available.

In coordinated work, the channel's orchestrator assesses incoming information
and advances authorized work. Independent workers make substantive changes and
integration edits.
Waiting work shows what it needs and how it can resume. Recurring work retains
context between checks without keeping workers active between them.
When Eric returns, he can see what changed, what is still running, and which
choices need him, with the supporting discussion and evidence available.

## Requirements

### Finding and sharing work

- **R1.6** Eric and his agents can use a channel as a running log, with a plan
  and checklist available when the work calls for them.
  - Eric records how he felt during a week of weight tracking in a dated post.
    Weeks later he can find the observation in a channel used only for posts.
  - Eric posts feedback from a review and explains why he set an approach
    aside. While working on his own, he adds a follow-up to the channel's
    checklist and records its completion there.

- **R1.7** Channel reads are paginated by default. Catch-up returns pages of
  original posts and replies after each reader's saved position in the channel.
  - A first visit to a busy channel shows a page of recent posts and replies
    with their text and reply context. One request gets the next page of older
    entries. After reading the recent page, the reader can catch up on entries
    that arrive after it.
  - A Codex thread reads the oldest unread entries first, including a new reply
    to a previously read post. It reads one page and stops. It resumes at the
    next unread entry even if more arrive. Eric and other threads keep their own
    read positions for that channel.
  - If a catch-up page fails to arrive, the reader still gets those entries on
    retry. Browsing earlier pages preserves the saved catch-up position.

- **R1.8** Eric and his agents can search a project's posts and replies and link
  to an exact entry.
  - A fresh agent searches a tax research project and finds the dated reply
    explaining why an approach was set aside. It can open the reply in its
    channel discussion after the original chat is archived.
  - Eric links a checklist item to the post that prompted it. Participants can
    follow the link to the original entry in context after new posts arrive.

- **R1.9** Agent Mail suggests closely related links when someone posts and
  flags possible overlap when a channel is created. Suggestions use existing
  project text and links and incur no model or embedding charges.
  - Eric creates a channel on a topic an existing channel covers. Agent Mail
    shows the overlap and suggests reusing the existing channel or considering
    a merge. Eric can dismiss the suggestion and use both channels.
  - A post about an export fix surfaces a related project discussion and a
    GitHub pull request already linked there. The author chooses whether to
    include either link. A post with no close match gets no suggestions.

- **R1.10** Contributors can maintain one shared Current understanding document
  per project, with a covered-through discussion checkpoint for each channel
  they have accounted for. They choose its content and when to revise it.
  - A fresh agent opening a channel discovers the document, reads it and starts
    catch-up after that channel's checkpoint. A later reply to an old post is
    still returned. Reading the document leaves the reader's saved position
    unchanged until it explicitly acknowledges its chosen catch-up position.
  - An agent requesting older discussion receives those messages alongside the
    document's coverage. It notices an omission and corrects the shared text.
    Concurrent edits from one revision produce a visible conflict so the next
    save can preserve both contributors' work.
  - A feature request arrives in a chat and is brought into the relevant channel
    as a post or reply. Another contributor finds it, discusses it and updates
    the shared understanding when useful. Accepted work links its checklist
    item to that discussion.

## Constraints

This is Eric's personal service for trusted participants, accessible to ChatGPT,
Codex and Claude through MCP. Service authentication controls who can connect.
Every connected participant can access every project; projects have no separate
membership or permission rules. Folder or repository references do not identify
or gate access to a project. Review, acceptance and channel coordination
follow the chosen workflow and can be performed by AI, people or a mixture,
without a mandatory human approval step. Separate tasks retain their normal
permissions.
A post is information for assessment, not approval to cross a permission boundary
or expand the authorized work.

In coordinated work, the orchestrator delegates substantive deliverables,
including document changes and integration work, to independent app tasks.
It may handle small explicitly requested edits and short lookups directly.
Sub-agents may handle small supporting work.

Guidance makes roles, operations and limits discoverable; it does not guarantee
that every model obeys them. Shared-state updates do not by themselves start,
stop or resume an agent. Runtime actions use available host capabilities, and
missing continuation must remain visible rather than imply work will resume.

## Out of scope

Project-specific membership, access controls and multi-user administration;
direct agent inboxes, group mail, automatic wake-ups for every subscriber,
binary file-transfer infrastructure, and a general agent runtime or scheduling
service. A rich-text editor, automatic merging of conflicting plan edits,
per-step plan approval, and plan-step dependencies, dates or estimates are also
outside scope.
