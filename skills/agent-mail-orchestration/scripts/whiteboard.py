#!/usr/bin/env python3
"""Shared same-host SQLite whiteboards and checklist (Python standard library)."""

import argparse
import json
from pathlib import Path
import sqlite3
import sys
import time


CHECKLIST_SCHEMA = """
CREATE TABLE IF NOT EXISTS checklist (
    id INTEGER PRIMARY KEY, board TEXT NOT NULL REFERENCES boards(name),
    title TEXT NOT NULL CHECK(length(trim(title)) > 0),
    state TEXT NOT NULL DEFAULT 'open'
        CHECK(state IN ('open','working','submitted','done','closed')),
    owner TEXT, result_post INTEGER REFERENCES posts(id),
    review_post INTEGER REFERENCES posts(id),
    runtime TEXT, thread_id TEXT, host TEXT,
    archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1))
);
"""
SCHEMA = """
CREATE TABLE IF NOT EXISTS boards (name TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY, board TEXT NOT NULL REFERENCES boards(name),
    author TEXT NOT NULL, body TEXT NOT NULL CHECK(length(trim(body)) > 0),
    reply_to INTEGER REFERENCES posts(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
""" + CHECKLIST_SCHEMA + """
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY, board TEXT NOT NULL REFERENCES boards(name),
    actor TEXT NOT NULL, kind TEXT NOT NULL, entity_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
"""


def connect(path, *, create=False):
    if create:
        path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path if create else path.resolve().as_uri() + "?mode=rw",
                         uri=not create, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    return db


def initialize(db):
    db.execute("PRAGMA journal_mode=WAL")
    # Schema creation and the legacy checklist rebuild share one write transaction.
    # No other writer can commit between copying the rows and replacing the table.
    db.executescript("BEGIN IMMEDIATE;\n" + SCHEMA)
    if db.execute("PRAGMA user_version").fetchone()[0] == 0:
        db.execute("ALTER TABLE checklist RENAME TO checklist_legacy")
        db.execute(CHECKLIST_SCHEMA)
        db.execute("INSERT INTO checklist SELECT * FROM checklist_legacy")
        db.execute("DROP TABLE checklist_legacy")
        db.execute("PRAGMA user_version=1")


def rows(db, sql, args=()):
    return [dict(row) for row in db.execute(sql, args)]


def event(db, board, actor, kind, entity_id):
    db.execute("INSERT INTO events(board,actor,kind,entity_id) VALUES(?,?,?,?)",
               (board, actor, kind, entity_id))


