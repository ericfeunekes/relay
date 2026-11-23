import test from 'node:test';
import assert from 'node:assert/strict';
import { startRuntime, call } from './helpers.mjs';

test('shared understanding and explicit channel catch-up over MCP', async t => {
  const runtime = await startRuntime();
  t.after(() => runtime.stop());
  const author = await runtime.connect('author');
  const reader = await runtime.connect('fresh-reader');
  const invoke = (name, args = {}) => call(author, name, args);
  const project = await invoke('create_project', { actor: 'author', name: 'Research' });
  const lane = await invoke('create_lane', { actor: 'author', project: project.id, name: 'Feature requests' });
  const otherLane = await invoke('create_lane', { actor: 'author', project: project.id, name: 'Related work' });
  assert.equal(await invoke('get_project_understanding', { project: project.id }), null);
  assert.equal((await invoke('read_lane', { lane: lane.id })).shared_understanding, undefined);
  const first = await invoke('post', { actor: 'author', lane: lane.id, body: 'Request a readable export.' });
  const covered = await invoke('post', { actor: 'peer', lane: lane.id, body: 'Keep dates in the export.', reply_to: first.id });
  const elsewhere = await invoke('post', { actor: 'peer', lane: otherLane.id, body: 'A separate discussion.' });
  const initial = { project: project.id, actor: 'author', base_revision: 0,
    body: '# Current understanding\nThe export needs to be readable.', covered_through: [{ lane: lane.id, post: covered.id }] };
  const note = await invoke('save_project_understanding', initial);
  assert.equal(note.revision, 1);
  assert.equal(note.body, initial.body);
  assert.equal(note.actor, 'author');
  assert.match(note.updated_at, /^\d{4}-\d\d-\d\dT/);
  assert.deepEqual(note.covered_through, initial.covered_through);
  const hint = { project: project.id, revision: 1, through_post: covered.id };
  assert.deepEqual((await call(reader, 'read_lane', { lane: lane.id })).shared_understanding, hint);
  assert.deepEqual((await invoke('read_lane', { lane: otherLane.id })).shared_understanding,
    { project: project.id, revision: 1, through_post: null });
  await call(reader, 'get_project_understanding', { project: project.id });
  const empty = await call(reader, 'catch_up', { lane: lane.id, reader: 'fresh', after_post: covered.id });
  assert.equal(empty.saved_position, 0);
  assert.equal(empty.position, covered.id);
  assert.deepEqual(empty.posts, []);
  assert.deepEqual(empty.shared_understanding, hint);
  assert.equal((await call(reader, 'catch_up', { lane: lane.id, reader: 'fresh' })).posts[0].id, first.id);
  await call(reader, 'acknowledge_read', { lane: lane.id, reader: 'fresh', expected_position: 0, position: empty.position });
  const late = await invoke('post', { actor: 'peer', lane: lane.id, body: 'Also preserve dates in late replies.', reply_to: first.id });
  const latest = await invoke('post', { actor: 'peer', lane: lane.id, body: 'Approval is still open.' });
  const page = await call(reader, 'catch_up', { lane: lane.id, reader: 'fresh', limit: 1 });
  assert.deepEqual(page.posts.map(post => post.id), [late.id]);
  assert.equal(page.posts[0].parent.id, first.id);
  assert.equal(page.has_more, true);
  assert.deepEqual(await call(reader, 'catch_up', { lane: lane.id, reader: 'fresh', limit: 1 }), page);
  await call(reader, 'acknowledge_read', { lane: lane.id, reader: 'fresh', expected_position: page.saved_position, position: page.position });
  assert.deepEqual((await call(reader, 'catch_up', { lane: lane.id, reader: 'fresh' })).posts.map(post => post.id), [latest.id]);

  // An older requested point stays visible even when the saved position and note are newer.
  const old = await call(reader, 'catch_up', { lane: lane.id, reader: 'fresh', after_post: 0, limit: 1 });
  assert.deepEqual(old.posts.map(post => post.id), [first.id]);
  assert.equal(old.saved_position, late.id);
  assert.deepEqual(old.shared_understanding, hint);
  assert.equal((await call(reader, 'catch_up', { lane: lane.id, reader: 'fresh' })).posts[0].id, latest.id);
  assert.equal((await call(reader, 'catch_up', { lane: lane.id, reader: 'independent' })).posts[0].id, first.id);
  await assert.rejects(call(reader, 'catch_up', { lane: lane.id, reader: 'fresh', after_post: elsewhere.id }), /this lane/);

  const amended = { ...initial, base_revision: 1, body: '# Current understanding\nThe readable export must preserve dates.' };
  const contenders = await Promise.allSettled([
    invoke('save_project_understanding', amended),
    call(reader, 'save_project_understanding', { ...amended, actor: 'peer', body: 'Another candidate.' }),
  ]);
  assert.equal(contenders.filter(result => result.status === 'fulfilled').length, 1);
  assert.match(contenders.find(result => result.status === 'rejected').reason.message, /revision conflict/);
  const winning = contenders.find(result => result.status === 'fulfilled').value;
  assert.deepEqual(await invoke('get_project_understanding', { project: project.id }), winning);
  await assert.rejects(invoke('save_project_understanding', { ...amended, base_revision: 2,
    covered_through: [{ lane: lane.id, post: elsewhere.id }] }), /its lane/);
  await assert.rejects(invoke('save_project_understanding', { ...amended, base_revision: 2,
    covered_through: [{ lane: lane.id, post: first.id }, { lane: lane.id, post: covered.id }] }), /unique/);
  const unrelated = await invoke('create_project', { actor: 'peer', name: 'Other project' });
  await assert.rejects(invoke('save_project_understanding', { ...initial, project: unrelated.id }), /project/);
  assert.equal(await invoke('get_project_understanding', { project: unrelated.id }), null);
  assert.equal((await invoke('get_project_understanding', { project: project.id })).revision, 2);
  const moved = await invoke('save_project_understanding', { ...amended, base_revision: 2,
    covered_through: [{ lane: lane.id, post: first.id }] });
  assert.equal(moved.covered_through[0].post, first.id);
  const removed = await invoke('save_project_understanding', { ...amended, base_revision: 3, covered_through: [] });
  assert.deepEqual(removed.covered_through, []);
  await runtime.restart();
  assert.deepEqual(await runtime.call('get_project_understanding', { project: project.id }), removed);
  assert.equal((await runtime.call('catch_up', { lane: lane.id, reader: 'fresh' })).posts[0].id, latest.id);
  assert.deepEqual((await runtime.call('read_lane', { lane: lane.id })).shared_understanding,
    { project: project.id, revision: 4, through_post: null });
});
