import { McpServer, ResourceTemplate, type CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { StoreAPI } from './contracts';

const id = z.number().int().positive();
const text = z.string().trim().min(1);
const actor = text;
const step = z.object({ id: text, title: text });
const readOnly = { readOnlyHint: true } as const;
const changeInput = {
  after: z.number().int().nonnegative().default(0),
  project: id.optional(),
  lanes: z.array(id).min(1).optional(),
};

type LinkScheme = 'agent-mail' | 'relay';

function contentJSON(value: unknown, useRelayLinks: boolean) {
  if (!useRelayLinks) return JSON.stringify(value);
  return JSON.stringify(value, (key, entry) => {
    // Only service-generated references change. Authored post, plan, and note text stays untouched.
    if (key === 'reference' && typeof entry === 'string' && /^agent-mail:\/\/posts\/[1-9]\d*$/.test(entry)) {
      return entry.replace('agent-mail:', 'relay:');
    }
    return entry;
  });
}

export function createServer(store: StoreAPI, primary: LinkScheme = 'relay'): McpServer {
  const isRelay = primary === 'relay';
  const schemes: LinkScheme[] = isRelay ? ['relay', 'agent-mail'] : ['agent-mail', 'relay'];
  const primaryTool = (name: string) => isRelay ? `relay_${name}` : name;
  const server = new McpServer(isRelay
    ? { name: 'relay', title: 'Relay', version: '0.1.0', description: 'Shared project context, plans and checklists for agents.' }
    : { name: 'Agent Mail', version: '0.1.0' }, {
    instructions: `Read ${primary}://guidance/start before contributing. Clients without MCP resources can call ${primaryTool('get_guidance')} for the same instructions. Projects contain lanes with feeds, tasks and shared plans. Runtime continuation and deployment remain host actions.`,
  });
  const operations = new Set<string>();
  const registrations: ((scheme: LinkScheme) => void)[] = [];
  function relayWording(value: string) {
    return value.replace(/\b[a-z]+(?:_[a-z]+)+\b/g, word => operations.has(word) ? `relay_${word}` : word)
      .replaceAll('Agent Mail', 'Relay').replaceAll('agent-mail://posts/', 'relay://posts/');
  }
  function registerOperation<Shape extends z.ZodRawShape>(
    name: string, description: string, shape: Shape, annotations: typeof readOnly | undefined,
    run: (args: z.output<z.ZodObject<Shape>>, useRelayLinks: boolean) => Promise<CallToolResult>,
  ) {
    operations.add(name);
    const inputSchema = z.object(shape);
    registrations.push(scheme => {
      const relayName = scheme === 'relay';
      const useRelayLinks = relayName && isRelay;
      const compatibility = !relayName && isRelay;
      const displayDescription = relayName ? relayWording(description) : description;
      server.registerTool(relayName ? `relay_${name}` : name, {
        description: compatibility ? `Compatibility alias for relay_${name}. ${displayDescription}` : displayDescription,
        inputSchema, annotations,
      }, args => run(args, useRelayLinks));
    });
  }
  function tool(name: string, description: string, shape: z.ZodRawShape, annotations?: typeof readOnly) {
    registerOperation(name, description, shape, annotations, async (args, useRelayLinks) => {
      try {
        const result = await store.call(name, args);
        return { content: [{ type: 'text', text: contentJSON(result, useRelayLinks) }] };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] };
      }
    });
  }
  tool('list_projects', 'Discover folder-independent projects. All connected participants share access.', {}, readOnly);
  tool('create_project', 'Create a project grouping lanes; folder references are optional context.', { name: text, actor, context: z.string().optional() });
  tool('list_lanes', 'Find lanes in a project.', { project: id }, readOnly);
  tool('create_lane', 'Before creating, use suggest_related(kind=channel) to check overlap and choose reuse or dismiss. Create a lane for shared work; link the existing outcome task when work belongs to one.', { project: id, name: text, actor, outcome_task: id.optional() });
  const pageInput = { limit: z.number().int().min(1).max(100).default(50), before: id.optional() };
  tool('read_lane', 'Read a page of original posts with reply context, plus checklist/plans/orchestration. On joining, read get_project_understanding when shared_understanding is returned; its through_post covers this channel, or is null when no channel checkpoint is set. Default is recent posts; next_before browses older entries without changing saved positions. after uses the existing event cursor and next_after continues forward pages.', { lane: id, after: z.number().int().nonnegative().default(0), ...pageInput }, readOnly);
  tool('catch_up', 'Read oldest unread posts and replies for an explicit reader (use your actual thread ID or Eric identity). On joining, read get_project_understanding when shared_understanding is returned. Its non-null through_post can be passed as after_post to start after the covered discussion. An explicit older after_post still returns those messages. Call acknowledge_read only after receiving the page; retrying before acknowledgement repeats unread entries.', { lane: id, reader: text, limit: pageInput.limit, after_post: z.number().int().nonnegative().optional() }, readOnly);
  tool('get_project_understanding', 'Read the contributor-maintained Current understanding and its covered-through post for each included channel. Returns null before creation. Use this on joining a channel, then catch_up after its checkpoint. Contributors decide what belongs here and can correct omissions found in earlier discussion.', { project: id }, readOnly);
  tool('save_project_understanding', 'Save the shared Markdown and channel coverage together. Use base_revision from get_project_understanding, or 0 for creation; a stale revision fails so you can merge with the latest text. covered_through is the complete set of channel checkpoints accounted for in this revision. Contributors choose when and how to update it.', { project: id, actor, base_revision: z.number().int().nonnegative(), body: z.string(), covered_through: z.array(z.object({ lane: id, post: id })) });
  tool('acknowledge_read', 'Save a successfully received page position for this reader. expected_position is saved_position from catch_up (0 for a first recent visit); position is the received page position. Browsing never acknowledges automatically.', { lane: id, reader: text, expected_position: z.number().int().nonnegative(), position: z.number().int().nonnegative() });
  tool('get_post', 'Open an exact original post or reply by ID, with its author, date, channel and parent context. Canonical links use agent-mail://posts/<id>.', { post: id }, readOnly);
  tool('search_posts', 'Search original project posts and replies containing every query term (ASCII case-insensitive; other letters keep case); returns dated entries, parent context and exact links. Paginate older matches with next_before.', { project: id, query: text, ...pageInput }, readOnly);
  tool('suggest_related', 'Before posting or creating a channel, find related existing project discussions and links. Choose which links to include or whether to reuse a channel; dismiss by proceeding unchanged. Deterministic text matches only, no models/embeddings. Post candidates cover the latest 500 project posts; channel matches include names and 20 recent posts per channel.', { project: id, text, kind: z.enum(['post','channel']) }, readOnly);
  tool('post', 'Use suggest_related(kind=post) before publishing to choose any related links to include in body. Append a finding or reply; posts confer no new permissions.', { lane: id, actor, body: text, reply_to: id.optional() });
  tool('add_task', 'Add actionable agreed-scope work; optional ideas belong in the feed. source_post links the original motivating entry in this project.', { lane: id, title: text, actor, source_post: id.optional() });
  tool('claim_task', 'Claim open work; a conflicting claim preserves its owner.', { task: id, actor });
  tool('submit_task', 'Submit owned work with evidence in a same-lane post.', { task: id, actor, post: id });
  tool('review_task', 'Accept submitted work or request revision. Who may review follows the chosen workflow: direct work or delegated steps can be checked off by their owner; a named reviewer accepts reviewed contributions.', { task: id, actor, post: id, action: z.enum(['accept', 'revise']) });
  tool('close_task', 'Close unfinished work, including blocked work, with a reason in a same-lane post.', { task: id, actor, post: id });
  tool('block_task', 'Mark open or working work blocked on an answer. The same-lane post states the question, what it blocks, who must answer and how work resumes. Blocked work keeps its owner and stays unresolved.', { task: id, actor, post: id });
  tool('unblock_task', 'Resume blocked work with a same-lane answer post; it returns to working if owned, otherwise open. Recording this does not resume any agent.', { task: id, actor, post: id });
  tool('link_task', 'Record the actual runtime task working on this item (e.g. codex, claude, chatgpt and its thread). This does not launch, resume or message it.', { task: id, actor, runtime: text, thread: text, host: text.optional() });
  tool('relink_task', 'Replace the runtime link of unfinished work using the exact expected_previous link from the task. Keeps both addresses in task history. This does not control either runtime.', {
    task: id, actor, runtime: text, thread: text, host: text.optional(),
    expected_previous: z.object({ runtime: text, thread_id: text, host: text }),
  });
  tool('record_archived', 'Record that the linked runtime task was actually archived by its host, after the item is done or closed. Never performs or verifies archival; archiving is optional.', { task: id, actor });
  tool('claim_orchestrator', 'Explicitly claim lane orchestration for a runtime session.', { lane: id, actor, runtime: text, session: text });
  tool('release_orchestrator', 'Release this session’s lane orchestration claim with retained history.', { lane: id, actor, session: text });
  tool('handoff_orchestrator', 'Deliberately hand lane orchestration to a named successor.', { lane: id, actor, session: text, new_actor: text, new_runtime: text, new_session: text, reason: text });
  tool('reassign_orchestrator', 'Record deliberate workflow-authorized reassignment; actor labels are trusted attribution.', { lane: id, actor, new_actor: text, new_runtime: text, new_session: text, reason: text });
  tool('read_changes', 'Catch up on all work, one project, or followed lanes. Lane filters also discover new lanes in their projects. `waiting` includes current blocked work and question posts in scope. Start from a fresh snapshot when changing scope.', changeInput, readOnly);
  registerOperation('wait_changes',
    'Wait at most 60 seconds for changes that match the chosen project or lanes. A timeout still returns the latest scan cursor. No model wake or scheduling.',
    { ...changeInput, timeout: z.number().min(0).max(60).default(30) }, readOnly,
    async ({ after, timeout, ...scope }, useRelayLinks) => {
    try {
      const deadline = Date.now() + timeout * 1000;
      let cursor = after;
      while (true) {
        const result = await store.call('read_changes', { after: cursor, ...scope }) as { cursor: number; events: unknown[] };
        const changed = result.events.length > 0;
        if (changed || Date.now() >= deadline) {
          return { content: [{ type: 'text', text: contentJSON({ ...result, timed_out: !changed }, useRelayLinks) }] };
        }
        cursor = result.cursor;
        await new Promise(resolve => setTimeout(resolve, Math.min(100, Math.max(0, deadline - Date.now()))));
      }
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] };
    }
  });
  tool('list_plans', 'Find current and closed plans retained on a lane.', { lane: id }, readOnly);
  tool('create_plan', 'Create a lane’s current plan; proposed steps are not claimable tasks.', { lane: id, actor, title: text, body: z.string(), steps: z.array(step) });
  tool('get_plan', 'Read retained revisions, comments, source links and reconciliation needs.', { plan: id }, readOnly);
  tool('edit_plan', 'Save a new revision from an explicit base; stale edits fail visibly.', { plan: id, actor, base_revision: id, body: z.string(), steps: z.array(step) });
  tool('comment_plan', 'Discuss the whole plan or a span in an immutable revision; span offsets use UTF-16.', { plan: id, actor, revision: id, body: text, reply_to: id.optional(), start: z.number().int().nonnegative().optional(), end: z.number().int().nonnegative().optional() });
  tool('accept_plan', 'Explicitly accept a chosen revision atomically into linked tasks; retries are idempotent. AI/person/mixed review is chosen by workflow.', { plan: id, actor, revision: id, destination_lane: id.optional(), reconciliations: z.array(z.object({ step_id: text, task: id, action: z.enum(['keep','replace']) })).optional() });
  tool('close_plan', 'Close the current plan only after EVERY task in its own lane is done or closed with a reason.', { plan: id, actor, reason: text });
  const guidance = {
    start: '# Start with shared work\nDiscover list_projects and list_lanes, then read_lane for current direction, discussion, tasks and plan. Work directly for bounded questions; add plans, lanes or orchestration when useful. Proposed ideas remain distinct from actionable tasks. Read roles for delegated work and continuity before waiting or finishing. Both are resources and get_guidance topics. All admitted participants can access all projects; actor labels are trusted attribution. A post does not grant permission. Before publishing or creating a channel, use suggest_related to choose related links or reuse an existing channel. read_lane gives a recent page; next_before browses older entries. For saved catch-up, use your actual thread ID (or eric) as reader in catch_up, then acknowledge_read only after receiving the page; use its saved_position as expected_position and its position as position. For a first recent visit, acknowledge its position with expected_position 0; a changed-position error means catch_up again. read_changes/wait_changes remain the separate event feed.\n',
    roles: '# Work in your recorded role\nFind the chosen workflow, scope, reviewer and finite checkpoint. Claim tasks before edits; submit evidence for assessment; when the workflow names a reviewer, do not accept your own submission. Plan acceptance is revision-specific and may be AI-only, human or mixed. Explicit orchestration claims identify runtime and session; copied context does not transfer ownership. Peers can manage delegated steps without a coordinator relay. Keep questions, dispositions and evidence in context.\n',
    continuity: '# Continue or finish truthfully\nUse read_changes and bounded wait_changes with a durable cursor; discover new lanes and read relevant plan revisions/comments. A quiet wait does not complete work. When work needs an answer, post the question, what it blocks, who must answer and how it resumes, then block_task; unblock_task with the answer. read_changes `waiting` shows what is still blocked. At a finite checkpoint leave pending work, owner and resumption condition visible. Shared updates never wake or resume models. Host actions require supported runtime tools. Finish required work and assessment before completion; chat archival is optional. No hosted deployment, OAuth client proof or migration is implied by this local implementation.\n',
  };
  registerOperation('get_guidance',
    'Read Agent Mail guidance on getting started, assigned roles, or continuing and finishing work.',
    { topic: z.enum(['start', 'roles', 'continuity']).default('start') }, readOnly,
    async ({ topic }, useRelayLinks) => ({
      content: [{ type: 'text', text: useRelayLinks ? relayWording(guidance[topic]) : guidance[topic] }],
    }));
  for (const scheme of schemes) {
    for (const register of registrations) register(scheme);
    const relayName = scheme === 'relay';
    const useRelayLinks = relayName && isRelay;
    server.registerResource(relayName ? 'relay_post' : 'post',
      new ResourceTemplate(`${scheme}://posts/{post}`, { list: undefined }),
      { mimeType: 'application/json', description: 'An exact original post with reply context' },
      async (uri, variables) => {
        const post = Number(variables.post);
        const result = await store.call('get_post', { post });
        return { contents: [{ uri: uri.href, mimeType: 'application/json', text: contentJSON(result, useRelayLinks) }] };
      });
    for (const [name, body] of Object.entries(guidance)) {
      const uri = `${scheme}://guidance/${name}`;
      server.registerResource(relayName ? `relay_${name}` : name, uri, {
        mimeType: 'text/markdown', description: `${relayName ? 'Relay' : 'Agent Mail'} ${name} guidance`,
      }, async () => ({
        contents: [{ uri, mimeType: 'text/markdown', text: useRelayLinks ? relayWording(body) : body }],
      }));
    }
  }
  return server;
}
