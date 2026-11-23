import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { call, connect, startRuntime } from './helpers.mjs';

// Real Wrangler/workerd HTTP boundary with independent MCP SDK clients.
test('HTTP/MCP transport boundary', { timeout: 240000 }, async t => {
  const runtime = await startRuntime();
  t.after(() => runtime.stop());
  const project = await runtime.call('create_project', { name: 'Transport proof', actor: 'test' });
  const lane = await runtime.call('create_lane', { project: project.id, name: 'boundary', actor: 'test' });

  await t.test('missing or wrong credentials are rejected before any tool runs', async () => {
    const before = await runtime.call('read_changes', { after: 0 });
    const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'post', arguments: { lane: lane.id, actor: 'intruder', body: 'should not land' } } };
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    const missing = await fetch(`${runtime.url}/mcp`, { method: 'POST', headers, body: JSON.stringify(request) });
    assert.equal(missing.status, 401);
    assert.equal(missing.headers.get('WWW-Authenticate'), 'Bearer');
    const wrong = await fetch(`${runtime.url}/mcp`, { method: 'POST', headers: { ...headers, Authorization: 'Bearer wrong' }, body: JSON.stringify(request) });
    assert.equal(wrong.status, 401);
    assert.equal((await fetch(`${runtime.url}/other`, { headers: { Authorization: `Bearer ${runtime.token}` } })).status, 404);
    await assert.rejects(connect(runtime.url, 'wrong', 'intruder'));
    assert.equal((await runtime.call('read_changes', { after: before.cursor })).cursor, before.cursor);
  });

  await t.test('tools and guidance resources are discoverable and readable', async () => {
    const client = await runtime.connect('discoverer');
    const tools = (await client.listTools()).tools;
    const names = tools.map(tool => tool.name);
    for (const name of ['list_projects', 'read_lane', 'add_task', 'claim_task', 'review_task', 'claim_orchestrator',
      'read_changes', 'wait_changes', 'list_plans', 'create_plan', 'accept_plan', 'close_plan', 'get_guidance']) assert.ok(names.includes(name), name);
    assert.deepEqual(tools.filter(tool => tool.annotations?.readOnlyHint === true).map(tool => tool.name).sort(),
      ['catch_up', 'get_guidance', 'get_plan', 'get_post', 'get_project_understanding', 'list_lanes', 'list_plans', 'list_projects', 'read_changes', 'read_lane', 'search_posts', 'suggest_related', 'wait_changes']);
    const uris = (await client.listResources()).resources.map(resource => resource.uri).sort();
    assert.deepEqual(uris, ['agent-mail://guidance/continuity', 'agent-mail://guidance/roles', 'agent-mail://guidance/start']);
    for (const uri of uris) {
      const [content] = (await client.readResource({ uri })).contents;
      assert.equal(content.mimeType, 'text/markdown');
      assert.match(content.text, /^# /);
      const topic = uri.split('/').at(-1);
      const guidance = await client.callTool({ name: 'get_guidance', arguments: { topic } });
      assert.deepEqual(guidance.content, [{ type: 'text', text: content.text }]);
      if (topic === 'start') {
        const defaultGuidance = await client.callTool({ name: 'get_guidance', arguments: {} });
        assert.deepEqual(defaultGuidance.content, guidance.content);
      }
    }
    const { cursor } = await runtime.call('read_changes');
    const unknown = await client.callTool({ name: 'get_guidance', arguments: { topic: 'unknown' } });
    assert.equal(unknown.isError, true);
    assert.equal((await runtime.call('read_changes', { after: cursor })).cursor, cursor);
  });

  await t.test('malformed input fails visibly without committing a change', async () => {
    const before = await runtime.call('read_changes', { after: 0 });
    const client = await runtime.connect('malformed');
    for (const args of [{ lane: 'one', title: 'x', actor: 'a' }, { lane: lane.id, title: '   ', actor: 'a' }, { lane: lane.id, actor: 'a' }]) {
      const outcome = await client.callTool({ name: 'add_task', arguments: args }).then(result => result.isError === true, () => true);
      assert.ok(outcome, JSON.stringify(args));
    }
    await assert.rejects(call(client, 'claim_task', { task: 999999, actor: 'a' }));
    assert.equal((await runtime.call('read_changes', { after: before.cursor })).cursor, before.cursor);
  });

  await t.test('independent clients race one claim; the loser sees the retained owner', async () => {
    const task = await runtime.call('add_task', { lane: lane.id, title: 'Contested', actor: 'test' });
    const [codex, claude] = await Promise.all([runtime.connect('codex'), runtime.connect('claude')]);
    const race = await Promise.allSettled([call(codex, 'claim_task', { task: task.id, actor: 'codex' }), call(claude, 'claim_task', { task: task.id, actor: 'claude' })]);
    assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
    const owner = race.find(result => result.status === 'fulfilled').value.owner;
    assert.match(race.find(result => result.status === 'rejected').reason.message, new RegExp(owner));
    for (const client of [codex, claude]) {
      assert.equal((await call(client, 'read_lane', { lane: lane.id })).tasks.find(row => row.id === task.id).owner, owner);
    }
  });

  await t.test('quiet waits time out without history; a peer change wakes a waiter', async () => {
    const { cursor } = await runtime.call('read_changes', { after: 0 });
    const quiet = await runtime.call('wait_changes', { after: cursor, timeout: 1 });
    assert.equal(quiet.timed_out, true);
    assert.equal(quiet.cursor, cursor);
    assert.equal(quiet.events.length, 0);
    const [waiter, writer] = await Promise.all([runtime.connect('waiter'), runtime.connect('writer')]);
    const started = Date.now();
    const pending = call(waiter, 'wait_changes', { after: cursor, timeout: 30 });
    await new Promise(resolve => setTimeout(resolve, 500));
    const post = await call(writer, 'post', { lane: lane.id, actor: 'writer', body: 'Wake the waiter' });
    const woke = await pending;
    assert.equal(woke.timed_out, false);
    assert.ok(Date.now() - started < 15000);
    assert.ok(woke.posts.some(row => row.id === post.id));
  });

  await t.test('records and cursor survive a runtime restart', async () => {
    const post = await runtime.call('post', { lane: lane.id, actor: 'test', body: 'Persist across restart' });
    const { cursor } = await runtime.call('read_changes', { after: 0 });
    await runtime.restart();
    const client = await runtime.connect('resumed');
    assert.equal((await call(client, 'read_changes', { after: 0 })).cursor, cursor);
    assert.ok((await call(client, 'read_lane', { lane: lane.id })).posts.some(row => row.id === post.id && row.body === 'Persist across restart'));
    assert.ok((await call(client, 'list_projects')).some(row => row.id === project.id));
  });
});

test('an unconfigured service credential fails closed and commits nothing', { timeout: 240000 }, async t => {
  const scratch = fileURLToPath(new URL('../../.scratch/cloudflare-tests/', import.meta.url));
  await mkdir(scratch, { recursive: true });
  const persistTo = await mkdtemp(path.join(scratch, 'unconfigured-'));
  t.after(() => rm(persistTo, { recursive: true, force: true }));
  const unconfigured = await startRuntime({ persistTo, token: '' });
  try {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: 'Bearer ' };
    for (const params of [{ method: 'tools/list' }, { method: 'tools/call', params: { name: 'create_project', arguments: { name: 'Should not exist', actor: 'intruder' } } }]) {
      const response = await fetch(`${unconfigured.url}/mcp`, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, ...params }) });
      assert.equal(response.status, 503);
    }
  } finally {
    await unconfigured.stop();
  }
  const configured = await startRuntime({ persistTo });
  try {
    assert.deepEqual(await configured.call('list_projects'), []);
    assert.equal((await configured.call('read_changes', { after: 0 })).cursor, 0);
  } finally {
    await configured.stop();
  }
});
