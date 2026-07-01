interface SyncDatabase {
  prepare(query: string): SyncStatement;
  batch(statements: SyncStatement[]): Promise<unknown>;
}

interface SyncStatement {
  bind(...values: unknown[]): SyncStatement;
  all<T>(): Promise<{ results?: T[] }>;
}

interface SyncEnv {
  APP_ACCESS_KEY?: string;
  DB?: SyncDatabase;
}

interface StoredRecord {
  kind: string;
  id: string;
  payload: string | null;
  version: string;
  deleted: number;
}

interface IncomingRecord {
  kind: 'entry' | 'profile';
  id: string;
  value: unknown | null;
  version: string;
  deleted: boolean;
}

const MAX_RECORDS_PER_REQUEST = 500;

export const handleSyncRequest = async (request: Request, env: SyncEnv): Promise<Response> => {
  if (!env.APP_ACCESS_KEY) {
    return json({ error: 'Cloud sync requires APP_ACCESS_KEY' }, 503);
  }
  if (request.headers.get('x-app-access-key') !== env.APP_ACCESS_KEY) {
    return json({ error: 'Unauthorized' }, 401);
  }
  if (!env.DB) {
    return json({ error: 'D1 database binding DB is not configured' }, 503);
  }

  if (request.method === 'GET') {
    const result = await env.DB
      .prepare('SELECT kind, id, payload, version, deleted FROM sync_records ORDER BY version ASC')
      .all<StoredRecord>();
    const records = (result.results ?? []).flatMap(parseStoredRecord);
    return json({ records });
  }

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return json({ error: 'Request body must be valid JSON' }, 400);
  }

  const values = input && typeof input === 'object' && 'records' in input
    ? (input as { records: unknown }).records
    : null;
  if (!Array.isArray(values) || values.length > MAX_RECORDS_PER_REQUEST) {
    return json({ error: `records must be an array of at most ${MAX_RECORDS_PER_REQUEST} items` }, 400);
  }

  const records = values.map(validateRecord);
  if (records.some((record) => record === null)) {
    return json({ error: 'One or more sync records are invalid' }, 400);
  }
  if (!records.length) return json({ synced: 0 });

  const statements = (records as IncomingRecord[]).map((record) =>
    env.DB!.prepare(
      `INSERT INTO sync_records (kind, id, payload, version, deleted)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(kind, id) DO UPDATE SET
         payload = excluded.payload,
         version = excluded.version,
         deleted = excluded.deleted
       WHERE excluded.version > sync_records.version`,
    ).bind(
      record.kind,
      record.id,
      record.deleted ? null : JSON.stringify(record.value),
      record.version,
      record.deleted ? 1 : 0,
    ),
  );
  await env.DB.batch(statements);
  return json({ synced: statements.length });
};

const validateRecord = (value: unknown): IncomingRecord | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<IncomingRecord>;
  if (candidate.kind !== 'entry' && candidate.kind !== 'profile') return null;
  if (typeof candidate.id !== 'string' || !candidate.id || candidate.id.length > 128) return null;
  if (typeof candidate.version !== 'string' || Number.isNaN(Date.parse(candidate.version))) return null;
  if (typeof candidate.deleted !== 'boolean') return null;
  if (!candidate.deleted && (!candidate.value || typeof candidate.value !== 'object')) return null;
  return {
    kind: candidate.kind,
    id: candidate.id,
    value: candidate.deleted ? null : candidate.value,
    version: new Date(candidate.version).toISOString(),
    deleted: candidate.deleted,
  };
};

const parseStoredRecord = (record: StoredRecord): IncomingRecord[] => {
  try {
    return [{
      kind: record.kind as IncomingRecord['kind'],
      id: record.id,
      value: record.deleted ? null : JSON.parse(record.payload ?? 'null'),
      version: record.version,
      deleted: Boolean(record.deleted),
    }];
  } catch {
    return [];
  }
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