def snapshot(db, board, after):
    db.execute("BEGIN")
    try:
        if not db.execute("SELECT 1 FROM boards WHERE name=?", (board,)).fetchone():
            raise ValueError("whiteboard does not exist")
        cursor = db.execute("SELECT coalesce(max(id),0) FROM events WHERE board=?",
                            (board,)).fetchone()[0]
        changes = rows(db, "SELECT * FROM events WHERE board=? AND id>? AND id<=? ORDER BY id",
                       (board, after, cursor))
        posts = rows(db, """SELECT * FROM posts WHERE board=? AND id IN
            (SELECT entity_id FROM events WHERE board=? AND kind='post' AND id>? AND id<=?)
            ORDER BY id""", (board, board, after, cursor))
        return {"board": board, "cursor": cursor, "events": changes, "posts": posts,
                "checklist": rows(db, "SELECT * FROM checklist WHERE board=? ORDER BY id", (board,))}
    finally:
        db.rollback()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, required=True,
                        help="absolute shared project database path; only init creates it")
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

    if not args.db.is_absolute():
        raise ValueError("--db must be an absolute shared project database path")

    if args.command == "init":
        with connect(args.db, create=True) as db:
            initialize(db)
        result = {"database": str(args.db.resolve())}
    else:
        with connect(args.db) as db:
            if args.command == "boards":
                result = rows(db, "SELECT name FROM boards ORDER BY name")
            elif args.command in ("show", "wait"):
                if args.after < 0:
                    raise ValueError("after must be nonnegative")
                if args.command == "wait" and not 0 <= args.timeout <= 60:
                    raise ValueError("wait timeout must be between 0 and 60 seconds")
                deadline = time.monotonic() + (args.timeout if args.command == "wait" else 0)
                while True:
                    result = snapshot(db, args.board, args.after)
                    if result["events"] or time.monotonic() >= deadline:
                        break
                    # Each poll opens a fresh read transaction, so another process's
                    # committed posts/checklist changes become visible to this waiter.
                    time.sleep(min(0.5, max(0, deadline - time.monotonic())))
                if args.command == "wait":
                    result["timed_out"] = not bool(result["events"])
            else:
                db.execute("BEGIN IMMEDIATE")
                if args.command == "board":
                    if not args.name.strip():
                        raise ValueError("whiteboard name must not be empty")
                    db.execute("INSERT INTO boards(name) VALUES(?)", (args.name,))
                    result = {"board": args.name}
                elif args.command == "post":
                    body = args.body_file.read_text() if args.body_file else args.body
                    if args.reply_to is not None:
                        parent = db.execute("SELECT board FROM posts WHERE id=?", (args.reply_to,)).fetchone()
                        if parent is None or parent["board"] != args.board:
                            raise ValueError("reply must reference a post on the same whiteboard")
                    post = db.execute("INSERT INTO posts(board,author,body,reply_to) VALUES(?,?,?,?)",
                                      (args.board, args.actor, body, args.reply_to)).lastrowid
                    event(db, args.board, args.actor, "post", post)
                    result = {"post": post}
                elif args.command == "add":
                    item = db.execute("INSERT INTO checklist(board,title) VALUES(?,?)",
                                      (args.board, args.title)).lastrowid
                    event(db, args.board, args.actor, "add", item)
                    result = {"item": item}
                else:
                    item = db.execute("SELECT * FROM checklist WHERE id=?", (args.item,)).fetchone()
                    if item is None:
                        raise ValueError("checklist item does not exist")
                    if item["archived"]:
                        raise ValueError("checklist item's task is archived")
                    if args.command in ("submit", "accept", "revise", "close"):
                        post = db.execute("SELECT board FROM posts WHERE id=?", (args.post,)).fetchone()
                        if post is None or post["board"] != item["board"]:
                            raise ValueError("result/review must reference a post on the item's whiteboard")
                    if args.command == "claim":
                        if item["state"] != "open":
                            raise ValueError("item is already claimed or finished")
                        db.execute("UPDATE checklist SET state='working',owner=? WHERE id=?",
                                   (args.actor, args.item))
                    elif args.command == "submit":
                        if item["state"] != "working" or item["owner"] != args.actor:
                            raise ValueError("only the working item's owner can submit it")
                        db.execute("UPDATE checklist SET state='submitted',result_post=? WHERE id=?",
                                   (args.post, args.item))
                    elif args.command in ("accept", "revise"):
                        if item["state"] != "submitted":
                            raise ValueError("review requires a submitted item")
                        state = "done" if args.command == "accept" else "working"
                        db.execute("UPDATE checklist SET state=?,review_post=? WHERE id=?",
                                   (state, args.post, args.item))
                    elif args.command == "close":
                        if item["state"] not in ("open", "working", "submitted"):
                            raise ValueError("close requires an unfinished item")
                        db.execute("UPDATE checklist SET state='closed',review_post=? WHERE id=?",
                                   (args.post, args.item))
                    elif args.command == "link":
                        if item["thread_id"] is not None:
                            raise ValueError("item already has a linked task")
                        db.execute("UPDATE checklist SET runtime=?,thread_id=?,host=? WHERE id=?",
                                   (args.runtime, args.thread, args.host, args.item))
                    elif args.command == "archived":
                        if item["state"] not in ("done", "closed") or item["thread_id"] is None:
                            raise ValueError("archive recording requires a done or closed item with a linked task")
                        db.execute("UPDATE checklist SET archived=1 WHERE id=?", (args.item,))
                    event(db, item["board"], args.actor, args.command, args.item)
                    result = dict(db.execute("SELECT * FROM checklist WHERE id=?", (args.item,)).fetchone())
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, sqlite3.Error) as error:
        print(f"whiteboard: {error}", file=sys.stderr)
        sys.exit(1)
