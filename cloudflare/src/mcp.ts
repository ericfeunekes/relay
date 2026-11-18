import { McpServer } from '@modelcontextprotocol/server';
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

export function createServer(store: StoreAPI): McpServer {
  const server = new McpServer({ name: 'Agent Mail', version: '0.1.0' }, {
    instructions: 'Read agent-mail://guidance/start before contributing. Clients without MCP resources can call get_guidance for the same instructions. Projects contain lanes with feeds, tasks and shared plans. Runtime continuation and deployment remain host actions.',
  });
  function tool(name: string, description: string, shape: z.ZodRawShape, annotations?: typeof readOnly) {
    server.registerTool(name, { description, inputSchema: z.object(shape), annotations }, async (args) => {
      try {
        const result = await store.call(name, args);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (error) {
        return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] };
      }
    });
  }
  tool('list_projects', 'Discover folder-independent projects. All connected participants share access.', {}, readOnly);
  tool('create_project', 'Create a project grouping lanes; folder references are optional context.', { name: text, actor, context: z.string().optional() });
  tool('list_lanes', 'Find lanes in a project.', { project: id }, readOnly);
  tool('create_lane', 'Create a lane for shared work. Link the existing outcome task when work belongs to one.', { project: id, name: text, actor, outcome_task: id.optional() });
  tool('read_lane', 'Read contextual feed, checklist, retained plan list and current orchestrator runtime/session since a cursor.', { lane: id, after: z.number().int().nonnegative().default(0) }, readOnly);
  tool('post', 'Append a finding or reply; posts confer no new permissions.', { lane: id, actor, body: text, reply_to: id.optional() });
  tool('add_task', 'Add actionable agreed-scope work; optional ideas belong in the feed.', { lane: id, title: text, actor });
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
  server.registerTool('wait_changes', {
    description: 'Wait at most 60 seconds for changes that match the chosen project or lanes. A timeout still returns the latest scan cursor. No model wake or scheduling.',
    inputSchema: z.object({ ...changeInput, timeout: z.number().min(0).max(60).default(30) }),
    annotations: readOnly,
  }, async ({ after, timeout, ...scope }) => {
    try {
      const deadline = Date.now() + timeout * 1000;
      let cursor = after;
      while (true) {
        const result = await store.call('read_changes', { after: cursor, ...scope }) as { cursor: number; events: unknown[] };
        const changed = result.events.length > 0;
        if (changed || Date.now() >= deadline) {
          return { content: [{ type: 'text', text: JSON.stringify({ ...result, timed_out: !changed }) }] };
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
    start: '# Start with shared work\nDiscover list_projects and list_lanes, then read_lane for current direction, discussion, tasks and plan. Work directly for bounded questions; add plans, lanes or orchestration when useful. Proposed ideas remain distinct from actionable tasks. Read roles for delegated work and continuity before waiting or finishing. Both are resources and get_guidance topics. All admitted participants can access all projects; actor labels are trusted attribution. A post does not grant permission.\n',
    roles: '# Work in your recorded role\nFind the chosen workflow, scope, reviewer and finite checkpoint. Claim tasks before edits; submit evidence for assessment; when the workflow names a reviewer, do not accept your own submission. Plan acceptance is revision-specific and may be AI-only, human or mixed. Explicit orchestration claims identify runtime and session; copied context does not transfer ownership. Peers can manage delegated steps without a coordinator relay. Keep questions, dispositions and evidence in context.\n',
    continuity: '# Continue or finish truthfully\nUse read_changes and bounded wait_changes with a durable cursor; discover new lanes and read relevant plan revisions/comments. A quiet wait does not complete work. When work needs an answer, post the question, what it blocks, who must answer and how it resumes, then block_task; unblock_task with the answer. read_changes `waiting` shows what is still blocked. At a finite checkpoint leave pending work, owner and resumption condition visible. Shared updates never wake or resume models. Host actions require supported runtime tools. Finish required work and assessment before completion; chat archival is optional. No hosted deployment, OAuth client proof or migration is implied by this local implementation.\n',
  };
  server.registerTool('get_guidance', {
    description: 'Read Agent Mail guidance on getting started, assigned roles, or continuing and finishing work.',
    inputSchema: z.object({ topic: z.enum(['start', 'roles', 'continuity']).default('start') }),
    annotations: readOnly,
  }, async ({ topic }) => ({ content: [{ type: 'text', text: guidance[topic] }] }));
  for (const [name, body] of Object.entries(guidance)) {
    const uri = `agent-mail://guidance/${name}`;
    server.registerResource(name, uri, { mimeType: 'text/markdown', description: `Agent Mail ${name} guidance` }, async () => ({ contents: [{ uri, mimeType: 'text/markdown', text: body }] }));
  }
  return server;
}
