import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startRuntime } from './helpers.mjs';

// Every operation crosses HTTP/MCP into real workerd SQLite Durable Objects.
test('shared plans through the local MCP runtime', { timeout: 180000 }, async t => {
  const runtime = await startRuntime();
  t.after(() => runtime.stop());
  const call = (name, args) => runtime.call(name, args);
  const project = await call('create_project', { name: 'Plans boundary proof', actor: 'test' });
  const projectId = project.id;
  async function lane(name) { return (await call('create_lane', { project: projectId, name, actor: 'test' })).id; }
  async function plan(laneId, proposed = [{ id: 'water', title: 'Buy water' }]) {
    return call('create_plan', { lane: laneId, actor: 'author', title: 'Preparedness', body: 'Buy water today', steps: proposed });
  }
  async function closeTask(laneId, task) {
    const post = await call('post', { lane: laneId, actor: 'reviewer', body: 'Explicitly closed: superseded in this proof' });
    await call('close_task', { task, actor: 'reviewer', post: post.id });
  }

  await t.test('proposals stay separate; competing current plans and stale revisions fail', async () => {
    const l = await lane('conflicts');
    const contenders = await Promise.allSettled([plan(l), plan(l)]);
    assert.equal(contenders.filter(result => result.status === 'fulfilled').length, 1);
    const p = contenders.find(result => result.status === 'fulfilled').value;
    assert.equal((await call('read_lane', { lane: l })).tasks.length, 0);
    const saves = await Promise.allSettled([
      call('edit_plan', { plan: p.id, actor: 'codex', base_revision: 1, body: 'First save', steps: [] }),
      call('edit_plan', { plan: p.id, actor: 'claude', base_revision: 1, body: 'Other save', steps: [] }),
    ]);
    assert.equal(saves.filter(result => result.status === 'fulfilled').length, 1);
    assert.match(saves.find(result => result.status === 'rejected').reason.message, /conflict/);
    await assert.rejects(call('accept_plan', { plan: p.id, actor: 'ai-reviewer', revision: 1 }), /changed since review/);
    const current = await call('get_plan', { plan: p.id });
    assert.equal(current.revisions.length, 2);
    assert.equal(current.acceptances.length, 0);
  });

  await t.test('whole-plan and span comments retain original deleted text and reply context', async () => {
    const l = await lane('comments'), p = await plan(l);
    const whole = await call('comment_plan', { plan: p.id, actor: 'eric', revision: 1, body: 'Review the whole plan' });
    await call('comment_plan', { plan: p.id, actor: 'claude', revision: 1, body: 'Why today?', start: 10, end: 15, reply_to: whole.comment });
    await call('edit_plan', { plan: p.id, actor: 'author', base_revision: 1, body: 'Buy water today, then food', steps: [] });
    assert.equal((await call('get_plan', { plan: p.id })).comments[1].context_status, 'unchanged_at_original_span');
    await call('edit_plan', { plan: p.id, actor: 'author', base_revision: 2, body: '', steps: [] });
    const read = await call('get_plan', { plan: p.id });
    assert.equal(read.revisions[0].body, 'Buy water today');
    assert.equal(read.revisions[2].body, '');
    assert.equal(read.comments[0].context_status, 'revision_changed');
    assert.equal(read.comments[1].quote, 'today');
    assert.equal(read.comments[1].original_body, 'Buy water today');
    assert.equal(read.comments[1].context_status, 'original_span_changed');
    assert.equal(read.comments[1].reply_to, whole.comment);
    const other = await plan(await lane('other-comment-plan'));
    await assert.rejects(call('comment_plan', { plan: other.id, actor: 'author', revision: 1, body: 'bad reply', reply_to: whole.comment }), /this plan/);
    await assert.rejects(call('comment_plan', { plan: p.id, actor: 'author', revision: 1, body: 'bad span', start: 0, end: 100 }), /outside/);
    assert.equal((await call('get_plan', { plan: p.id })).comments.length, 2);
  });

  await t.test('concurrent acceptance and lost-response retry produce exactly one task set with source links', async () => {
    const l = await lane('acceptance'), destination = await lane('destination'), p = await plan(l);
    const input = { plan: p.id, actor: 'ai-reviewer', revision: 1, destination_lane: destination };
    const accepted = await Promise.all([call('accept_plan', input), call('accept_plan', input)]);
    assert.deepEqual(accepted[0], accepted[1]);
    assert.equal(accepted[0].links.length, 1);
    const repeated = await call('accept_plan', input);
    assert.deepEqual(repeated, accepted[0]);
    assert.equal((await call('read_lane', { lane: l })).tasks.length, 0);
    const tasks = (await call('read_lane', { lane: destination })).tasks;
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].id, repeated.links[0].task);
    assert.ok(tasks[0].sources.some(source => source.plan === p.id && source.revision === 1 && source.step_id === 'water'));
    await assert.rejects(call('accept_plan', { ...input, destination_lane: l }), /already accepted/);

    const alternate = await lane('alternate destination');
    await call('edit_plan', { plan: p.id, actor: 'author', base_revision: 1, body: 'Keep existing assignment', steps: [{ id: 'water', title: 'Buy water' }] });
    const { cursor } = await call('read_changes', { after: 0 });
    const updated = await call('accept_plan', { ...input, destination_lane: alternate, revision: 2 });
    assert.equal(updated.links[0].task, tasks[0].id);
    assert.equal(updated.links[0].lane, destination);
    const changes = await call('read_changes', { after: cursor });
    assert.deepEqual(changes.events.map(({ kind, lane }) => [kind, lane]), [
      ['accept_plan', l], ['plan_tasks', destination],
    ]);
    assert.equal((await call('read_lane', { lane: alternate })).tasks.length, 0);

    // Cross-lane work does not extend the source lane closeout gate.
    await call('close_plan', { plan: p.id, actor: 'reviewer', reason: 'Source lane has no unresolved tasks' });
    assert.equal((await call('read_lane', { lane: destination })).tasks[0].state, 'open');
    const next = await plan(l, []);
    assert.notEqual(next.id, p.id);
    const retained = await call('get_plan', { plan: p.id });
    assert.equal(retained.state, 'closed');
    assert.equal(retained.acceptances[0].links[0].task, tasks[0].id);
    assert.equal((await call('accept_plan', input)).id, repeated.id);
  });

  await t.test('changed and removed accepted steps require explicit reconciliation without silent task edits', async () => {
    const l = await lane('reconciliation');
    const p = await plan(l, [{ id: 'water', title: 'Buy water' }, { id: 'food', title: 'Buy food' }]);
    const original = await call('accept_plan', { plan: p.id, actor: 'ai-reviewer', revision: 1 });
    const water = original.links.find(link => link.step_id === 'water').task;
    const food = original.links.find(link => link.step_id === 'food').task;
    await call('edit_plan', { plan: p.id, actor: 'author', base_revision: 1, body: 'Revised plan', steps: [{ id: 'water', title: 'Buy more water' }, { id: 'light', title: 'Buy a light' }] });
    // A retry after a later edit recovers the committed earlier acceptance.
    assert.equal((await call('accept_plan', { plan: p.id, actor: 'ai-reviewer', revision: 1 })).id, original.id);
    assert.equal((await call('get_plan', { plan: p.id })).reconciliation_needed.length, 2);
    await assert.rejects(call('accept_plan', { plan: p.id, actor: 'reviewer', revision: 2 }), /reconciliation/);
    assert.deepEqual((await call('read_lane', { lane: l })).tasks.map(task => task.title), ['Buy water', 'Buy food']);
    const choices = [{ step_id: 'water', task: water, action: 'replace' }, { step_id: 'food', task: food, action: 'keep' }];
    await assert.rejects(call('accept_plan', { plan: p.id, actor: 'reviewer', revision: 2, reconciliations: choices }), /already completed or explicitly closed/);
    await closeTask(l, water);
    const result = await call('accept_plan', { plan: p.id, actor: 'reviewer', revision: 2, reconciliations: choices });
    assert.notEqual(result.links.find(link => link.step_id === 'water').task, water);
    const tasks = (await call('read_lane', { lane: l })).tasks;
    assert.equal(tasks.find(task => task.id === food).state, 'open');
    assert.equal(tasks.find(task => task.id === water).title, 'Buy water');
    assert.equal(tasks.length, 4);
    const retained = await call('get_plan', { plan: p.id });
    assert.equal(retained.reconciliation_needed.length, 0);
    assert.equal(retained.acceptances[0].links.find(link => link.step_id === 'food').task, food);
    assert.equal(retained.revisions[0].steps[0].title, 'Buy water');
  });

  await t.test('every own-lane unresolved task blocks closeout; completed and explicitly closed work permit it', async () => {
    const l = await lane('closeout'), p = await plan(l, []);
    const task = await call('add_task', { lane: l, title: 'Independent obligation', actor: 'author' });
    const taskId = task.id;
    await assert.rejects(call('close_plan', { plan: p.id, actor: 'reviewer', reason: 'too soon' }), /unresolved/);
    await call('claim_task', { task: taskId, actor: 'worker' });
    await assert.rejects(call('close_plan', { plan: p.id, actor: 'reviewer', reason: 'still working' }), /unresolved/);
    const evidence = await call('post', { lane: l, actor: 'worker', body: 'Proof of independent result' });
    await call('submit_task', { task: taskId, actor: 'worker', post: evidence.id });
    await assert.rejects(call('close_plan', { plan: p.id, actor: 'reviewer', reason: 'still submitted' }), /unresolved/);
    await call('review_task', { task: taskId, actor: 'reviewer', post: evidence.id, action: 'accept' });
    const extra = await call('add_task', { lane: l, title: 'Explicitly set aside', actor: 'author' });
    await closeTask(l, extra.id);
    const closed = await call('close_plan', { plan: p.id, actor: 'reviewer', reason: 'Every lane task accounted for' });
    assert.equal(closed.state, 'closed');
    assert.equal(closed.closure_reason, 'Every lane task accounted for');
    await assert.rejects(call('edit_plan', { plan: p.id, actor: 'author', base_revision: 1, body: 'No replacement', steps: [] }), /closed/);
    assert.equal((await call('read_lane', { lane: l })).tasks.length, 2);
  });

  await t.test('invalid destination leaves tasks, events and acceptance unchanged; valid retry remains actionable', async () => {
    const l = await lane('rollback'), p = await plan(l);
    const before = await call('read_changes', { after: 0 });
    await assert.rejects(call('accept_plan', { plan: p.id, actor: 'reviewer', revision: 1, destination_lane: 999999 }), /lane/);
    const after = await call('read_changes', { after: before.cursor });
    assert.equal(after.cursor, before.cursor);
    assert.equal((await call('get_plan', { plan: p.id })).acceptances.length, 0);
    assert.equal((await call('read_lane', { lane: l })).tasks.length, 0);
    const accepted = await call('accept_plan', { plan: p.id, actor: 'reviewer', revision: 1 });
    assert.equal(accepted.links.length, 1);
  });

  await t.test('plan changes expose the new revision, comment and acceptance through catch-up', async () => {
    const l = await lane('plan-changes');
    const before = await call('read_changes', { after: 0 });
    const p = await plan(l);
    const comment = await call('comment_plan', { plan: p.id, actor: 'reviewer', revision: 1, body: 'Visible review comment' });
    await call('edit_plan', { plan: p.id, actor: 'author', base_revision: 1, body: 'Updated visible plan', steps: [] });
    await call('accept_plan', { plan: p.id, actor: 'reviewer', revision: 2 });
    const changes = await call('read_changes', { after: before.cursor });
    assert.deepEqual(changes.events.map(event => event.kind), ['create_plan', 'comment_plan', 'edit_plan', 'accept_plan']);
    const visible = changes.plans.find(value => value.id === p.id);
    assert.equal(visible.current_revision, 2);
    assert.equal(visible.comments[0].id, comment.comment);
    assert.equal(visible.comments[0].body, 'Visible review comment');
    assert.equal(visible.acceptances[0].revision, 2);
    assert.equal((await call('read_changes', { after: changes.cursor })).events.length, 0);
  });

  await t.test('task-add versus plan-close race follows committed event order', async () => {
    const l = await lane('close-race'), p = await plan(l, []);
    const results = await Promise.allSettled([
      call('add_task', { lane: l, actor: 'worker', title: 'Concurrent independent work' }),
      call('close_plan', { plan: p.id, actor: 'reviewer', reason: 'Attempt closeout' }),
    ]);
    assert.equal(results[0].status, 'fulfilled');
    const read = await call('read_lane', { lane: l });
    assert.equal(read.tasks.length, 1);
    if (results[1].status === 'fulfilled') {
      // New unplanned work after a plan closed is allowed; earlier work must block closure.
      const close = read.events.find(event => event.kind === 'close_plan');
      const add = read.events.find(event => event.kind === 'add_task');
      assert.ok(close.id < add.id);
    } else {
      assert.match(results[1].reason.message, /unresolved/);
      assert.equal((await call('get_plan', { plan: p.id })).state, 'current');
    }
  });

  await t.test('saved revisions, comments, acceptance and source links survive runtime restart', async () => {
    const l = await lane('persistence'), p = await plan(l);
    await call('comment_plan', { plan: p.id, actor: 'reviewer', revision: 1, body: 'Persist this review' });
    const accepted = await call('accept_plan', { plan: p.id, actor: 'reviewer', revision: 1 });
    await runtime.restart();
    const recovered = await call('get_plan', { plan: p.id });
    assert.equal(recovered.comments[0].body, 'Persist this review');
    assert.equal(recovered.acceptances[0].id, accepted.id);
    assert.equal((await call('read_lane', { lane: l })).tasks[0].sources[0].plan, p.id);
    assert.equal((await call('accept_plan', { plan: p.id, actor: 'reviewer', revision: 1 })).id, accepted.id);
  });
});

