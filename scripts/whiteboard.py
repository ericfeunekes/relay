#!/usr/bin/env python3
"""Local SQLite whiteboards and shared checklist for the dogfooding experiment."""

import argparse
import json
from pathlib import Path
import sqlite3
import sys


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = ROOT / ".scratch" / "collaboration.sqlite3"

# Keep the CLI usable without installing the MCP dependency.
sys.path.insert(0, str(ROOT))
from agent_mail.store import execute


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("init")
    commands.add_parser("boards")
    p = commands.add_parser("board")
    p.add_argument("name")
    for name in ("show", "wait"):
        p = commands.add_parser(name)
        p.add_argument("board")
        p.add_argument("--after", type=int, default=0)
        if name == "wait":
            p.add_argument("--timeout", type=float, default=45)
    p = commands.add_parser("post")
    p.add_argument("board")
    p.add_argument("--actor", required=True)
    body = p.add_mutually_exclusive_group(required=True)
    body.add_argument("--body")
    body.add_argument("--body-file", type=Path)
    p.add_argument("--reply-to", type=int)
    p = commands.add_parser("add")
    p.add_argument("board")
    p.add_argument("title")
    p.add_argument("--actor", required=True)
    for name in ("claim", "submit", "accept", "revise", "close", "link", "archived"):
        p = commands.add_parser(name)
        p.add_argument("item", type=int)
        p.add_argument("--actor", required=True)
        if name in ("submit", "accept", "revise", "close"):
            p.add_argument("--post", type=int, required=True)
        if name == "link":
            p.add_argument("--runtime", choices=("codex", "claude"), required=True)
            p.add_argument("--thread", required=True)
            p.add_argument("--host", default="local")
    args = parser.parse_args()

    values = vars(args).copy()
    path = values.pop("db")
    command = values.pop("command")
    result = execute(path, command, **values)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, sqlite3.Error) as error:
        print(f"whiteboard: {error}", file=sys.stderr)
        sys.exit(1)
