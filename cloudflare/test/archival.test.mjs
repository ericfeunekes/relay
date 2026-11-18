import assert from 'node:assert/strict';
import { test } from 'node:test';
import { call as clientCall, startRuntime } from './helpers.mjs';

// Runtime links and archival records cross the real HTTP/MCP adapter into the SQLite object.
test('runtime task links and truthful archival records', { timeout: 240000 }, async t => {
  const runtime = await startRuntime();
  t.after(() => runtime.stop());
  const call = (name, args) => runtime.call(name, args);
  const project = await call('create_project', { name: 'Archival proof', actor: 'Eric' });
  const lane = await call('create_lane', { project: project.id, name: 'research', actor: 'Eric' });

  await t.test('a link records the observed runtime task once and appears in catch-up', async () => {
    const task = await call('add_task', { lane: lane.id, title: 'Linked once', actor: 'Eric' });
    const { cursor } = await call('read_changes', { after: 0 });
    await assert.rejects(call('relink_task', {
      task: task.id, actor: 'orchestrator', runtime: 'codex', thread: 'replacement',
      expected_previous: { runtime: 'claude', thread_id: 'missing', host: 'local' },
    }), /does not match/);
    assert.equal((await call('read_changes', { after: cursor })).cursor, cursor);
    const linked = await call('link_task', { task: task.id, actor: 'orchestrator', runtime: 'chatgpt', thread: 'conversation-1' });
    assert.deepEqual([linked.runtime, linked.thread_id, linked.host, linked.archived], ['chatgpt', 'conversation-1', 'local', 0]);
    const changes = await call('read_changes', { after: cursor });
    assert.equal(changes.events.at(-1).kind, 'link_task');
    assert.equal(changes.tasks.find(row => row.id === task.id).thread_id, 'conversation-1');
    await assert.rejects(call('link_task', { task: task.id, actor: 'orchestrator', runtime: 'codex', thread: 'other' }), /already has a linked/);
    assert.equal((await call('read_changes', { after: 0 })).cursor, changes.cursor);
  });

  await t.test('replacing a blocked task runtime keeps evidence and refuses a competing stale link', async () => {
    const task = await call('add_task', { lane: lane.id, title: 'Waiting after revision', actor: 'Eric' });
    const previous = { runtime: 'claude', thread_id: 'ended-session', host: 'laptop' };
    await call('link_task', { task: task.id, actor: 'orchestrator', runtime: previous.runtime, thread: previous.thread_id, host: previous.host });
    await call('claim_task', { task: task.id, actor: 'worker' });
    const result = await call('post', { lane: lane.id, actor: 'worker', body: 'Original result' });
    await call('submit_task', { task: task.id, actor: 'worker', post: result.id });
    const review = await call('post', { lane: lane.id, actor: 'Eric', body: 'More evidence needed' });
    await call('review_task', { task: task.id, actor: 'Eric', post: review.id, action: 'revise' });
    const question = await call('post', { lane: lane.id, actor: 'worker', body: 'Waiting for the missing measurement' });
    const blocked = await call('block_task', { task: task.id, actor: 'worker', post: question.id });
    const { cursor } = await call('read_changes', { lanes: [lane.id] });
    const otherClient = await runtime.connect('replacement');
    const scope = { after: cursor, lanes: [lane.id] };
    const request = { task: task.id, actor: 'orchestrator', runtime: 'codex', host: 'desktop', expected_previous: previous };

    const { expected_previous, ...withoutPrevious } = request;
    await assert.rejects(call('relink_task', { ...withoutPrevious, thread: 'no-expected-link' }));
    await assert.rejects(call('relink_task', {
      ...request, thread: 'wrong-host', expected_previous: { ...expected_previous, host: 'other-host' },
    }), /does not match/);
    await assert.rejects(call('relink_task', {
      ...request, runtime: previous.runtime, thread: previous.thread_id, host: previous.host,
    }), /unchanged/);
    assert.equal((await call('read_changes', scope)).cursor, cursor);

    const competing = await Promise.allSettled([
      call('relink_task', { ...request, thread: 'replacement-a' }),
      clientCall(otherClient, 'relink_task', { ...request, thread: 'replacement-b' }),
    ]);
    const [winner] = competing.filter(result => result.status === 'fulfilled');
    const [stale] = competing.filter(result => result.status === 'rejected');
    assert.ok(winner && stale);
    assert.match(stale.reason.message, /does not match/);
    const current = { runtime: 'codex', thread_id: winner.value.thread_id, host: 'desktop' };
    const expectedTask = { ...blocked, ...current };
    assert.deepEqual(winner.value, expectedTask);

    const changes = await clientCall(otherClient, 'read_changes', scope);
    assert.deepEqual(changes.events.map(event => [event.kind, event.entity_id, JSON.parse(event.detail)]),
      [['relink_task', task.id, { previous, current }]]);
    assert.deepEqual(changes.tasks, [expectedTask]);
    assert.deepEqual(changes.waiting, [{ ...expectedTask, question }]);
    const laneRead = await clientCall(otherClient, 'read_lane', { lane: lane.id });
    assert.deepEqual(laneRead.tasks.find(row => row.id === task.id), expectedTask);
    assert.equal(laneRead.posts.find(row => row.id === expectedTask.result_post).body, result.body);
    assert.equal(laneRead.posts.find(row => row.id === expectedTask.review_post).body, review.body);
  });

  await t.test('archival is recorded only for finished linked work; unfinished or unlinked work is refused', async () => {
    const unlinked = await call('add_task', { lane: lane.id, title: 'Finished without link', actor: 'Eric' });
    const reason = await call('post', { lane: lane.id, actor: 'Eric', body: 'Not needed after all' });
    await call('close_task', { task: unlinked.id, actor: 'Eric', post: reason.id });
    const working = await call('add_task', { lane: lane.id, title: 'Still working', actor: 'Eric' });
    await call('link_task', { task: working.id, actor: 'orchestrator', runtime: 'claude', thread: 'session-2' });
    await call('claim_task', { task: working.id, actor: 'worker' });
    const { cursor } = await call('read_changes', { after: 0 });
    await assert.rejects(call('record_archived', { task: unlinked.id, actor: 'orchestrator' }), /done or closed task with a linked/);
    await assert.rejects(call('record_archived', { task: working.id, actor: 'orchestrator' }), /done or closed task with a linked/);
    assert.equal((await call('read_changes', { after: 0 })).cursor, cursor);
    const firstLink = await call('link_task', { task: unlinked.id, actor: 'orchestrator', runtime: 'codex', thread: 'finished-session' });
    assert.equal(firstLink.state, 'closed');
    await assert.rejects(call('relink_task', {
      task: unlinked.id, actor: 'orchestrator', runtime: 'codex', thread: 'replacement',
      expected_previous: { runtime: 'codex', thread_id: 'finished-session', host: 'local' },
    }), /requires unfinished/);
  });

  await t.test('accepted work stays complete when unarchived; an archived record freezes but stays findable after restart', async () => {
    const task = await call('add_task', { lane: lane.id, title: 'Research question', actor: 'Eric' });
    await call('link_task', { task: task.id, actor: 'orchestrator', runtime: 'codex', thread: 'thread-3', host: 'laptop' });
    await call('claim_task', { task: task.id, actor: 'researcher' });
    const result = await call('post', { lane: lane.id, actor: 'researcher', body: 'Findings with sources' });
    await call('submit_task', { task: task.id, actor: 'researcher', post: result.id });
    const review = await call('post', { lane: lane.id, actor: 'Eric', body: 'Accepted into the outcome' });
    const done = await call('review_task', { task: task.id, actor: 'Eric', post: review.id, action: 'accept' });
    assert.equal(done.state, 'done');
    assert.equal(done.archived, 0);
    const replacement = { runtime: 'claude', thread: 'replacement',
      expected_previous: { runtime: 'codex', thread_id: 'thread-3', host: 'laptop' } };
    await assert.rejects(call('relink_task', { task: task.id, actor: 'orchestrator', ...replacement }), /requires unfinished/);
    const archived = await call('record_archived', { task: task.id, actor: 'orchestrator' });
    assert.equal(archived.archived, 1);
    const { cursor } = await call('read_changes', { after: 0 });
    for (const [name, args] of [
      ['record_archived', {}], ['link_task', { runtime: 'codex', thread: 'again' }],
      ['relink_task', replacement],
      ['claim_task', {}], ['close_task', { post: review.id }],
    ]) await assert.rejects(call(name, { task: task.id, actor: 'orchestrator', ...args }), /archived/, name);
    assert.equal((await call('read_changes', { after: 0 })).cursor, cursor);
    await runtime.restart();
    const view = await call('read_lane', { lane: lane.id });
    const row = view.tasks.find(each => each.id === task.id);
    assert.deepEqual([row.state, row.archived, row.runtime, row.thread_id, row.host], ['done', 1, 'codex', 'thread-3', 'laptop']);
    assert.equal(view.posts.find(post => post.id === row.result_post).body, 'Findings with sources');
    assert.equal(view.posts.find(post => post.id === row.review_post).body, 'Accepted into the outcome');
  });
});
