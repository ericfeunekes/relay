import { DurableObject } from 'cloudflare:workers';
import { PlanStore } from './plans';
import { ChannelStore } from './channels';
import type { Arguments, Env } from './contracts';

type Row = Record<string, SqlStorageValue>;
const requiredText = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be nonempty text`);
  return value.trim();
};
const positive = (value: unknown, label: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new Error(`${label} must be a positive integer`);
  return value as number;
};
const taskRuntimeLink = (task: Row) => ({ runtime: task.runtime, thread_id: task.thread_id, host: task.host });

// Every task-changing operation; read_changes uses the same list so no task change escapes catch-up.
const TASK_OPERATIONS = ['claim_task','submit_task','review_task','close_task','block_task','unblock_task','link_task','relink_task','record_archived'];
const taskKinds = ['add_task', ...TASK_OPERATIONS];
const planKinds = ['create_plan','edit_plan','comment_plan','accept_plan','close_plan','plan_tasks'];

/** One service-wide SQL object makes cross-lane plan acceptance atomic. */
export class ProjectStore extends DurableObject<Env> {
  private sql: SqlStorage;
  private plans: PlanStore;
  private channels: ChannelStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.storage.transactionSync(() => {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, context TEXT,
        created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS lanes (
        id INTEGER PRIMARY KEY, project INTEGER NOT NULL REFERENCES projects(id), name TEXT NOT NULL,
        created_by TEXT NOT NULL, outcome_task INTEGER REFERENCES tasks(id), UNIQUE(project,name)
      )`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY, lane INTEGER NOT NULL REFERENCES lanes(id), actor TEXT NOT NULL,
        body TEXT NOT NULL, reply_to INTEGER REFERENCES posts(id),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY, lane INTEGER NOT NULL REFERENCES lanes(id), title TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','blocked','working','submitted','done','closed')),
        owner TEXT, result_post INTEGER REFERENCES posts(id), review_post INTEGER REFERENCES posts(id),
        waiting_post INTEGER REFERENCES posts(id),
        runtime TEXT, thread_id TEXT, host TEXT, archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
        created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS orchestration (
        lane INTEGER PRIMARY KEY REFERENCES lanes(id), actor TEXT NOT NULL,
        runtime TEXT NOT NULL, session TEXT NOT NULL
      )`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY, lane INTEGER REFERENCES lanes(id), actor TEXT NOT NULL,
        kind TEXT NOT NULL, entity_id INTEGER NOT NULL, detail TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )`);
    });
    this.channels = new ChannelStore(this.sql);
    this.plans = new PlanStore({
      storage: ctx.storage,
      lane: id => this.lane(id) as Row & { id: number },
      tasks: lane => this.rows('SELECT id,state FROM tasks WHERE lane=? ORDER BY id', lane) as { id: number; state: string }[],
      addTask: (lane, title, actor) => this.addTask(lane, title, actor),
      event: (lane, actor, kind, entity) => this.event(lane, actor, kind, entity),
    });
  }

  private rows(query: string, ...args: SqlStorageValue[]): Row[] {
    return this.sql.exec<Row>(query, ...args).toArray();
  }
  private inserted(): number { return Number(this.rows('SELECT last_insert_rowid() AS id')[0].id); }
  private lane(id: number): Row {
    const lane = this.rows('SELECT * FROM lanes WHERE id=?', id)[0];
    if (!lane) throw new Error('lane does not exist');
    return lane;
  }
  private project(id: number): Row {
    const project = this.rows('SELECT * FROM projects WHERE id=?', id)[0];
    if (!project) throw new Error('project does not exist');
    return project;
  }
  private event(lane: number | null, actor: string, kind: string, entity: number, detail: unknown = null): void {
    this.sql.exec('INSERT INTO events(lane,actor,kind,entity_id,detail) VALUES(?,?,?,?,?)', lane, actor, kind, entity, detail === null ? null : JSON.stringify(detail));
  }
  private appendPost(lane: number, actor: string, body: string, reply: number | null = null): Row & { id: number } {
    this.lane(lane);
    this.sql.exec('INSERT INTO posts(lane,actor,body,reply_to) VALUES(?,?,?,?)', lane, actor, requiredText(body, 'body'), reply);
    const id = this.inserted();
    this.event(lane, actor, 'post', id);
    return this.rows('SELECT * FROM posts WHERE id=?', id)[0] as Row & { id: number };
  }
  private addTask(lane: number, title: string, actor: string): { id: number } {
    this.lane(lane);
    this.sql.exec('INSERT INTO tasks(lane,title,created_by) VALUES(?,?,?)', lane, requiredText(title, 'title'), actor);
    const id = this.inserted();
    this.event(lane, actor, 'add_task', id);
    return { id };
  }
  private task(id: number): Row {
    const task = this.rows('SELECT * FROM tasks WHERE id=?', id)[0];
    if (!task) throw new Error('task does not exist');
    return task;
  }
  private taskView(task: Row): Record<string, unknown> {
    return { ...task, sources: this.plans.sources(Number(task.id)), source_post: this.channels.taskSource(Number(task.id)) };
  }
  private cursor(after: unknown): { after: number; cursor: number } {
    const position = after === undefined ? 0 : after;
    if (!Number.isSafeInteger(position) || (position as number) < 0) throw new Error('after must be a nonnegative integer');
    const cursor = Number(this.rows('SELECT coalesce(max(id),0) AS cursor FROM events')[0].cursor);
    if ((position as number) > cursor) throw new Error('cursor is ahead of service');
    return { after: position as number, cursor };
  }
  private readChanges(args: Arguments) {
    const { after, cursor } = this.cursor(args.after);
    const project = args.project === undefined ? null : positive(args.project, 'project');
    if (project !== null) this.project(project);
    let followedLanes: Row[] | undefined;
    if (args.lanes !== undefined) {
      if (!Array.isArray(args.lanes) || args.lanes.length === 0) throw new Error('lanes must list at least one lane');
      followedLanes = args.lanes.map(id => this.lane(positive(id, 'lane')));
      if (project !== null && followedLanes.some(lane => lane.project !== project)) {
        throw new Error('followed lanes must belong to the selected project');
      }
    }
    const projectsFollowed = project === null ? followedLanes?.map(lane => lane.project) : [project];
    const laneIds = followedLanes ? JSON.stringify(followedLanes.map(lane => lane.id)) : null;
    const projectIds = projectsFollowed ? JSON.stringify(projectsFollowed) : null;
    const events = this.rows(`SELECT events.* FROM events LEFT JOIN lanes ON lanes.id=events.lane
      WHERE events.id>? AND events.id<=? AND (
        ? IS NULL OR
        (events.kind='create_project' AND events.entity_id IN (SELECT value FROM json_each(?))) OR
        (lanes.project IN (SELECT value FROM json_each(?)) AND
         (? IS NULL OR events.kind='create_lane' OR events.lane IN (SELECT value FROM json_each(?))))
      ) ORDER BY events.id`, after, cursor, projectIds, projectIds, projectIds, laneIds, laneIds);
    const changedIds = (kinds: string[]) => [...new Set(events
      .filter(event => kinds.includes(String(event.kind))).map(event => event.entity_id))];
    const projects = this.rows('SELECT * FROM projects WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id', JSON.stringify(changedIds(['create_project'])));
    const lanes = this.rows('SELECT * FROM lanes WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id', JSON.stringify(changedIds(['create_lane'])));
    const posts = this.rows('SELECT * FROM posts WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id', JSON.stringify(changedIds(['post'])));
    const tasks = this.rows('SELECT * FROM tasks WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id', JSON.stringify(changedIds(taskKinds))).map(task => this.taskView(task));
    // Include pending questions even when their posts predate the cursor.
    const waiting = this.rows(`SELECT tasks.* FROM tasks JOIN lanes ON lanes.id=tasks.lane
      WHERE tasks.state='blocked' AND (? IS NULL OR lanes.project IN (SELECT value FROM json_each(?)))
      AND (? IS NULL OR tasks.lane IN (SELECT value FROM json_each(?))) ORDER BY tasks.id`,
      projectIds, projectIds, laneIds, laneIds).map(task => ({
      ...this.taskView(task), question: this.rows('SELECT * FROM posts WHERE id=?', task.waiting_post)[0],
    }));
    const plans = changedIds(planKinds).map(plan => this.plans.execute('get_plan', { plan }));
    const owners = events.filter(event => String(event.kind).endsWith('_orchestrator')).map(event => event.lane);
    const orchestration = this.rows('SELECT * FROM orchestration WHERE lane IN (SELECT value FROM json_each(?)) ORDER BY lane', JSON.stringify(owners));
    return { cursor, events, projects, lanes, posts, tasks, waiting, plans, orchestration };
  }
  async call(operation: string, args: Arguments): Promise<unknown> {
    // The plan module owns its own atomic operations using this same SQL store.
    const planResult = this.plans.execute(operation, args);
    if (planResult !== undefined) return planResult;
    return this.ctx.storage.transactionSync(() => this.run(operation, args));
  }
  private run(operation: string, args: Arguments): unknown {
    const channelResult = this.channels.execute(operation, args);
    if (channelResult !== undefined) return channelResult;
    if (operation === 'list_projects') return this.rows('SELECT * FROM projects ORDER BY id');
    if (operation === 'list_lanes') {
      const project = positive(args.project, 'project'); this.project(project);
      return this.rows('SELECT * FROM lanes WHERE project=? ORDER BY id', project);
    }
    if (operation === 'read_changes') return this.readChanges(args);
    if (operation === 'read_lane') {
      const lane = positive(args.lane, 'lane'); const details = this.lane(lane);
      const { after, cursor: latestCursor } = this.cursor(args.after);
      const count = Math.min(100, positive(args.limit ?? 50, 'limit'));
      const forward = after > 0 && args.before === undefined;
      const selectedEvents = args.before !== undefined ? [] : forward
        ? this.rows('SELECT * FROM events WHERE lane=? AND id>? ORDER BY id LIMIT ?', lane, after, count + 1)
        : this.rows('SELECT * FROM events WHERE lane=? ORDER BY id DESC LIMIT ?', lane, count).reverse();
      const hasMoreEvents = forward && selectedEvents.length > count;
      const cutoff = hasMoreEvents ? Number(selectedEvents[count - 1].id) : latestCursor;
      const page = this.channels.page(args, cutoff);
      const cursor = page.cursor;
      const understanding = this.channels.understandingHint(lane);
      return { ...(understanding ? { shared_understanding: understanding } : {}), ...details,
        events: selectedEvents.slice(0, count),
        ...page,
        has_more: page.has_more || hasMoreEvents,
        next_after: hasMoreEvents ? cursor : page.next_after,
        tasks: this.rows('SELECT * FROM tasks WHERE lane=? ORDER BY id', lane).map(task => this.taskView(task)),
        plans: this.plans.execute('list_plans', { lane }),
        orchestration: this.rows('SELECT * FROM orchestration WHERE lane=?', lane)[0] ?? null,
      };
    }
    const actor = requiredText(args.actor, 'actor');
    if (operation === 'create_project') {
      const name = requiredText(args.name, 'name');
      if (args.context !== undefined && typeof args.context !== 'string') throw new Error('context must be text');
      this.sql.exec('INSERT INTO projects(name,context,created_by) VALUES(?,?,?)', name, args.context as string ?? null, actor);
      const id = this.inserted(); this.event(null, actor, operation, id);
      return this.project(id);
    }
    if (operation === 'create_lane') {
      const project = positive(args.project, 'project'); this.project(project);
      const outcome = args.outcome_task === undefined ? null : positive(args.outcome_task, 'outcome_task');
      if (outcome !== null) this.task(outcome);
      this.sql.exec('INSERT INTO lanes(project,name,created_by,outcome_task) VALUES(?,?,?,?)', project, requiredText(args.name, 'name'), actor, outcome);
      const id = this.inserted(); this.event(id, actor, operation, id);
      return this.lane(id);
    }
    if (operation === 'post') {
      const lane = positive(args.lane, 'lane'); this.lane(lane);
      const reply = args.reply_to == null ? null : positive(args.reply_to, 'reply_to');
      if (reply !== null && !this.rows('SELECT id FROM posts WHERE id=? AND lane=?', reply, lane).length) throw new Error('reply must reference a post on the same lane');
      const post = this.appendPost(lane, actor, requiredText(args.body, 'body'), reply);
      return post;
    }
    if (operation === 'add_task') {
      const result = this.addTask(positive(args.lane, 'lane'), requiredText(args.title, 'title'), actor);
      this.channels.addSource(result.id, args.source_post, positive(args.lane, 'lane'));
      return this.taskView(this.task(result.id));
    }
    if (TASK_OPERATIONS.includes(operation)) {
      const id = positive(args.task, 'task'), task = this.task(id), lane = Number(task.lane);
      // Archival records a host action already taken; the task's record stays readable but frozen.
      if (task.archived) throw new Error("task's runtime task is archived");
      if (operation === 'link_task' || operation === 'relink_task') {
        if (operation === 'link_task' && task.thread_id !== null) throw new Error('task already has a linked runtime task');
        const runtime = requiredText(args.runtime, 'runtime'), thread = requiredText(args.thread, 'thread');
        const host = args.host === undefined ? 'local' : requiredText(args.host, 'host');
        if (operation === 'relink_task') {
          if (['done','closed'].includes(String(task.state))) throw new Error('runtime link replacement requires unfinished work');
          const expected = args.expected_previous as Arguments | undefined;
          if (task.thread_id === null || !expected || expected.runtime !== task.runtime ||
              expected.thread_id !== task.thread_id || expected.host !== task.host) {
            throw new Error('expected previous runtime link does not match the current link');
          }
          if (runtime === task.runtime && thread === task.thread_id && host === task.host) {
            throw new Error('replacement runtime link is unchanged');
          }
        }
        this.sql.exec('UPDATE tasks SET runtime=?,thread_id=?,host=? WHERE id=?', runtime, thread, host, id);
      } else if (operation === 'record_archived') {
        if (!['done','closed'].includes(String(task.state)) || task.thread_id === null) throw new Error('archive recording requires a done or closed task with a linked runtime task');
        this.sql.exec('UPDATE tasks SET archived=1 WHERE id=?', id);
      } else if (operation === 'claim_task') {
        if (task.state !== 'open') throw new Error(`task is already claimed or finished; owner=${task.owner}, state=${task.state}`);
        this.sql.exec("UPDATE tasks SET state='working',owner=? WHERE id=?", actor, id);
      } else {
        const post = positive(args.post, 'post');
        if (!this.rows('SELECT id FROM posts WHERE id=? AND lane=?', post, lane).length) throw new Error('result/review must reference a post on the task lane');
        if (operation === 'submit_task') {
          if (task.state !== 'working' || task.owner !== actor) throw new Error('only the working task owner can submit');
          this.sql.exec("UPDATE tasks SET state='submitted',result_post=? WHERE id=?", post, id);
        } else if (operation === 'review_task') {
          if (task.state !== 'submitted') throw new Error('review requires a submitted task');
          if (!['accept','revise'].includes(String(args.action))) throw new Error('review action must be accept or revise');
          this.sql.exec('UPDATE tasks SET state=?,review_post=? WHERE id=?', args.action === 'accept' ? 'done' : 'working', post, id);
        } else if (operation === 'block_task') {
          // The post states the question, what it blocks, who must answer and how work resumes.
          if (!['open','working'].includes(String(task.state))) throw new Error('only open or working tasks can be blocked');
          this.sql.exec("UPDATE tasks SET state='blocked',waiting_post=? WHERE id=?", post, id);
        } else if (operation === 'unblock_task') {
          if (task.state !== 'blocked') throw new Error('unblock requires a blocked task');
          // Ownership persists while blocked, so it determines the resumed state.
          this.sql.exec('UPDATE tasks SET state=?,waiting_post=NULL WHERE id=?', task.owner === null ? 'open' : 'working', id);
        } else {
          if (!['open','blocked','working','submitted'].includes(String(task.state))) throw new Error('close requires unfinished work');
          this.sql.exec("UPDATE tasks SET state='closed',waiting_post=NULL,review_post=? WHERE id=?", post, id);
        }
      }
      const next = this.task(id);
      const detail = operation === 'relink_task'
        ? { previous: taskRuntimeLink(task), current: taskRuntimeLink(next) }
        : { before: task, post: args.post ?? null, action: args.action ?? null };
      this.event(lane, actor, operation, id, detail);
      return this.taskView(next);
    }
    if (['claim_orchestrator','release_orchestrator','handoff_orchestrator','reassign_orchestrator'].includes(operation)) {
      const lane = positive(args.lane, 'lane'); this.lane(lane);
      const current = this.rows('SELECT * FROM orchestration WHERE lane=?', lane)[0] ?? null;
      const session = args.session === undefined ? null : requiredText(args.session, 'session');
      if (operation === 'claim_orchestrator') {
        const runtime = requiredText(args.runtime, 'runtime');
        if (session === null) throw new Error('session is required');
        if (current) {
          if (current.actor === actor && current.runtime === runtime && current.session === session) return current;
          throw new Error(`lane orchestration is owned by ${JSON.stringify(current)}`);
        }
        this.sql.exec('INSERT INTO orchestration(lane,actor,runtime,session) VALUES(?,?,?,?)', lane, actor, runtime, session);
      } else {
        if (operation !== 'reassign_orchestrator' && (!current || current.actor !== actor || current.session !== session)) throw new Error('only owning actor and session can release or hand off');
        if (operation === 'release_orchestrator') {
          this.sql.exec('DELETE FROM orchestration WHERE lane=?', lane);
        } else {
          const nextActor = requiredText(args.new_actor, 'new_actor'), runtime = requiredText(args.new_runtime, 'new_runtime'), nextSession = requiredText(args.new_session, 'new_session');
          requiredText(args.reason, 'reason');
          this.sql.exec('INSERT INTO orchestration(lane,actor,runtime,session) VALUES(?,?,?,?) ON CONFLICT(lane) DO UPDATE SET actor=excluded.actor,runtime=excluded.runtime,session=excluded.session', lane, nextActor, runtime, nextSession);
        }
      }
      const next = this.rows('SELECT * FROM orchestration WHERE lane=?', lane)[0] ?? null;
      this.event(lane, actor, operation, lane, { previous: current, current: next, reason: args.reason ?? null });
      return { lane, previous: current, current: next };
    }
    throw new Error(`unknown operation: ${operation}`);
  }
}
