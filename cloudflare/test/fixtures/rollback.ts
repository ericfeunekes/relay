/** Controlled SQL failure in tests only; ordinary requests use the shipped worker. */
import worker from '../../src/index';
import { ProjectStore as ProductionStore } from '../../src/store';
import type { Env } from '../../src/contracts';

export class ProjectStore extends ProductionStore {
  async rejectSecondTask(enabled: boolean): Promise<void> {
    this.ctx.storage.sql.exec('DROP TRIGGER IF EXISTS reject_second_plan_task');
    if (enabled) this.ctx.storage.sql.exec(`CREATE TRIGGER reject_second_plan_task
      BEFORE INSERT ON tasks WHEN NEW.title='FAIL SECOND'
      BEGIN SELECT RAISE(ABORT, 'controlled SQL task failure'); END`);
  }
}
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (new URL(request.url).pathname === '/__test__/sql-failure') {
      const store = env.STORE.get(env.STORE.idFromName('agent-mail')) as unknown as ProjectStore;
      await store.rejectSecondTask(request.method === 'POST');
      return new Response('SQL fault configured');
    }
    return worker.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
