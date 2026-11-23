"""Local stdio adapter; shared-state changes never control agent runtimes."""

import argparse
import sqlite3
import asyncio
from functools import wraps
from importlib.resources import files
from pathlib import Path
from typing import Any, Callable, Literal

from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

from agent_mail import store


def call_store(function, *args, **kwargs):
    try:
        return function(*args, **kwargs)
    except (ValueError, sqlite3.Error) as error:
        raise ToolError(str(error)) from error


def create_server(
    db: Path, project_root: Path, *, primary: Literal["agent-mail", "relay"] = "relay"
) -> MCPServer:
    if not db.is_absolute() or not project_root.is_absolute():
        raise ValueError("database and project root must be absolute paths")
    db = db.resolve(strict=True)
    project_root = project_root.resolve(strict=True)
    if not project_root.is_dir():
        raise ValueError("project root must be a directory")
    # Opening validates the existing store; it never initializes a private database.
    if {"name": "project"} not in store.execute(db, "boards"):
        raise ValueError("database has no default project stream; create it explicitly with the CLI")
    is_relay = primary == "relay"
    server = MCPServer(
        name="relay" if is_relay else "Agent Mail",
        title="Relay" if is_relay else None,
        description="Local shared project context and checklists for agents." if is_relay else None,
        instructions=(
            f"Read {primary}://guidance/start before contributing. "
            "Local shared feed/checklist only; no runtime control or automatic continuation."
        ),
    )
    tools: list[Callable[..., Any]] = []

    def tool(fn: Callable[..., Any]) -> Callable[..., Any]:
        tools.append(fn)
        return fn

    @tool
    def project_context() -> dict[str, Any]:
        """Find the configured project, default stream and local iteration limits."""
        return {"project_root": str(project_root), "database": str(db), "default_stream": "project",
                "guidance": "agent-mail://guidance/start",
                "capabilities": ["streams", "feed", "checklist", "incremental_reads", "bounded_waits"],
                "limits": ["single configured project", "trusted actor labels", "no plan editing/comments/promotion",
                           "no persistent orchestrator claim", "no scheduling or agent runtime control"]}

    @tool
    def list_streams() -> list[dict[str, Any]]:
        """Discover all current streams, including newly created lanes."""
        return call_store(store.execute, db, "boards")

    @tool
    def create_stream(name: str) -> dict[str, Any]:
        """Create an optional named stream; announce its outcome in the default feed."""
        return call_store(store.execute, db, "board", name=name)

    @tool
    def read_stream(stream: str, after: int = 0) -> dict[str, Any]:
        """Read contextual posts since a cursor and the full current checklist."""
        return call_store(store.execute, db, "show", board=stream, after=after)

    @tool
    def post(stream: str, actor: str, body: str, reply_to: int | None = None) -> dict[str, Any]:
        """Append a finding, decision or contextual reply; posts confer no permissions."""
        return call_store(store.execute, db, "post", board=stream, actor=actor, body=body, body_file=None, reply_to=reply_to)

    @tool
    def add_item(stream: str, title: str, actor: str) -> dict[str, Any]:
        """Add actionable agreed-scope work, initially unclaimed. Put future ideas in the feed."""
        return call_store(store.execute, db, "add", board=stream, title=title, actor=actor)

    @tool
    def claim_item(item: int, actor: str) -> dict[str, Any]:
        """Claim open work; a competing claim fails without changing ownership."""
        return call_store(store.execute, db, "claim", item=item, actor=actor)

    @tool
    def submit_item(item: int, actor: str, post: int) -> dict[str, Any]:
        """Submit owned working work with a result post on the same stream."""
        return call_store(store.execute, db, "submit", item=item, actor=actor, post=post)

    @tool
    def review_item(item: int, actor: str, post: int, action: Literal['accept', 'revise']) -> dict[str, Any]:
        """Record review of submitted work: accept integration or request revision."""
        return call_store(store.execute, db, action, item=item, actor=actor, post=post)

    @tool
    def close_item(item: int, actor: str, post: int) -> dict[str, Any]:
        """Close unfinished work with a reason; this does not claim integration."""
        return call_store(store.execute, db, "close", item=item, actor=actor, post=post)

    @tool
    def link_task(item: int, actor: str, runtime: Literal['codex', 'claude'], thread: str, host: str = 'local') -> dict[str, Any]:
        """Record an actual task address; this does not launch or resume it."""
        return call_store(store.execute, db, "link", item=item, actor=actor, runtime=runtime, thread=thread, host=host)

    @tool
    def record_archived(item: int, actor: str) -> dict[str, Any]:
        """Record retirement after a real host action; never performs or verifies archival."""
        return call_store(store.execute, db, "archived", item=item, actor=actor)

    @tool
    def read_changes(cursors: dict[str, int]) -> dict[str, Any]:
        """Catch up on watched streams; returns changed rows and current stream names."""
        return call_store(store.changes, db, cursors)

    @tool
    async def wait_changes(cursors: dict[str, int], timeout: float = 30) -> dict[str, Any]:
        """Wait at most 60 seconds for committed changes; no model wake or future scheduling."""
        if not 0 <= timeout <= 60:
            raise ToolError("wait timeout must be between 0 and 60 seconds")
        deadline = asyncio.get_running_loop().time() + timeout
        while True:
            result = await asyncio.to_thread(call_store, store.changes, db, cursors)
            if result['changes'] or asyncio.get_running_loop().time() >= deadline:
                result['timed_out'] = not bool(result['changes'])
                return result
            await asyncio.sleep(min(0.1, max(0, deadline - asyncio.get_running_loop().time())))

    @wraps(project_context)
    def relay_project_context() -> dict[str, Any]:
        result = project_context()
        result["guidance"] = f"{primary}://guidance/start"
        return result

    def guidance(name: str) -> str:
        return files('agent_mail').joinpath('guidance', name + '.md').read_text(encoding='utf-8')

    def start() -> str:
        """Discover appropriate use, shared context and current capabilities."""
        return guidance('start')

    def roles() -> str:
        """Discover worker, coordinator and reviewer responsibilities."""
        return guidance('roles')

    def continuity() -> str:
        """Resume authorized work, handle waits and reconcile completion."""
        return guidance('continuity')

    def relay_resource(resource: Callable[[], str]) -> Callable[[], str]:
        def read() -> str:
            return resource().replace("Agent Mail", "Relay").replace("agent-mail://", "relay://")
        return read

    schemes = ("relay", "agent-mail") if is_relay else ("agent-mail", "relay")
    for scheme in schemes:
        relay_name = scheme == "relay"
        use_relay_links = relay_name and is_relay
        for fn in tools:
            name = fn.__name__
            handler = relay_project_context if relay_name and fn is project_context else fn
            description = fn.__doc__
            if is_relay and not relay_name:
                description = f"Compatibility alias for relay_{name}. {description}"
            server.add_tool(
                handler, name=f"relay_{name}" if relay_name else name,
                description=description, structured_output=True,
            )
        for resource in (start, roles, continuity):
            handler = relay_resource(resource) if use_relay_links else resource
            topic = resource.__name__
            server.resource(
                f"{scheme}://guidance/{topic}", name=f"relay_{topic}" if relay_name else topic,
                description=resource.__doc__, mime_type="text/markdown",
            )(handler)

    return server


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', type=Path, required=True)
    parser.add_argument('--project-root', type=Path, required=True)
    args = parser.parse_args()
    create_server(args.db, args.project_root).run(transport='stdio')


if __name__ == '__main__':
    main()
