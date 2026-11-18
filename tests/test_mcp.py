"""Integration proof through actual stdio subprocesses and SQLite files."""

import asyncio
from contextlib import AsyncExitStack
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

from mcp import Client
from mcp.client.stdio import StdioServerParameters


PROJECT = Path(__file__).resolve().parents[1]
CLI = PROJECT / 'scripts' / 'whiteboard.py'


class MCPTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.workspace = tempfile.TemporaryDirectory(dir=PROJECT / '.scratch')
        self.addCleanup(self.workspace.cleanup)
        self.root = Path(self.workspace.name)
        self.db = self.root / 'shared.sqlite3'
        self.cli('init')
        self.cli('board', 'project')
        self.cli('board', 'lane')

    def cli(self, *args):
        process = subprocess.run([sys.executable, str(CLI), '--db', str(self.db), *map(str, args)],
                                 capture_output=True, text=True, timeout=15)
        self.assertEqual(process.returncode, 0, process.stderr)
        return json.loads(process.stdout)

    async def client(self):
        return await self.stack.enter_async_context(Client(StdioServerParameters(
            command=sys.executable, args=['-m', 'agent_mail.server', '--db', str(self.db),
                                          '--project-root', str(self.root)], cwd=str(PROJECT))))

    async def call(self, client, tool_name, **args):
        result = await client.call_tool(tool_name, args)
        self.assertFalse(result.is_error, result)
        return result.structured_content

    async def test_shared_lifecycle_guards_and_reconnect(self):
        async with AsyncExitStack() as self.stack:
            self.a = await self.client()
            self.b = await self.client()
            tools = await self.a.list_tools()
            self.assertEqual({t.name for t in tools.tools}, {
                'project_context', 'list_streams', 'create_stream', 'read_stream', 'post', 'add_item',
                'claim_item', 'submit_item', 'review_item', 'close_item', 'link_task', 'record_archived',
                'read_changes', 'wait_changes'})
            context = await self.call(self.a, 'project_context')
            self.assertEqual(context['project_root'], str(self.root.resolve()))
            resources = await self.a.list_resources()
            self.assertEqual({str(r.uri) for r in resources.resources},
                             {f'agent-mail://guidance/{name}' for name in ('start', 'roles', 'continuity')})
            for name in ('start', 'roles', 'continuity'):
                body = await self.a.read_resource(f'agent-mail://guidance/{name}')
                self.assertTrue(body.contents[0].text.strip())
                self.assertEqual(body.contents[0].mime_type, 'text/markdown')
            original = self.cli('post', 'project', '--actor', 'lead', '--body', 'Please investigate.')['post']
            state = await self.call(self.a, 'read_stream', stream='project')
            self.assertEqual(state['posts'][0]['id'], original)
            reply = await self.call(self.b, 'post', stream='project', actor='worker',
                                    body='Evidence from the artifact.', reply_to=original)
            self.assertEqual(self.cli('show', 'project')['posts'][1]['reply_to'], original)
            item = (await self.call(self.a, 'add_item', stream='project', title='Investigate', actor='lead'))['item']
            claims = await asyncio.gather(*[c.call_tool('claim_item', {'item': item, 'actor': actor})
                                           for c, actor in ((self.a, 'one'), (self.b, 'two'))])
            self.assertEqual(sum(not result.is_error for result in claims), 1)
            winner = next(result.structured_content['owner'] for result in claims if not result.is_error)
            loser = next(result for result in claims if result.is_error)
            self.assertIn('already claimed', loser.content[0].text)
            await self.call(self.b, 'submit_item', item=item, actor=winner, post=reply['post'])
            review = (await self.call(self.a, 'post', stream='project', actor='lead', body='Revise.'))['post']
            await self.call(self.a, 'review_item', item=item, actor='lead', post=review, action='revise')
            await self.call(self.b, 'submit_item', item=item, actor=winner, post=reply['post'])
            await self.call(self.a, 'review_item', item=item, actor='lead', post=review, action='accept')
            await self.call(self.a, 'link_task', item=item, actor='lead', runtime='codex', thread='fixture')
            await self.call(self.a, 'record_archived', item=item, actor='lead')
            other = (await self.call(self.a, 'add_item', stream='project', title='Superseded', actor='lead'))['item']
            await self.call(self.a, 'close_item', item=other, actor='lead', post=review)
            cross = self.cli('post', 'lane', '--actor', 'peer', '--body', 'Different stream.')['post']
            before = self.cli('show', 'project')
            for name, args in (
                ('post', dict(stream='project', actor='bad', body='Wrong reference', reply_to=cross)),
                ('close_item', dict(item=other, actor='bad', post=cross)),
                ('submit_item', dict(item=item, actor='bad', post=review)),
            ):
                self.assertTrue((await self.a.call_tool(name, args)).is_error)
                self.assertEqual(self.cli('show', 'project'), before)
            replacement = await self.client()
            after = await self.call(replacement, 'read_stream', stream='project')
            self.assertEqual(after, before)
            self.assertEqual(after['checklist'][0]['state'], 'done')
            self.assertEqual(after['checklist'][1]['state'], 'closed')
            with sqlite3.connect(self.db) as db:
                self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
                self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])

    async def test_incremental_multistream_wait_is_nonblocking_on_same_session(self):
        async with AsyncExitStack() as self.stack:
            self.a = await self.client()
            self.b = await self.client()
            cursors = {name: self.cli('show', name)['cursor'] for name in ('project', 'lane')}
            quiet = await self.call(self.a, 'wait_changes', cursors=cursors, timeout=0.15)
            self.assertTrue(quiet['timed_out'])
            self.assertEqual(quiet['changes'], [])
            waiting = asyncio.create_task(self.a.call_tool('wait_changes', {'cursors': cursors, 'timeout': 3}))
            await asyncio.sleep(0.3)
            # Same client/server handles a second request while its wait is pending.
            context = await asyncio.wait_for(self.a.call_tool('project_context'), timeout=1)
            self.assertFalse(context.is_error)
            self.assertFalse(waiting.done())
            item = await self.call(self.b, 'add_item', stream='lane', title='Peer work', actor='peer')
            result = await waiting
            self.assertFalse(result.is_error, result)
            delta = result.structured_content
            self.assertFalse(delta['timed_out'])
            self.assertEqual([change['stream'] for change in delta['changes']], ['lane'])
            self.assertEqual(delta['changes'][0]['checklist'][0]['id'], item['item'])
            self.assertEqual(delta['changes'][0]['posts'], [])
            again = await self.call(self.b, 'read_changes', cursors=cursors)
            self.assertEqual(again['changes'], delta['changes'])
            caught_up = await self.call(self.a, 'read_changes', cursors=delta['cursors'])
            self.assertEqual(caught_up['changes'], [])
            # Empty new streams have no legacy events: returned via stream discovery at timeout.
            waiting = asyncio.create_task(self.a.call_tool('wait_changes', {'cursors': delta['cursors'], 'timeout': 0.7}))
            await asyncio.sleep(0.2)
            await self.call(self.b, 'create_stream', name='empty-new')
            discovered = (await waiting).structured_content
            self.assertTrue(discovered['timed_out'])
            self.assertIn('empty-new', discovered['streams'])
            self.assertEqual(discovered['changes'], [])
            for args in ({'cursors': cursors, 'timeout': -1}, {'cursors': cursors, 'timeout': 61},
                         {'cursors': {'project': -1}}, {'cursors': {'missing': 0}},
                         {'cursors': {'project': 99999}}, {'cursors': {}}):
                self.assertTrue((await self.a.call_tool('wait_changes', args)).is_error)

    async def test_raw_stdout_is_protocol_only_and_missing_db_is_not_created(self):
        async with AsyncExitStack() as self.stack:
            self.a = await self.client()
            self.b = await self.client()
            args = [sys.executable, '-m', 'agent_mail.server', '--db', str(self.db), '--project-root', str(self.root)]
            requests = [
                {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {
                    'protocolVersion': '2025-11-25', 'capabilities': {},
                    'clientInfo': {'name': 'protocol-proof', 'version': '1'}}},
                {'jsonrpc': '2.0', 'method': 'notifications/initialized'},
                {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list'},
            ]
            process = await asyncio.create_subprocess_exec(*args, cwd=PROJECT,
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
            messages = []
            try:
                process.stdin.write((json.dumps(requests[0])+'\n').encode())
                await process.stdin.drain()
                messages.append(json.loads(await asyncio.wait_for(process.stdout.readline(), 10)))
                process.stdin.write((''.join(json.dumps(r)+'\n' for r in requests[1:])).encode())
                await process.stdin.drain()
                messages.append(json.loads(await asyncio.wait_for(process.stdout.readline(), 10)))
                process.stdin.close()
                stdout, stderr = await asyncio.wait_for(process.communicate(), 10)
                messages.extend(json.loads(line) for line in stdout.splitlines())
                self.assertEqual(process.returncode, 0, stderr.decode())
            finally:
                if process.returncode is None:
                    process.kill()
                    await process.wait()
            self.assertTrue(all(m['jsonrpc'] == '2.0' for m in messages))
            self.assertEqual({m['id'] for m in messages if 'id' in m}, {1, 2})
            missing = self.root / 'missing.sqlite3'
            args[args.index(str(self.db))] = str(missing)
            result = await asyncio.to_thread(subprocess.run, args, cwd=PROJECT, text=True,
                                            capture_output=True, input='', timeout=15)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(result.stdout, '')
            self.assertFalse(missing.exists())
            for flag, value in (('--db', self.db.name), ('--project-root', '.')):
                relative = args.copy()
                relative[relative.index('--db') + 1] = str(self.db)
                relative[relative.index(flag) + 1] = value
                result = await asyncio.to_thread(subprocess.run, relative, cwd=self.root,
                    text=True, capture_output=True, input='', timeout=15)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('must be absolute paths', result.stderr)
                self.assertEqual(result.stdout, '')
            self.assertFalse((self.root / '.scratch').exists())


if __name__ == '__main__':
    unittest.main()
