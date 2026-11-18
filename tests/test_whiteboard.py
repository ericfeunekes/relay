import json
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest


PROJECT = Path(__file__).resolve().parents[1]
SCRIPT = PROJECT / "scripts" / "whiteboard.py"


class SharedWhiteboardTest(unittest.TestCase):
    def setUp(self):
        scratch = PROJECT / ".scratch"
        scratch.mkdir(exist_ok=True)
        self.workspace = tempfile.TemporaryDirectory(dir=scratch)
        self.addCleanup(self.workspace.cleanup)
        self.db = Path(self.workspace.name) / "shared.sqlite3"
        self.base = [sys.executable, "-S", str(SCRIPT), "--db", str(self.db)]
        self.run_cli("init")
        self.run_cli("board", "prd")
        self.run_cli("board", "workflow")

    def run_cli(self, *args, success=True):
        result = subprocess.run(self.base + list(map(str, args)),
                                text=True, capture_output=True, timeout=15)
        if success:
            self.assertEqual(result.returncode, 0, result.stderr)
            return json.loads(result.stdout)
        self.assertNotEqual(result.returncode, 0)
        return result

    def test_independent_processes_share_posts_and_review_state(self):
        item = self.run_cli("add", "prd", "Define the shared outcome", "--actor", "lead")["item"]
        self.run_cli("claim", item, "--actor", "worker")
        post = self.run_cli("post", "prd", "--actor", "worker", "--body", "Proposed outcome.")["post"]
        self.run_cli("submit", item, "--actor", "worker", "--post", post)
        state = self.run_cli("show", "prd")
        self.assertEqual(state["checklist"][0]["state"], "submitted")
        self.assertEqual(state["posts"][0]["body"], "Proposed outcome.")
        review = self.run_cli("post", "prd", "--actor", "lead", "--reply-to", post,
                              "--body", "Clarify how a worker returns.")["post"]
        self.run_cli("revise", item, "--actor", "lead", "--post", review)
        self.assertEqual(self.run_cli("show", "prd")["checklist"][0]["state"], "working")
        revised = self.run_cli("post", "prd", "--actor", "worker", "--reply-to", review,
                               "--body", "Revised with the return path.")["post"]
        self.run_cli("submit", item, "--actor", "worker", "--post", revised)
        accepted = self.run_cli("post", "prd", "--actor", "lead", "--body", "Integrated into PRD.")["post"]
        self.run_cli("accept", item, "--actor", "lead", "--post", accepted)
        self.run_cli("link", item, "--actor", "lead", "--runtime", "codex", "--thread", "fixture-thread")
        self.run_cli("archived", item, "--actor", "lead")
        final = self.run_cli("show", "prd")["checklist"][0]
        self.assertEqual((final["state"], final["archived"], final["result_post"]), ("done", 1, revised))

    def test_two_processes_cannot_claim_the_same_item(self):
        item = self.run_cli("add", "prd", "One owner", "--actor", "lead")["item"]
        processes = [subprocess.Popen(self.base + ["claim", str(item), "--actor", actor],
                                      text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                     for actor in ("first", "second")]
        results = [(p.communicate(timeout=15), p.returncode) for p in processes]
        self.assertEqual(sorted(code for _, code in results), [0, 1])
        state = self.run_cli("show", "prd")
        self.assertIn(state["checklist"][0]["owner"], ("first", "second"))
        self.assertEqual([e["kind"] for e in state["events"]], ["add", "claim"])

    def test_wait_observes_another_process_and_reads_do_not_consume(self):
        waiting = subprocess.Popen(self.base + ["wait", "prd", "--after", "0", "--timeout", "5"],
                                   text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.addCleanup(lambda: waiting.poll() is None and waiting.kill())
        time.sleep(0.15)
        self.assertIsNone(waiting.poll())
        self.run_cli("post", "prd", "--actor", "worker", "--body", "Wake the waiting reader.")
        stdout, stderr = waiting.communicate(timeout=10)
        self.assertEqual(waiting.returncode, 0, stderr)
        result = json.loads(stdout)
        self.assertFalse(result["timed_out"])
        self.assertEqual(result["posts"][0]["body"], "Wake the waiting reader.")
        self.assertEqual(self.run_cli("show", "prd"), self.run_cli("show", "prd"))
        self.assertEqual(self.run_cli("show", "prd", "--after", result["cursor"])["events"], [])

    def test_concurrent_discussion_preserves_both_contributions(self):
        processes = [subprocess.Popen(
            self.base + ["post", "prd", "--actor", actor, "--body", body],
            text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            for actor, body in (("first", "Use one board."), ("second", "Use two boards."))]
        for process in processes:
            _, stderr = process.communicate(timeout=15)
            self.assertEqual(process.returncode, 0, stderr)
        posts = self.run_cli("show", "prd")["posts"]
        self.assertEqual({(p["author"], p["body"]) for p in posts},
                         {("first", "Use one board."), ("second", "Use two boards.")})

    def test_other_board_does_not_satisfy_wait_and_invalid_links_rollback(self):
        other = self.run_cli("post", "workflow", "--actor", "worker", "--body", "Another board.")["post"]
        result = self.run_cli("wait", "prd", "--after", "0", "--timeout", "0.1")
        self.assertTrue(result["timed_out"])
        self.run_cli("post", "prd", "--actor", "worker", "--reply-to", other,
                     "--body", "Wrong board.", success=False)
        item = self.run_cli("add", "prd", "A result", "--actor", "lead")["item"]
        self.run_cli("claim", item, "--actor", "worker")
        before = self.run_cli("show", "prd")
        self.run_cli("submit", item, "--actor", "worker", "--post", other, success=False)
        self.assertEqual(self.run_cli("show", "prd"), before)
        self.run_cli("accept", item, "--actor", "lead", "--post", other, success=False)


    def test_close_preserves_work_without_claiming_integration(self):
        for source in ("open", "working", "submitted"):
            with self.subTest(source=source):
                item = self.run_cli("add", "prd", "Superseded approach", "--actor", "lead")["item"]
                self.run_cli("link", item, "--actor", "lead", "--runtime", "codex",
                             "--thread", "retired-" + source)
                result = None
                if source != "open":
                    self.run_cli("claim", item, "--actor", "worker")
                if source == "submitted":
                    result = self.run_cli("post", "prd", "--actor", "worker",
                                          "--body", "Earlier result remains evidence.")["post"]
                    self.run_cli("submit", item, "--actor", "worker", "--post", result)
                reason = self.run_cli("post", "prd", "--actor", "lead",
                                      "--body", "Superseded by the agreed approach.")["post"]
                closed = self.run_cli("close", item, "--actor", "lead", "--post", reason)
                self.assertEqual((closed["state"], closed["review_post"], closed["result_post"]),
                                 ("closed", reason, result))
                self.assertEqual(closed["owner"], None if source == "open" else "worker")
                archived = self.run_cli("archived", item, "--actor", "lead")
                self.assertEqual((archived["state"], archived["archived"], archived["thread_id"]),
                                 ("closed", 1, "retired-" + source))
                visible = self.run_cli("show", "prd")
                self.assertIn(reason, [post["id"] for post in visible["posts"]])
                if result is not None:
                    self.assertIn(result, [post["id"] for post in visible["posts"]])
                self.assertIn(("close", item), [(e["kind"], e["entity_id"]) for e in visible["events"]])

    def test_invalid_transitions_and_links_leave_the_record_unchanged(self):
        item = self.run_cli("add", "prd", "Guarded work", "--actor", "lead")["item"]
        post = self.run_cli("post", "prd", "--actor", "worker", "--body", "Result.")["post"]
        other = self.run_cli("post", "workflow", "--actor", "lead", "--body", "Wrong board.")["post"]

        def rejected(*args):
            before = self.run_cli("show", "prd")
            self.run_cli(*args, success=False)
            self.assertEqual(self.run_cli("show", "prd"), before)

        for state in ("open", "working"):
            if state == "working":
                self.run_cli("claim", item, "--actor", "worker")
            for command in ("accept", "revise"):
                rejected(command, item, "--actor", "lead", "--post", post)
            rejected("archived", item, "--actor", "lead")
        rejected("submit", item, "--actor", "another-worker", "--post", post)
        rejected("close", item, "--actor", "lead", "--post", other)
        rejected("close", item, "--actor", "lead", "--post", 99999)
        self.run_cli("link", item, "--actor", "lead", "--runtime", "codex", "--thread", "first-task")
        rejected("link", item, "--actor", "lead", "--runtime", "claude", "--thread", "replacement")
        self.run_cli("submit", item, "--actor", "worker", "--post", post)
        rejected("archived", item, "--actor", "lead")
        self.run_cli("accept", item, "--actor", "lead", "--post", post)
        rejected("close", item, "--actor", "lead", "--post", post)
        self.run_cli("archived", item, "--actor", "lead")
        for command in ("claim", "submit", "accept", "revise", "close", "link", "archived"):
            args = [command, item, "--actor", "worker"]
            if command in ("submit", "accept", "revise", "close"):
                args += ["--post", post]
            if command == "link":
                args += ["--runtime", "codex", "--thread", "another-task"]
            rejected(*args)

    def test_closed_item_requires_a_task_link_for_archive_and_is_terminal(self):
        item = self.run_cli("add", "prd", "Abandoned before launch", "--actor", "lead")["item"]
        reason = self.run_cli("post", "prd", "--actor", "lead", "--body", "No longer needed.")["post"]
        self.run_cli("close", item, "--actor", "lead", "--post", reason)
        before = self.run_cli("show", "prd")
        for command in ("claim", "submit", "accept", "revise", "close", "archived"):
            args = [command, item, "--actor", "worker"]
            if command in ("submit", "accept", "revise", "close"):
                args += ["--post", reason]
            self.run_cli(*args, success=False)
            self.assertEqual(self.run_cli("show", "prd"), before)

    def test_absolute_script_uses_its_checkout_from_another_working_directory(self):
        checkout = Path(self.workspace.name) / "separate-checkout"
        scripts = checkout / "scripts"
        scripts.mkdir(parents=True)
        script = scripts / "whiteboard.py"
        shutil.copyfile(SCRIPT, script)
        shutil.copytree(PROJECT / "agent_mail", checkout / "agent_mail",
                        ignore=shutil.ignore_patterns("__pycache__"))
        caller = Path(self.workspace.name) / "caller"
        caller.mkdir()
        base = [sys.executable, "-S", str(script)]
        for args in (("init",), ("board", "isolated"),
                     ("post", "isolated", "--actor", "worker", "--body", "Shared checkout.")):
            result = subprocess.run(base + list(args), cwd=caller,
                                    text=True, capture_output=True, timeout=15)
            self.assertEqual(result.returncode, 0, result.stderr)
        result = subprocess.run(base + ["show", "isolated"], cwd=caller,
                                text=True, capture_output=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["posts"][0]["body"], "Shared checkout.")
        self.assertTrue((checkout / ".scratch" / "collaboration.sqlite3").is_file())
        self.assertFalse((caller / ".scratch").exists())

    def test_init_upgrades_legacy_database_without_losing_records(self):
        # The original four-state schema, with linked discussion and nontrivial IDs.
        self.db = Path(self.workspace.name) / "legacy.sqlite3"
        self.base = [sys.executable, "-S", str(SCRIPT), "--db", str(self.db)]
        with sqlite3.connect(self.db) as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""
                CREATE TABLE boards (name TEXT PRIMARY KEY);
                CREATE TABLE posts (
                    id INTEGER PRIMARY KEY, board TEXT NOT NULL REFERENCES boards(name),
                    author TEXT NOT NULL, body TEXT NOT NULL CHECK(length(trim(body)) > 0),
                    reply_to INTEGER REFERENCES posts(id),
                    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                );
                CREATE TABLE checklist (
                    id INTEGER PRIMARY KEY, board TEXT NOT NULL REFERENCES boards(name),
                    title TEXT NOT NULL CHECK(length(trim(title)) > 0),
                    state TEXT NOT NULL DEFAULT 'open'
                        CHECK(state IN ('open','working','submitted','done')),
                    owner TEXT, result_post INTEGER REFERENCES posts(id),
                    review_post INTEGER REFERENCES posts(id),
                    runtime TEXT, thread_id TEXT, host TEXT,
                    archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1))
                );
                CREATE TABLE events (
                    id INTEGER PRIMARY KEY, board TEXT NOT NULL REFERENCES boards(name),
                    actor TEXT NOT NULL, kind TEXT NOT NULL, entity_id INTEGER NOT NULL,
                    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                );
                INSERT INTO boards VALUES ('prd'), ('workflow');
                INSERT INTO posts VALUES (11,'prd','worker','Original result.',NULL,'2026-11-01T12:00:00Z');
                INSERT INTO posts VALUES (12,'prd','lead','Accepted.',11,'2026-11-01T13:00:00Z');
                INSERT INTO checklist VALUES (7,'prd','Accepted work','done','worker',11,12,
                    'codex','archived-task','local',1);
                INSERT INTO checklist VALUES (9,'prd','Pending work','submitted','other',11,NULL,
                    'claude','pending-task','local',0);
                INSERT INTO events VALUES (21,'prd','worker','post',11,'2026-11-01T12:00:00Z');
                INSERT INTO events VALUES (22,'prd','lead','post',12,'2026-11-01T13:00:00Z');
                INSERT INTO events VALUES (25,'prd','lead','link_correction',7,'2026-11-01T13:30:00Z');
            """)
        before = self.run_cli("show", "prd")
        processes = [subprocess.Popen(self.base + args, text=True,
                                      stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                     for args in (["init"], ["post", "workflow", "--actor", "peer",
                                            "--body", "Posted during migration."])]
        for process in processes:
            _, stderr = process.communicate(timeout=15)
            self.assertEqual(process.returncode, 0, stderr)
        self.assertEqual(self.run_cli("show", "prd"), before)
        self.assertEqual(self.run_cli("show", "workflow")["posts"][0]["body"],
                         "Posted during migration.")
        self.run_cli("init")
        self.assertEqual(self.run_cli("show", "prd"), before)
        reason = self.run_cli("post", "prd", "--actor", "lead", "--reply-to", 11,
                              "--body", "Superseded.")["post"]
        self.assertGreater(reason, 12)
        self.run_cli("close", 9, "--actor", "lead", "--post", reason)
        self.run_cli("archived", 9, "--actor", "lead")
        after = self.run_cli("show", "prd")
        self.assertEqual(after["checklist"][0], before["checklist"][0])
        self.assertEqual(after["checklist"][1]["result_post"], 11)
        self.assertEqual(after["events"][:3], before["events"])
        self.assertGreater(after["events"][-1]["id"], 25)
        self.assertEqual(self.run_cli("boards"), [{"name": "prd"}, {"name": "workflow"}])
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])
            self.assertEqual(db.execute("PRAGMA integrity_check").fetchone()[0], "ok")


    def test_failed_migration_rolls_back_without_changing_records_or_schema(self):
        # Controlled fault: an older database containing an invalid foreign key.
        # init must fail and retain the original data and schema for correction.
        with sqlite3.connect(self.db) as db:
            db.execute("PRAGMA user_version=0")
            db.execute("INSERT INTO checklist(id,board,title,result_post) VALUES(41,'prd','Orphan',999)")
            schema = db.execute("SELECT sql FROM sqlite_master WHERE name='checklist'").fetchone()[0]
        before = self.run_cli("show", "prd")
        failed = self.run_cli("init", success=False)
        self.assertIn("FOREIGN KEY constraint failed", failed.stderr)
        self.assertEqual(self.run_cli("show", "prd"), before)
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0], 0)
            self.assertEqual(db.execute("SELECT sql FROM sqlite_master WHERE name='checklist'").fetchone()[0],
                             schema)
            self.assertIsNone(db.execute("SELECT name FROM sqlite_master WHERE name='checklist_legacy'").fetchone())

    def test_reading_missing_database_does_not_create_a_private_copy(self):
        self.db = Path(self.workspace.name) / "missing.sqlite3"
        self.base = [sys.executable, "-S", str(SCRIPT), "--db", str(self.db)]
        self.run_cli("show", "prd", success=False)
        self.assertFalse(self.db.exists())


if __name__ == "__main__":
    unittest.main()
