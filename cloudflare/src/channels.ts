import type { Arguments } from './contracts';

type Row = Record<string, SqlStorageValue>;
const number = (value: unknown, label: string, minimum = 0): number => {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw new Error(`${label} must be an integer >= ${minimum}`);
  return value as number;
};
const text = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be nonempty text`);
  return value.trim();
};
const limit = (value: unknown) => Math.min(100, number(value ?? 50, 'limit', 1));
const reference = (id: SqlStorageValue) => `agent-mail://posts/${id}`;
const stop = new Set('the and for not was are but our out you use about after again also been before being could from have into just more other should that their them then there these they this through were what when where which while will with would your'.split(' '));
const words = (body: string) => new Set((body.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter(word => !stop.has(word)).map(word => word.replace(/(?:es|s)$/, '')));

/** Original posts and explicit reader acknowledgements share the service SQLite store. */
export class ChannelStore {
  constructor(private sql: SqlStorage) {
    sql.exec(`CREATE TABLE IF NOT EXISTS read_positions (
      lane INTEGER NOT NULL REFERENCES lanes(id), reader TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(lane,reader)
    )`);
    sql.exec(`CREATE TABLE IF NOT EXISTS task_post_sources (
      task INTEGER PRIMARY KEY REFERENCES tasks(id), post INTEGER NOT NULL REFERENCES posts(id)
    )`);
    sql.exec(`CREATE TABLE IF NOT EXISTS project_understanding (
      project INTEGER PRIMARY KEY REFERENCES projects(id), revision INTEGER NOT NULL,
      body TEXT NOT NULL, covered_through TEXT NOT NULL, actor TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )`);
    sql.exec('CREATE INDEX IF NOT EXISTS posts_lane_id ON posts(lane,id)');
    sql.exec('CREATE INDEX IF NOT EXISTS posts_reply_id ON posts(reply_to,id)');
  }
  private rows(query: string, ...args: SqlStorageValue[]): Row[] { return this.sql.exec<Row>(query, ...args).toArray(); }
  private lane(id: number): Row {
    const lane = this.rows('SELECT * FROM lanes WHERE id=?', id)[0];
    if (!lane) throw new Error('lane does not exist');
    return lane;
  }
  private post(id: number): Row {
    const post = this.rows('SELECT * FROM posts WHERE id=?', id)[0];
    if (!post) throw new Error('post does not exist');
    return post;
  }
  view(post: Row): Record<string, unknown> {
    const parent = post.reply_to === null ? null : this.post(Number(post.reply_to));
    return { ...post, reference: reference(post.id), parent: parent ? { ...parent, reference: reference(parent.id) } : null };
  }
  taskSource(task: number) {
    const source = this.rows('SELECT posts.* FROM posts JOIN task_post_sources ON posts.id=task_post_sources.post WHERE task=?', task)[0];
    return source ? { id: source.id, reference: reference(source.id) } : null;
  }
  addSource(task: number, source: unknown, lane: number) {
    if (source === undefined) return;
    const post = this.post(number(source, 'source_post', 1));
    if (this.lane(Number(post.lane)).project !== this.lane(lane).project) throw new Error('source post must belong to the task project');
    this.sql.exec('INSERT INTO task_post_sources(task,post) VALUES(?,?)', task, post.id);
  }
  private understanding(project: number): (Record<string, unknown> & { revision: number; covered_through: { lane: number; post: number }[] }) | null {
    const row = this.rows('SELECT * FROM project_understanding WHERE project=?', project)[0];
    return row ? { ...row, revision: Number(row.revision), covered_through: JSON.parse(String(row.covered_through)) as { lane: number; post: number }[] } : null;
  }
  understandingHint(lane: number) {
    const project = Number(this.lane(lane).project);
    const document = this.understanding(project);
    return document ? { project, revision: document.revision,
      through_post: document.covered_through.find(entry => entry.lane === lane)?.post ?? null } : null;
  }
  page(args: Arguments, latestCursor: number) {
    const lane = number(args.lane, 'lane', 1); this.lane(lane);
    const count = limit(args.limit);
    if (args.before !== undefined && args.after !== undefined && args.after !== 0) throw new Error('before and after cannot be combined');
    const before = args.before === undefined ? null : number(args.before, 'before', 1);
    const after = args.after === undefined ? 0 : number(args.after, 'after');
    if (after > latestCursor) throw new Error('cursor is ahead of service');
    const forward = before === null && after > 0;
    let selected = forward
      ? this.rows(`SELECT posts.*,events.id AS event_cursor FROM posts JOIN events ON events.entity_id=posts.id AND events.kind='post'
          WHERE posts.lane=? AND events.id>? AND events.id<=? ORDER BY events.id LIMIT ?`, lane, after, latestCursor, count + 1)
      : this.rows('SELECT * FROM posts WHERE lane=? AND (? IS NULL OR id<?) ORDER BY id DESC LIMIT ?', lane, before, before, count + 1);
    const hasMore = selected.length > count;
    selected = selected.slice(0, count);
    const cursor = forward && hasMore ? Number(selected.at(-1)!.event_cursor) : latestCursor;
    if (!forward) selected.reverse();
    return { posts: selected.map(post => this.view(post)), has_more: hasMore,
      next_before: !forward && hasMore ? selected[0].id : null,
      next_after: forward && hasMore ? cursor : null, cursor,
      position: selected.at(-1)?.id ?? 0 };
  }
  private suggestions(project: number, body: string, kind: 'post' | 'channel') {
    const channels = kind === 'channel';
    const query = words(body);
    if (query.size < 1) return [];
    const candidates = channels
      ? this.rows('SELECT id,name AS body FROM lanes WHERE project=?', project)
      : this.rows('SELECT posts.* FROM posts JOIN lanes ON posts.lane=lanes.id WHERE lanes.project=? ORDER BY posts.id DESC LIMIT 500', project);
    return candidates.map(row => {
      const texts = [String(row.body)];
      if (channels) texts.push(...this.rows('SELECT body FROM posts WHERE lane=? ORDER BY id DESC LIMIT 20', row.id).map(post => String(post.body)));
      const scores = texts.map(candidate => {
        const tokens = words(candidate), common = [...query].filter(word => tokens.has(word));
        return { common, score: tokens.size ? common.length / Math.sqrt(query.size * tokens.size) : 0 };
      }).sort((a, b) => b.score - a.score);
      const nameTokens = words(String(row.body));
      return { row, ...scores[0], exact: channels && (String(row.body).toLowerCase() === body.toLowerCase()
        || (query.size === 1 && nameTokens.has([...query][0]))) };
    }).filter(match => match.exact || (match.common.length >= 2 && match.score >= 0.5))
      .sort((a, b) => b.score - a.score || Number(b.row.id) - Number(a.row.id)).slice(0, 3)
      .map(({ row, common }) => channels
        ? { lane: row.id, name: row.body, matching_terms: common, choices: ['reuse', 'consider merge', 'dismiss'] }
        : { post: this.view(row), matching_terms: common,
          links: [...new Set(String(row.body).match(/(?:https?:\/\/|(?:agent-mail|relay):\/\/)[^\s<>\)\]]+/g) ?? [])] });
  }
  execute(operation: string, args: Arguments): unknown {
    if (operation === 'get_project_understanding' || operation === 'save_project_understanding') {
      const project = number(args.project, 'project', 1);
      if (!this.rows('SELECT id FROM projects WHERE id=?', project).length) throw new Error('project does not exist');
      const current = this.understanding(project);
      if (operation === 'get_project_understanding') return current;
      const base = number(args.base_revision, 'base_revision');
      if (base !== Number(current?.revision ?? 0)) throw new Error(`revision conflict: current_revision=${current?.revision ?? 0}`);
      if (typeof args.body !== 'string') throw new Error('body must be text');
      if (!Array.isArray(args.covered_through)) throw new Error('covered_through must be an array');
      const seen = new Set<number>();
      const coverage = args.covered_through.map(value => {
        if (!value || typeof value !== 'object') throw new Error('invalid coverage entry');
        const entry = value as Arguments;
        const lane = number(entry.lane, 'lane', 1), post = number(entry.post, 'post', 1);
        if (this.lane(lane).project !== project) throw new Error('covered lane must belong to the project');
        if (this.post(post).lane !== lane) throw new Error('coverage post must belong to its lane');
        if (seen.has(lane)) throw new Error('covered lanes must be unique');
        seen.add(lane);
        return { lane, post };
      });
      this.sql.exec(`INSERT INTO project_understanding(project,revision,body,covered_through,actor) VALUES(?,?,?,?,?)
        ON CONFLICT(project) DO UPDATE SET revision=excluded.revision,body=excluded.body,
        covered_through=excluded.covered_through,actor=excluded.actor,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
        project, base + 1, args.body, JSON.stringify(coverage), text(args.actor, 'actor'));
      return this.understanding(project);
    }
    if (operation === 'get_post') {
      const post = this.post(number(args.post, 'post', 1));
      const lane = this.lane(Number(post.lane));
      return { ...this.view(post), project: lane.project, lane_name: lane.name,
        context: { lane: post.lane, before: Number(post.id) + 1 },
        replies: this.rows('SELECT * FROM posts WHERE reply_to=? ORDER BY id LIMIT 50', post.id).map(reply => this.view(reply)),
        replies_have_more: this.rows('SELECT id FROM posts WHERE reply_to=? ORDER BY id LIMIT 1 OFFSET 50', post.id).length > 0 };
    }
    if (operation === 'suggest_related') {
      const project = number(args.project, 'project', 1);
      if (!this.rows('SELECT id FROM projects WHERE id=?', project).length) throw new Error('project does not exist');
      if (args.kind !== 'post' && args.kind !== 'channel') throw new Error('kind must be post or channel');
      return { suggestions: this.suggestions(project, text(args.text, 'text'), args.kind) };
    }
    if (operation === 'search_posts') {
      const project = number(args.project, 'project', 1);
      if (!this.rows('SELECT id FROM projects WHERE id=?', project).length) throw new Error('project does not exist');
      const query = text(args.query, 'query').split(/\s+/);
      const before = args.before === undefined ? null : number(args.before, 'before', 1);
      const count = limit(args.limit);
      const found = this.rows(`SELECT posts.*,lanes.name AS lane_name FROM posts JOIN lanes ON posts.lane=lanes.id
        WHERE lanes.project=? AND NOT EXISTS (SELECT 1 FROM json_each(?) WHERE instr(lower(posts.body),lower(value))=0) AND (? IS NULL OR posts.id<?)
        ORDER BY posts.id DESC LIMIT ?`, project, JSON.stringify(query), before, before, count + 1);
      return { posts: found.slice(0, count).map(post => this.view(post)), has_more: found.length > count,
        next_before: found.length > count ? found[count - 1].id : null };
    }
    if (operation !== 'catch_up' && operation !== 'acknowledge_read') return undefined;
    const lane = number(args.lane, 'lane', 1); this.lane(lane);
    const reader = text(args.reader, 'reader');
    const position = Number(this.rows('SELECT position FROM read_positions WHERE lane=? AND reader=?', lane, reader)[0]?.position ?? 0);
    if (operation === 'catch_up') {
      const count = limit(args.limit);
      const after = args.after_post === undefined ? position : number(args.after_post, 'after_post');
      if (args.after_post !== undefined && after !== 0 && this.post(after).lane !== lane) throw new Error('after_post must belong to this lane');
      const selected = this.rows('SELECT * FROM posts WHERE lane=? AND id>? ORDER BY id LIMIT ?', lane, after, count + 1);
      const understanding = this.understandingHint(lane);
      return { ...(understanding ? { shared_understanding: understanding } : {}),
        lane, reader, saved_position: position, position: selected.slice(0, count).at(-1)?.id ?? after,
        posts: selected.slice(0, count).map(post => this.view(post)), has_more: selected.length > count };
    }
    const expected = number(args.expected_position, 'expected_position');
    const next = number(args.position, 'position');
    // Repeating a successfully applied acknowledgement is safe, including after a lost response.
    if (next === position && expected <= position) return { lane, reader, position };
    if (expected !== position) throw new Error('saved read position changed; catch up again');
    if (next < position) throw new Error('read position cannot move backwards');
    if (next !== 0 && !this.rows('SELECT id FROM posts WHERE id=? AND lane=?', next, lane).length) throw new Error('position must reference a post in this lane');
    this.sql.exec('INSERT INTO read_positions(lane,reader,position) VALUES(?,?,?) ON CONFLICT(lane,reader) DO UPDATE SET position=excluded.position', lane, reader, next);
    return { lane, reader, position: next };
  }
}
