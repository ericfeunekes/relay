import test from 'node:test';
import assert from 'node:assert/strict';
import { startRuntime, call } from './helpers.mjs';

test('channel logs, original pages, reader acknowledgement, exact references and suggestions over MCP', async t => {
  const runtime = await startRuntime();
  t.after(() => runtime.stop());
  let client = await runtime.connect('codex-thread');
  const invoke = (name, args = {}) => call(client, name, args);
  const project = await invoke('create_project', { actor: 'Eric', name: 'Research' });
  const lane = await invoke('create_lane', { actor: 'Eric', project: project.id, name: 'Weight tracking observations' });
  const root = await invoke('post', { actor: 'Eric', lane: lane.id, body: 'I felt tired during the week of weight tracking.' });
  const reply = await invoke('post', { actor: 'Eric', lane: lane.id, body: 'We set the export approach aside because the schema lost dates.', reply_to: root.id });
  assert.match(reply.created_at, /^\d{4}-\d\d-\d\dT/);
  assert.equal((await invoke('read_lane', { lane: lane.id })).plans.length, 0);
  assert.equal((await invoke('read_lane', { lane: lane.id })).tasks.length, 0);
  for (let i = 0; i < 53; i++) await invoke('post', { actor: 'worker', lane: lane.id, body: `Observation ${i}` });
  const recent = await invoke('read_lane', { lane: lane.id });
  assert.equal(recent.posts.length, 50, 'default read is bounded');
  assert.equal(recent.has_more, true);
  assert.equal(recent.posts[0].body, 'Observation 3');
  const earlier = await invoke('read_lane', { lane: lane.id, before: recent.next_before });
  assert.deepEqual(earlier.posts.map(post => post.body), [root.body, reply.body, 'Observation 0', 'Observation 1', 'Observation 2']);
  assert.equal(earlier.posts[1].parent.id, root.id);
  assert.equal(earlier.has_more, false);

  // A recent first visit is acknowledged explicitly, while Eric and another thread remain independent.
  await invoke('acknowledge_read', { lane: lane.id, reader: 'thread-A', expected_position: 0, position: recent.position });
  const lateReply = await invoke('post', { actor: 'peer', lane: lane.id, body: 'New reply to the first observation', reply_to: root.id });
  const page = await invoke('catch_up', { lane: lane.id, reader: 'thread-A', limit: 1 });
  assert.deepEqual(page.posts.map(post => post.id), [lateReply.id]);
  assert.equal(page.posts[0].parent.body, root.body);
  assert.deepEqual(await invoke('catch_up', { lane: lane.id, reader: 'thread-A', limit: 1 }), page, 'lost response/retry does not consume entries');
  const later = await invoke('post', { actor: 'peer', lane: lane.id, body: 'Arrived after the first page' });
  await invoke('acknowledge_read', { lane: lane.id, reader: 'thread-A', expected_position: page.saved_position, position: page.position });
  await invoke('acknowledge_read', { lane: lane.id, reader: 'thread-A', expected_position: page.saved_position, position: page.position });
  assert.deepEqual((await invoke('catch_up', { lane: lane.id, reader: 'thread-A' })).posts.map(post => post.id), [later.id]);
  const eric = await invoke('catch_up', { lane: lane.id, reader: 'Eric', limit: 1 });
  const other = await invoke('catch_up', { lane: lane.id, reader: 'thread-B', limit: 2 });
  assert.deepEqual(eric.posts.map(post => post.id), [root.id]);
  assert.deepEqual(other.posts.map(post => post.id), [root.id, reply.id]);
  await invoke('read_lane', { lane: lane.id, before: recent.next_before });
  assert.deepEqual(await invoke('catch_up', { lane: lane.id, reader: 'Eric', limit: 1 }), eric, 'older browsing preserves unread position');
  await invoke('acknowledge_read', { lane: lane.id, reader: 'Eric', expected_position: 0, position: other.position });
  await assert.rejects(invoke('acknowledge_read', { lane: lane.id, reader: 'Eric', expected_position: 0, position: eric.position }), /changed/);
  assert.equal((await invoke('catch_up', { lane: lane.id, reader: 'Eric', limit: 1 })).posts[0].body, 'Observation 0');

  // Old event-cursor clients still advance through all forward pages, including late replies.
  const forward = await invoke('read_lane', { lane: lane.id, after: recent.cursor, limit: 1 });
  assert.deepEqual(forward.posts.map(post => post.id), [lateReply.id]);
  assert.equal(forward.has_more, true);
  const next = await invoke('read_lane', { lane: lane.id, after: forward.next_after, limit: 1 });
  assert.deepEqual(next.posts.map(post => post.id), [later.id]);
  assert.equal(next.has_more, false);
  let eventCursor = next.cursor;
  const expected = [];
  for (let i = 0; i < 55; i++) expected.push((await invoke('post', { actor: 'peer', lane: lane.id, body: `Forward page ${i}` })).id);
  const received = [];
  for (;;) {
    const batch = await invoke('read_lane', { lane: lane.id, after: eventCursor });
    received.push(...batch.posts.map(post => post.id));
    const previous = eventCursor;
    eventCursor = batch.cursor;
    if (previous === eventCursor) break; // An existing client need not understand has_more to avoid skips.
  }
  assert.deepEqual(received, expected);

  const results = await invoke('search_posts', { project: project.id, query: 'SCHEMA lost' });
  assert.deepEqual(results.posts.map(post => post.id), [reply.id]);
  assert.equal(results.posts[0].parent.id, root.id);
  assert.equal((await invoke('search_posts', { project: project.id, query: 'aside approach' })).posts[0].id, reply.id);
  const unicode = await invoke('post', { actor: 'Eric', lane: lane.id, body: 'Été: observation datée' });
  assert.equal((await invoke('search_posts', { project: project.id, query: 'Été' })).posts[0].id, unicode.id, 'identical Unicode query remains recoverable');
  const fresh = await runtime.connect('fresh-reader');
  const exact = JSON.parse((await fresh.readResource({ uri: results.posts[0].reference })).contents[0].text);
  assert.equal(exact.body, reply.body);
  assert.equal(exact.parent.id, root.id);
  assert.equal(exact.project, project.id);
  assert.equal(exact.context.before, reply.id + 1);
  const rootContext = await invoke('get_post', { post: root.id });
  assert.deepEqual(rootContext.replies.map(post => post.id), [reply.id, lateReply.id]);
  const task = await invoke('add_task', { actor: 'Eric', lane: lane.id, title: 'Recheck export dates', source_post: reply.id });
  assert.equal(task.source_post.reference, `agent-mail://posts/${reply.id}`);
  await invoke('claim_task', { actor: 'Eric', task: task.id });
  await invoke('submit_task', { actor: 'Eric', task: task.id, post: later.id });
  await invoke('review_task', { actor: 'Eric', task: task.id, post: later.id, action: 'accept' });
  assert.equal((await invoke('read_lane', { lane: lane.id })).tasks[0].state, 'done');

  const unrelated = await invoke('create_project', { actor: 'Eric', name: 'Other project' });
  const elsewhere = await invoke('create_lane', { actor: 'Eric', project: unrelated.id, name: 'Outside' });
  const hidden = await invoke('post', { actor: 'peer', lane: elsewhere.id, body: reply.body });
  assert.ok(!(await invoke('search_posts', { project: project.id, query: 'schema' })).posts.some(post => post.id === hidden.id));
  await assert.rejects(invoke('add_task', { actor: 'Eric', lane: lane.id, title: 'Invalid source', source_post: hidden.id }), /task project/);
  await assert.rejects(invoke('acknowledge_read', { lane: lane.id, reader: 'Eric', expected_position: other.position, position: hidden.id }), /this lane/);
  assert.equal((await invoke('read_lane', { lane: lane.id })).tasks.length, 1, 'rejected source rolls task creation back');

  const discussion = await invoke('post', { actor: 'peer', lane: lane.id, body: 'Export schema date correction https://github.com/example/repo/pull/42' });
  const preflight = await invoke('suggest_related', { project: project.id, kind: 'post', text: 'Export schema date correction followup' });
  assert.ok(preflight.suggestions.some(item => item.post.id === discussion.id));
  const suggestion = preflight.suggestions.find(item => item.post.id === discussion.id);
  assert.ok(suggestion);
  assert.deepEqual(suggestion.links, ['https://github.com/example/repo/pull/42']);
  const match = await invoke('post', { actor: 'Eric', lane: lane.id, body: `Export schema date correction followup ${suggestion.links[0]}` });
  assert.equal(match.body, 'Export schema date correction followup https://github.com/example/repo/pull/42');
  assert.deepEqual((await invoke('suggest_related', { project: project.id, kind: 'post', text: 'Sourdough hydration recipe' })).suggestions, []);
  const overlapCheck = await invoke('suggest_related', { project: project.id, kind: 'channel', text: 'Weight tracking observations followup' });
  assert.equal(overlapCheck.suggestions[0].lane, lane.id);
  const overlap = await invoke('create_lane', { actor: 'Eric', project: project.id, name: 'Weight tracking observations followup' });
  assert.ok((await invoke('list_lanes', { project: project.id })).some(row => row.id === overlap.id), 'dismissing is simply using both lanes');
  const countBefore = (await invoke('list_lanes', { project: project.id })).length;
  const proposed = await invoke('suggest_related', { project: project.id, kind: 'channel', text: 'Weight tracking observations another' });
  assert.ok(proposed.suggestions.some(item => item.lane === lane.id));
  assert.equal((await invoke('list_lanes', { project: project.id })).length, countBefore, 'choosing reuse never creates a spare lane');
  const single = await invoke('create_lane', { actor: 'Eric', project: project.id, name: 'Exports' });
  assert.equal((await invoke('suggest_related', { project: project.id, kind: 'channel', text: 'Export' })).suggestions[0].lane, single.id);
  const general = await invoke('create_lane', { actor: 'Eric', project: project.id, name: 'Debugging' });
  await invoke('post', { actor: 'peer', lane: general.id, body: 'Export schema dates need correction' });
  assert.ok((await invoke('suggest_related', { project: project.id, kind: 'channel', text: 'Export schema' })).suggestions.some(item => item.lane === general.id));
  const pension = await invoke('create_lane', { actor: 'Eric', project: project.id, name: 'Pension splitting' });
  assert.equal((await invoke('suggest_related', { project: project.id, kind: 'channel', text: 'Pension' })).suggestions[0].lane, pension.id);

  await runtime.restart();
  client = await runtime.connect('reconnected-thread');
  assert.deepEqual((await invoke('catch_up', { lane: lane.id, reader: 'thread-A', limit: 1 })).posts.map(post => post.id), [later.id]);
  assert.equal((await invoke('get_post', { post: reply.id })).body, reply.body);
  assert.equal((await invoke('read_lane', { lane: lane.id })).tasks[0].source_post.reference, `agent-mail://posts/${reply.id}`);
});
