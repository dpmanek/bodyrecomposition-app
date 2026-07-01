import { handleSyncRequest } from '../../src/sync-api';

interface Env {
  APP_ACCESS_KEY?: string;
  DB?: D1Database;
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) =>
  handleSyncRequest(request, env);