// This fixture changes only the SQL failure mode, using the real store callbacks.
test('SQL failure after the first promoted task rolls back tasks, events and acceptance', { timeout: 180000 }, async t => {
  const runtime = await startRuntime({ entrypoint: 'test/fixtures/rollback.ts' });
  t.after(() => runtime.stop());
  const project = await runtime.call('create_project', { actor: 'test', name: 'Atomic SQL rollback' });
  const lane = await runtime.call('create_lane', { actor: 'test', project: project.id, name: 'rollback' });
  const plan = await runtime.call('create_plan', { actor: 'author', lane: lane.id, title: 'Two-step atomic plan', body: '', steps: [
    { id: 'first', title: 'First promoted task' }, { id: 'second', title: 'FAIL SECOND' },
  ] });
  const before = await runtime.call('read_changes', { after: 0 });
  assert.equal((await fetch(`${runtime.url}/__test__/sql-failure`, { method: 'POST' })).status, 200);
  await assert.rejects(runtime.call('accept_plan', { plan: plan.id, actor: 'reviewer', revision: 1 }), /controlled SQL task failure/);
  assert.equal((await runtime.call('read_lane', { lane: lane.id })).tasks.length, 0);
  assert.equal((await runtime.call('read_changes', { after: before.cursor })).cursor, before.cursor);
  assert.equal((await runtime.call('get_plan', { plan: plan.id })).acceptances.length, 0);
  await fetch(`${runtime.url}/__test__/sql-failure`, { method: 'DELETE' });
  const accepted = await runtime.call('accept_plan', { plan: plan.id, actor: 'reviewer', revision: 1 });
  assert.equal(accepted.links.length, 2);
  assert.equal((await runtime.call('read_lane', { lane: lane.id })).tasks.length, 2);
});
