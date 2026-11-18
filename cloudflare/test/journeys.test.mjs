import assert from 'node:assert/strict';
import { test } from 'node:test';
import { call, startRuntime } from './helpers.mjs';

// Multi-participant journeys from the PRD examples. Each participant is a separate
// MCP client session over real HTTP into the same local SQLite Durable Object.
test('PRD participant journeys through the local MCP runtime', { timeout: 240000 }, async t => {
  const runtime = await startRuntime();
  t.after(() => runtime.stop());
  const as = async actor => {
    const client = await runtime.connect(actor);
    return (name, args = {}) => call(client, name, 'actor' in args || !needsActor(name) ? args : { ...args, actor });
  };
  const needsActor = name => !['list_projects', 'list_lanes', 'read_lane', 'read_changes', 'wait_changes', 'get_plan', 'list_plans'].includes(name);
  let eric = await as('Eric');
  const project = await eric('create_project', { name: 'Household journeys' });

  await t.test('R1.4 one researcher answers directly; a second worker joins without losing context', async () => {
    const researcher = await as('researcher');
    const lane = await eric('create_lane', { project: project.id, name: 'Water question' });
    const question = await eric('post', { lane: lane.id, body: 'How much water should we store for four people?' });
    const finding = await researcher('post', { lane: lane.id, reply_to: question.id, body: '4 L/person/day for 14 days = 224 L. Source: https://www.getprepared.gc.ca' });
    const acceptance = await eric('post', { lane: lane.id, reply_to: finding.id, body: 'Accepted; plan for 224 L.' });
    const read = await researcher('read_lane', { lane: lane.id });
    assert.deepEqual(read.plans, []);
    assert.equal(read.orchestration, null);
    assert.equal(read.tasks.length, 0);
    assert.equal((await eric('list_lanes', { project: project.id })).length, 1);

    const second = await as('second-worker');
    const joined = await second('read_lane', { lane: lane.id });
    assert.deepEqual(joined.posts.map(post => [post.id, post.actor, post.reply_to]),
      [[question.id, 'Eric', null], [finding.id, 'researcher', question.id], [acceptance.id, 'Eric', finding.id]]);
    await second('post', { lane: lane.id, reply_to: acceptance.id, body: 'Adding rotation schedule research' });
  });

  await t.test('R1.2/R2.1/R2.3 peers add work, check off delegated steps and keep lane acceptance distinct', async () => {
    const claude = await as('claude-peer'), codex = await as('codex-peer'), lead = await as('lead');
    const lane = await lead('create_lane', { project: project.id, name: 'Rotation schedule' });
    const ask = await lead('post', { lane: lane.id, body: 'Which rotation interval?' });
    const answers = await Promise.all([
      claude('post', { lane: lane.id, reply_to: ask.id, body: 'Every 6 months' }),
      codex('post', { lane: lane.id, reply_to: ask.id, body: 'Every 12 months for commercial bottles' }),
    ]);
    await lead('post', { lane: lane.id, reply_to: ask.id, body: `Resolution: commercial bottles 12 months, refilled 6 months (posts ${answers.map(a => a.id).join(', ')})` });
    const idea = await claude('post', { lane: lane.id, body: 'Future idea: a sensor for container age' });

    const step = await codex('add_task', { lane: lane.id, title: 'Draft rotation calendar' });
    const missing = await claude('add_task', { lane: lane.id, title: 'Missing evidence: confirm bottle expiry labels' });
    assert.equal(missing.state, 'open');
    assert.equal(missing.owner, null, 'adding an item does not claim it');

    const cursor = (await claude('read_changes')).cursor;
    await codex('claim_task', { task: step.id });
    const evidence = await codex('post', { lane: lane.id, body: 'Calendar drafted: evidence in this post' });
    await codex('submit_task', { task: step.id, post: evidence.id });
    const checked = await codex('review_task', { task: step.id, post: evidence.id, action: 'accept' });
    assert.equal(checked.state, 'done', 'a worker checks off its own delegated step');

    const observed = await claude('read_changes', { after: cursor });
    assert.ok(observed.tasks.some(task => task.id === step.id && task.state === 'done'), 'peer observes completion without relay');
    await claude('claim_task', { task: missing.id });

    const contribution = await claude('add_task', { lane: lane.id, title: 'Lane contribution: rotation guidance' });
    await claude('claim_task', { task: contribution.id });
    const result = await claude('post', { lane: lane.id, body: 'Lane result with calendar and expiry evidence' });
    const submitted = await claude('submit_task', { task: contribution.id, post: result.id });
    assert.equal(submitted.state, 'submitted', 'completed steps do not accept the lane contribution');
    const review = await lead('post', { lane: lane.id, reply_to: result.id, body: 'Integrated and accepted' });
    assert.equal((await lead('review_task', { task: contribution.id, post: review.id, action: 'accept' })).state, 'done');

    const lanes = await lead('read_lane', { lane: lane.id });
    assert.equal(lanes.tasks.length, 3, 'the optional idea stays a post, not a checklist obligation');
    assert.ok(lanes.posts.some(post => post.id === idea.id));
    assert.deepEqual(lanes.posts.filter(post => post.reply_to === ask.id).map(post => post.actor).sort(), ['claude-peer', 'codex-peer', 'lead']);
  });

  await t.test('R3.5 a scope correction reaches a working author at its next catch-up', async () => {
    const author = await as('author');
    const lane = await eric('create_lane', { project: project.id, name: 'PRD edit' });
    const work = await author('add_task', { lane: lane.id, title: 'Revise PRD and README' });
    await author('claim_task', { task: work.id });
    const cursor = (await author('read_changes')).cursor;
    const correction = await eric('post', { lane: lane.id, body: 'PRD only, no README edits' });
    const changes = await author('read_changes', { after: cursor });
    assert.deepEqual(changes.posts.map(post => [post.id, post.actor, post.body]), [[correction.id, 'Eric', 'PRD only, no README edits']]);
    await author('post', { lane: lane.id, reply_to: correction.id, body: 'Stopped README edits; none were made' });
  });

  await t.test('R3.6 a standing check retains context across finite checks and a restart until Eric ends it', async () => {
    const lane = await eric('create_lane', { project: project.id, name: 'School admin' });
    const standing = await eric('add_task', { lane: lane.id, title: 'Weekly school-admin check' });
    const first = await as('checker-1');
    await first('claim_task', { task: standing.id });
    const open = await first('post', { lane: lane.id, body: 'Check 1: field-trip form needs Eric, due 2026-12-01' });

    await runtime.restart(); // closes every client session; participants reconnect
    eric = await as('Eric');
    const second = await as('checker-1');
    const prior = await second('read_lane', { lane: lane.id });
    assert.equal(prior.posts.find(post => post.id === open.id).body, 'Check 1: field-trip form needs Eric, due 2026-12-01');
    const handled = await eric('post', { lane: lane.id, reply_to: open.id, body: 'Signed and returned the form' });
    await second('post', { lane: lane.id, reply_to: handled.id, body: 'Check 2: no change; field-trip form already handled' });
    assert.equal((await second('read_lane', { lane: lane.id })).tasks[0].state, 'working', 'finishing a check does not complete the responsibility');

    const end = await eric('post', { lane: lane.id, body: 'End the weekly check; school year over' });
    assert.equal((await eric('close_task', { task: standing.id, post: end.id })).state, 'closed');
    await assert.rejects(second('claim_task', { task: standing.id }), /already claimed or finished/);
    assert.equal((await eric('read_lane', { lane: lane.id })).posts.length, 4, 'history remains after the standing work ends');
  });

  await t.test('R3.1/R4.1/R4.3 a question needing Eric stays visible, blocks closeout and clears once answered', async () => {
    const worker = await as('worker');
    const lane = await eric('create_lane', { project: project.id, name: 'Generator purchase' });
    const plan = await worker('create_plan', { lane: lane.id, title: 'Buy generator', body: 'Choose and buy a generator', steps: [{ id: 'buy', title: 'Buy generator' }] });
    const [link] = (await eric('accept_plan', { plan: plan.id, revision: 1 })).links;
    const task = { id: link.task };
    await worker('claim_task', { task: task.id });
    const question = await worker('post', { lane: lane.id, body: 'Needs Eric: budget above $800? Blocks the purchase; resumes when Eric answers here.' });
    const blocked = await worker('block_task', { task: task.id, post: question.id });
    assert.equal(blocked.state, 'blocked');

    const morning = await eric('read_changes', { after: (await eric('read_changes')).cursor });
    assert.deepEqual(morning.waiting.map(row => [row.id, row.waiting_post, row.question.body]), [[task.id, question.id, question.body]],
      'a returning reader sees the blocked work and its question even when the question predates the cursor');
    await assert.rejects(eric('close_plan', { plan: plan.id, reason: 'Trying to close early' }), /unresolved|task/);
    await assert.rejects(worker('submit_task', { task: task.id, post: question.id }));

    const answer = await eric('post', { lane: lane.id, reply_to: question.id, body: 'Yes, up to $1000' });
    const before = (await worker('read_changes')).cursor;
    const resumed = await worker('unblock_task', { task: task.id, post: answer.id });
    assert.ok((await worker('read_changes', { after: before })).tasks.some(row => row.id === task.id && row.state === 'working'), 'unblocking appears in catch-up');
    assert.equal(resumed.state, 'working');
    assert.equal(resumed.owner, 'worker');
    assert.deepEqual((await eric('read_changes')).waiting, [], 'an answered question no longer needs Eric');

    const unowned = await eric('add_task', { lane: lane.id, title: 'Find a fuel supplier' });
    const ask = await eric('post', { lane: lane.id, body: 'Waiting on the town bylaw answer before anyone starts' });
    await eric('block_task', { task: unowned.id, post: ask.id });
    await assert.rejects(worker('claim_task', { task: unowned.id }), /already claimed or finished/);
    const reply = await eric('post', { lane: lane.id, reply_to: ask.id, body: 'Bylaw allows storage' });
    assert.equal((await eric('unblock_task', { task: unowned.id, post: reply.id })).state, 'open', 'unowned work resumes open');
    await eric('block_task', { task: unowned.id, post: ask.id });
    const setAside = await eric('post', { lane: lane.id, body: 'Set aside: supplier not needed' });
    const closed = await eric('close_task', { task: unowned.id, post: setAside.id });
    assert.equal(closed.state, 'closed');
    assert.equal(closed.waiting_post, null, 'blocked work can be closed with a reason');
  });

  await t.test('R4.3 a quiet bounded wait reports no change without returning discussion', async () => {
    const watcher = await as('watcher');
    const { cursor } = await watcher('read_changes');
    const quiet = await watcher('wait_changes', { after: cursor, timeout: 1 });
    assert.equal(quiet.timed_out, true);
    assert.deepEqual(quiet.events, []);
    assert.deepEqual(quiet.posts, []);
  });
});
