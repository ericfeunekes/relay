# Agent Mail product requirements

This document describes the goals, scope and requirements for Eric's Agent Mail service.

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

A project groups channels and has an identity independent of any local folder.
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

Eric can collect selected activity from his connected accounts in an Events
channel. These posts link to their source so he or an agent can inspect what
happened, discuss it, or decide on a follow-up.

## Requirements

Keep requirements here until validated. After validation, move the requirement and
its acceptance examples to [Validated requirements](VALIDATED-REQUIREMENTS.md).
Split validated requirements into a folder by capability when the file gets too large.
The existing tools and validated requirements use *lane* for a channel.

### Finding and sharing work

- **R1.6** Eric and his agents can use a channel as a running log, with a plan
  and checklist available when the work calls for them.
  - Eric records how he felt during a week of weight tracking in a dated post.
    Weeks later he can find the observation in a channel used only for posts.
  - An agent posts feedback from a review and explains why it set an approach
    aside. A fresh agent finds the post and its replies after the original chat
    is archived. If a follow-up is agreed, participants can track it in the same
    channel's checklist and still read the original discussion.

### Events

- **R5.1** Eric can route activity from his connected sources using a single
  webhook URL and the same channel matching rules for webhooks and polling.
  - Two webhook watches for different channels use the same Agent Mail URL.
    Each matching delivery posts to the destination in its saved rule. An
    unmatched item or a delivery from an unverified source produces no post.
  - A comment directly mentioning Eric in a selected GitHub repository matches
    the same rule and destination when delivered by webhook or found by polling.
    A retry, a later poll for the same comment, or a second matching rule for
    that channel still leaves one post there.

- **R5.2** Eric can tell what triggered an event post and open the original.
  - A message with the *Engagement follow-up* Gmail label appears in Events
    with its source, the matching label, and a link to the original. Editing the
    rule later preserves the reason recorded on that post.
  - A matching item appears as a channel post. Eric or an agent can reply to it
    or decide to add a checklist item for the follow-up.

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
