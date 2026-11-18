/** Shared plans; callbacks use the same SQLite storage and transaction. */
export interface PlanDependencies {
  storage: DurableObjectStorage;
  lane(id: number): { id: number };
  tasks(lane: number): { id: number; state: string }[];
  addTask(lane: number, title: string, actor: string): { id: number };
  event(lane: number, actor: string, kind: string, entityId: number): void;
}
type Args = Record<string, unknown>;
type Row = Record<string, SqlStorageValue>;
type Step = { id: string; title: string };
type Resolution = { step_id: string; task: number; action: 'keep' | 'replace' };
type Link = { step_id: string; title: string; task: number; lane: number };
function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be nonempty text`);
  return value;
}
function bodyText(value: unknown): string {
  if (typeof value !== 'string') throw new Error('body must be text');
  return value;
}
function integer(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error(`${name} must be a positive integer`);
  return value as number;
}
function steps(value: unknown): Step[] {
  if (!Array.isArray(value)) throw new Error('steps must be an array');
  const seen = new Set<string>();
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object') throw new Error('invalid step');
    const step = entry as Args;
    const id = text(step.id, 'step id');
    if (seen.has(id)) throw new Error('step ids must be unique');
    seen.add(id);
    return { id, title: text(step.title, 'step title') };
  });
}
export class PlanStore {
  private sql: SqlStorage;
  constructor(private deps: PlanDependencies) {
    this.sql = deps.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS plans (
      id INTEGER PRIMARY KEY, lane INTEGER NOT NULL, title TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'current' CHECK(state IN ('current','closed')),
      current_revision INTEGER NOT NULL DEFAULT 1, actor TEXT NOT NULL,
      closed_by TEXT, closure_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`);
    this.sql.exec("CREATE UNIQUE INDEX IF NOT EXISTS one_current_plan ON plans(lane) WHERE state='current'");
    this.sql.exec(`CREATE TABLE IF NOT EXISTS plan_revisions (
      plan INTEGER NOT NULL REFERENCES plans(id), revision INTEGER NOT NULL,
      body TEXT NOT NULL, steps TEXT NOT NULL, actor TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY(plan,revision))`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS plan_comments (
      id INTEGER PRIMARY KEY, plan INTEGER NOT NULL REFERENCES plans(id),
      revision INTEGER NOT NULL, actor TEXT NOT NULL, body TEXT NOT NULL,
      reply_to INTEGER REFERENCES plan_comments(id), start INTEGER, end INTEGER, quote TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      FOREIGN KEY(plan,revision) REFERENCES plan_revisions(plan,revision))`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS plan_acceptances (
      id INTEGER PRIMARY KEY, plan INTEGER NOT NULL, revision INTEGER NOT NULL,
      destination_lane INTEGER NOT NULL, actor TEXT NOT NULL, reconciliations TEXT NOT NULL,
      links TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(plan,revision), FOREIGN KEY(plan,revision) REFERENCES plan_revisions(plan,revision))`);
  }
  private rows(query: string, ...bindings: SqlStorageValue[]): Row[] {
    return this.sql.exec<Row>(query, ...bindings).toArray();
  }
  private id(): number { return Number(this.rows('SELECT last_insert_rowid() AS id')[0].id); }
  private plan(id: number): Row {
    const plan = this.rows('SELECT * FROM plans WHERE id=?', id)[0];
    if (!plan) throw new Error('plan does not exist');
    return plan;
  }
  private current(id: number): Row {
    const plan = this.plan(id);
    if (plan.state !== 'current') throw new Error('plan is closed');
    return plan;
  }
  private revision(plan: number, revision: number): Row {
    const row = this.rows('SELECT * FROM plan_revisions WHERE plan=? AND revision=?', plan, revision)[0];
    if (!row) throw new Error('plan revision does not exist');
    return row;
  }
  private lastAcceptance(plan: number): Row | undefined {
    return this.rows('SELECT * FROM plan_acceptances WHERE plan=? ORDER BY revision DESC LIMIT 1', plan)[0];
  }
  private differences(plan: number, proposed: Step[]) {
    const prior = this.lastAcceptance(plan);
    if (!prior) return [];
    const next = new Map(proposed.map(step => [step.id, step.title]));
    return (JSON.parse(String(prior.links)) as Link[])
      .filter(link => next.get(link.step_id) !== link.title)
      .map(link => ({ step_id: link.step_id, task: link.task, previous_title: link.title,
        current_title: next.get(link.step_id) ?? null, lane: link.lane }));
  }
  /** Task views can include every historical source revision, including removed steps. */
  sources(task: number): Record<string, unknown>[] {
    return this.rows('SELECT * FROM plan_acceptances ORDER BY id').flatMap(acceptance =>
      (JSON.parse(String(acceptance.links)) as Link[]).filter(link => link.task === task)
        .map(link => ({ plan: acceptance.plan, revision: acceptance.revision,
          acceptance: acceptance.id, step_id: link.step_id, title: link.title })));
  }
  execute(operation: string, args: Args): unknown {
    if (!['create_plan', 'get_plan', 'list_plans', 'edit_plan', 'comment_plan', 'accept_plan', 'close_plan'].includes(operation)) return undefined;
    return this.deps.storage.transactionSync(() => this.run(operation, args));
  }
  private run(operation: string, args: Args): unknown {
    if (operation === 'list_plans') {
      const lane = integer(args.lane, 'lane'); this.deps.lane(lane);
      return this.rows('SELECT * FROM plans WHERE lane=? ORDER BY id', lane);
    }
    if (operation === 'create_plan') {
      const lane = integer(args.lane, 'lane'); this.deps.lane(lane);
      const actor = text(args.actor, 'actor'), title = text(args.title, 'title'), body = bodyText(args.body);
      const proposed = steps(args.steps);
      if (this.rows("SELECT id FROM plans WHERE lane=? AND state='current'", lane).length) throw new Error('lane already has a current plan');
      this.sql.exec('INSERT INTO plans(lane,title,actor) VALUES(?,?,?)', lane, title, actor);
      const id = this.id();
      this.sql.exec('INSERT INTO plan_revisions(plan,revision,body,steps,actor) VALUES(?,1,?,?,?)', id, body, JSON.stringify(proposed), actor);
      this.deps.event(lane, actor, 'create_plan', id);
      return this.view(id);
    }
    const id = integer(args.plan, 'plan');
    if (operation === 'get_plan') return this.view(id);
    const actor = text(args.actor, 'actor');
    // Committed acceptance is recoverable even after later edits/closure.
    if (operation === 'accept_plan') return this.accept(id, actor, args);
    const plan = this.current(id), lane = Number(plan.lane);
    if (operation === 'edit_plan') {
      const base = integer(args.base_revision, 'base_revision');
      if (base !== plan.current_revision) throw new Error(`revision conflict: current_revision=${plan.current_revision}`);
      const body = bodyText(args.body), proposed = steps(args.steps), revision = base + 1;
      this.sql.exec('INSERT INTO plan_revisions(plan,revision,body,steps,actor) VALUES(?,?,?,?,?)', id, revision, body, JSON.stringify(proposed), actor);
      this.sql.exec('UPDATE plans SET current_revision=? WHERE id=?', revision, id);
      this.deps.event(lane, actor, 'edit_plan', id);
      return this.view(id);
    }
    if (operation === 'comment_plan') {
      const revision = integer(args.revision, 'revision'), source = this.revision(id, revision), body = text(args.body, 'body');
      const reply = args.reply_to == null ? null : integer(args.reply_to, 'reply_to');
      if (reply !== null && !this.rows('SELECT id FROM plan_comments WHERE id=? AND plan=?', reply, id).length) throw new Error('reply must reference a comment on this plan');
      let start: number | null = null, end: number | null = null, quote: string | null = null;
      if (args.start !== undefined || args.end !== undefined) {
        if (!Number.isSafeInteger(args.start) || !Number.isSafeInteger(args.end)) throw new Error('span needs integer start and end');
        start = args.start as number; end = args.end as number;
        const original = String(source.body);
        if (start < 0 || end <= start || end > original.length) throw new Error('span is outside revision body');
        quote = original.slice(start, end);
      }
      this.sql.exec('INSERT INTO plan_comments(plan,revision,actor,body,reply_to,start,end,quote) VALUES(?,?,?,?,?,?,?,?)', id, revision, actor, body, reply, start, end, quote);
      const comment = this.id(); this.deps.event(lane, actor, 'comment_plan', id);
      return { comment, plan: id, revision, quote };
    }
    if (operation === 'close_plan') {
      const reason = text(args.reason, 'reason');
      const unresolved = this.deps.tasks(lane).filter(task => !['done', 'closed'].includes(task.state));
      if (unresolved.length) throw new Error(`lane has unresolved tasks: ${unresolved.map(task => task.id).join(',')}`);
      this.sql.exec("UPDATE plans SET state='closed',closed_by=?,closure_reason=? WHERE id=?", actor, reason, id);
      this.deps.event(lane, actor, 'close_plan', id);
      return this.view(id);
    }
    throw new Error('unknown plan operation');
  }
  private accept(id: number, actor: string, args: Args): unknown {
    const revision = integer(args.revision, 'revision'), plan = this.plan(id);
    const destination = args.destination_lane == null ? Number(plan.lane) : integer(args.destination_lane, 'destination_lane');
    const resolutions = this.resolutions(args.reconciliations), encoded = JSON.stringify(resolutions);
    const existing = this.rows('SELECT * FROM plan_acceptances WHERE plan=? AND revision=?', id, revision)[0];
    if (existing) {
      if (existing.destination_lane !== destination || existing.reconciliations !== encoded) throw new Error('revision was already accepted with different destination or reconciliation');
      return this.acceptanceView(existing);
    }
    this.current(id);
    if (revision !== plan.current_revision) throw new Error(`plan changed since review: current_revision=${plan.current_revision}`);
    this.deps.lane(destination);
    const source = this.revision(id, revision), proposed = JSON.parse(String(source.steps)) as Step[];
    const changes = this.differences(id, proposed);
    if (resolutions.length !== changes.length || changes.some(change => !resolutions.some(res => res.step_id === change.step_id && res.task === change.task))) throw new Error('changed or removed linked steps need explicit reconciliation');
    const prior = this.lastAcceptance(id);
    const oldLinks = new Map<string, Link>(prior ? (JSON.parse(String(prior.links)) as Link[]).map(link => [link.step_id, link]) : []);
    for (const res of resolutions) {
      const old = oldLinks.get(res.step_id)!;
      if (res.action === 'replace') {
        const task = this.deps.tasks(old.lane).find(task => task.id === old.task);
        if (!task || !['done', 'closed'].includes(task.state)) throw new Error('replacement requires the linked task already completed or explicitly closed');
      }
    }
    const links: Link[] = proposed.map(step => {
      const prior = oldLinks.get(step.id), res = resolutions.find(res => res.step_id === step.id);
      if (prior && res?.action !== 'replace') return { ...prior, title: step.title };
      const task = this.deps.addTask(destination, step.title, actor);
      return { step_id: step.id, title: step.title, task: task.id, lane: destination };
    });
    const [acceptance] = this.rows(`INSERT INTO plan_acceptances(plan,revision,destination_lane,actor,reconciliations,links)
      VALUES(?,?,?,?,?,?) RETURNING *`, id, revision, destination, actor, encoded, JSON.stringify(links));
    const sourceLane = Number(plan.lane);
    this.deps.event(sourceLane, actor, 'accept_plan', id);
    for (const linkedLane of new Set(links.map(link => link.lane))) {
      if (linkedLane !== sourceLane) this.deps.event(linkedLane, actor, 'plan_tasks', id);
    }
    return this.acceptanceView(acceptance);
  }
  private resolutions(value: unknown): Resolution[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new Error('reconciliations must be an array');
    const seen = new Set<string>();
    return value.map(entry => {
      if (!entry || typeof entry !== 'object') throw new Error('invalid reconciliation');
      const step_id = text(entry.step_id, 'step_id');
      if (seen.has(step_id)) throw new Error('duplicate reconciliation');
      seen.add(step_id);
      const task = integer(entry.task, 'task');
      if (!['keep', 'replace'].includes(entry.action)) throw new Error('reconciliation action must be keep or replace');
      return { step_id, task, action: entry.action };
    }).sort((a, b) => a.step_id.localeCompare(b.step_id));
  }
  private acceptanceView(row: Row): Record<string, unknown> {
    return { ...row, links: JSON.parse(String(row.links)), reconciliations: JSON.parse(String(row.reconciliations)) };
  }
  private view(id: number): Record<string, unknown> {
    const plan = this.plan(id), current = this.revision(id, Number(plan.current_revision));
    const revisions = this.rows('SELECT * FROM plan_revisions WHERE plan=? ORDER BY revision', id).map(row => ({ ...row, steps: JSON.parse(String(row.steps)) }));
    const comments = this.rows('SELECT * FROM plan_comments WHERE plan=? ORDER BY id', id).map(row => ({
      ...row, original_body: this.revision(id, Number(row.revision)).body,
      context_status: row.revision === plan.current_revision ? 'current' : row.quote === null ? 'revision_changed' :
        String(current.body).slice(Number(row.start), Number(row.end)) === row.quote ? 'unchanged_at_original_span' : 'original_span_changed',
    }));
    const acceptances = this.rows('SELECT * FROM plan_acceptances WHERE plan=? ORDER BY revision', id).map(row => this.acceptanceView(row));
    return { ...plan, revisions, comments, acceptances, reconciliation_needed: this.differences(id, JSON.parse(String(current.steps))) };
  }
}
