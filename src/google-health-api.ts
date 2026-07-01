interface GoogleHealthEnv {
  APP_ACCESS_KEY?: string;
  DB?: D1Database;
  GOOGLE_HEALTH_CLIENT_ID?: string;
  GOOGLE_HEALTH_CLIENT_SECRET?: string;
  GOOGLE_HEALTH_REDIRECT_URI?: string;
  GOOGLE_HEALTH_TOKEN_KEY?: string;
}

interface ConnectionRow {
  profile_id: string;
  encrypted_refresh_token: string;
  granted_scopes: string;
  connected_at: string;
  last_synced_at: string | null;
}

interface OAuthStateRow {
  profile_id: string;
  expires_at: string;
}

interface SummaryRow {
  profile_id: string;
  day: string;
  steps: number | null;
  active_zone_minutes: number | null;
  total_calories_kcal: number | null;
  sleep_minutes: number | null;
  resting_heart_rate_bpm: number | null;
  hrv_ms: number | null;
  updated_at: string;
}

interface DailySummary {
  profileId: string;
  day: string;
  steps: number | null;
  activeZoneMinutes: number | null;
  totalCaloriesKcal: number | null;
  sleepMinutes: number | null;
  restingHeartRateBpm: number | null;
  hrvMs: number | null;
  updatedAt: string;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface DateParts {
  year: number;
  month: number;
  day: number;
}

const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const HEALTH_API_URL = 'https://health.googleapis.com/v4/users/me';
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const SYNC_DAYS = 14;
const SCOPES = [
  'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
  'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
  'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
];

export const handleGoogleHealthRequest = async (
  request: Request,
  env: GoogleHealthEnv,
  pathname: string,
): Promise<Response> => {
  if (pathname === '/api/google-health/callback') {
    return handleCallback(request, env);
  }

  const configurationError = configuredError(env);
  if (configurationError) return json({ error: configurationError }, 503);
  if (request.headers.get('x-app-access-key') !== env.APP_ACCESS_KEY) {
    return json({ error: 'Unauthorized' }, 401);
  }

  if (pathname === '/api/google-health/status' && request.method === 'GET') {
    return getStatus(request, env);
  }
  if (pathname === '/api/google-health/connect' && request.method === 'POST') {
    return startConnection(request, env);
  }
  if (pathname === '/api/google-health/sync' && request.method === 'POST') {
    return syncConnection(request, env);
  }
  if (pathname === '/api/google-health/disconnect' && request.method === 'DELETE') {
    return disconnect(request, env);
  }
  return json({ error: 'Not found' }, 404);
};

const getStatus = async (request: Request, env: GoogleHealthEnv) => {
  const profileId = new URL(request.url).searchParams.get('profileId');
  if (!validProfileId(profileId)) return json({ error: 'A valid profileId is required' }, 400);

  const [connection, summaries] = await Promise.all([
    env.DB!.prepare(
      `SELECT profile_id, encrypted_refresh_token, granted_scopes, connected_at, last_synced_at
       FROM google_health_connections WHERE profile_id = ?`,
    ).bind(profileId).first<ConnectionRow>(),
    getSummaries(env.DB!, profileId),
  ]);

  return json({
    connected: Boolean(connection),
    connectedAt: connection?.connected_at ?? null,
    lastSyncedAt: connection?.last_synced_at ?? null,
    summaries,
  });
};

const startConnection = async (request: Request, env: GoogleHealthEnv) => {
  const input = await readObject(request);
  const profileId = typeof input?.profileId === 'string' ? input.profileId : null;
  if (!validProfileId(profileId)) return json({ error: 'A valid profileId is required' }, 400);

  const state = randomBase64Url(32);
  const stateHash = await sha256Hex(state);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OAUTH_STATE_TTL_MS).toISOString();

  await env.DB!.batch([
    env.DB!.prepare('DELETE FROM google_health_oauth_states WHERE expires_at <= ?').bind(now.toISOString()),
    env.DB!.prepare(
      `INSERT INTO google_health_oauth_states (state_hash, profile_id, expires_at)
       VALUES (?, ?, ?)`,
    ).bind(stateHash, profileId, expiresAt),
  ]);

  const params = new URLSearchParams({
    access_type: 'offline',
    client_id: env.GOOGLE_HEALTH_CLIENT_ID!,
    include_granted_scopes: 'true',
    prompt: 'consent select_account',
    redirect_uri: env.GOOGLE_HEALTH_REDIRECT_URI!,
    response_type: 'code',
    scope: SCOPES.join(' '),
    state,
  });
  return json({ authorizationUrl: `${GOOGLE_AUTHORIZE_URL}?${params}` });
};

const handleCallback = async (request: Request, env: GoogleHealthEnv) => {
  const configurationError = configuredError(env);
  if (configurationError) return callbackRedirect(request, env, 'error', configurationError);

  const url = new URL(request.url);
  const oauthError = url.searchParams.get('error');
  if (oauthError) return callbackRedirect(request, env, 'error', 'Google authorization was cancelled.');

  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  if (!state || !code) return callbackRedirect(request, env, 'error', 'Google returned an incomplete authorization response.');

  const stateHash = await sha256Hex(state);
  const stored = await env.DB!.prepare(
    'SELECT profile_id, expires_at FROM google_health_oauth_states WHERE state_hash = ?',
  ).bind(stateHash).first<OAuthStateRow>();
  await env.DB!.prepare('DELETE FROM google_health_oauth_states WHERE state_hash = ?').bind(stateHash).run();

  if (!stored || Date.parse(stored.expires_at) <= Date.now()) {
    return callbackRedirect(request, env, 'error', 'The connection request expired. Please try again.');
  }

  try {
    const token = await exchangeAuthorizationCode(code, env);
    if (!token.refresh_token) {
      return callbackRedirect(request, env, 'error', token.error_description || 'Google did not return a refresh token.');
    }

    const encryptedRefreshToken = await encryptToken(token.refresh_token, env.GOOGLE_HEALTH_TOKEN_KEY!);
    const connectedAt = new Date().toISOString();
    await env.DB!.prepare(
      `INSERT INTO google_health_connections
         (profile_id, encrypted_refresh_token, granted_scopes, connected_at, last_synced_at)
       VALUES (?, ?, ?, ?, NULL)
       ON CONFLICT(profile_id) DO UPDATE SET
         encrypted_refresh_token = excluded.encrypted_refresh_token,
         granted_scopes = excluded.granted_scopes,
         connected_at = excluded.connected_at`,
    ).bind(stored.profile_id, encryptedRefreshToken, token.scope ?? SCOPES.join(' '), connectedAt).run();

    return callbackRedirect(request, env, 'connected');
  } catch (error) {
    return callbackRedirect(
      request,
      env,
      'error',
      error instanceof Error ? error.message : 'Google Health authorization failed.',
    );
  }
};

const syncConnection = async (request: Request, env: GoogleHealthEnv) => {
  const input = await readObject(request);
  const profileId = typeof input?.profileId === 'string' ? input.profileId : null;
  const endDate = typeof input?.endDate === 'string' ? input.endDate : null;
  if (!validProfileId(profileId) || !validDay(endDate)) {
    return json({ error: 'A valid profileId and endDate are required' }, 400);
  }

  const connection = await env.DB!.prepare(
    `SELECT profile_id, encrypted_refresh_token, granted_scopes, connected_at, last_synced_at
     FROM google_health_connections WHERE profile_id = ?`,
  ).bind(profileId).first<ConnectionRow>();
  if (!connection) return json({ error: 'Google Health is not connected for this profile' }, 409);

  try {
    const refreshToken = await decryptToken(connection.encrypted_refresh_token, env.GOOGLE_HEALTH_TOKEN_KEY!);
    const accessToken = await refreshAccessToken(refreshToken, env);
    const summaries = await fetchHealthSummaries(accessToken, profileId, endDate);
    const syncedAt = new Date().toISOString();

    const startDate = addDays(endDate, -(SYNC_DAYS - 1));
    const statements = [env.DB!.prepare(
      'DELETE FROM google_health_daily_summaries WHERE profile_id = ? AND day >= ? AND day <= ?',
    ).bind(profileId, startDate, endDate), ...summaries.map((summary) => env.DB!.prepare(
      `INSERT INTO google_health_daily_summaries
         (profile_id, day, steps, active_zone_minutes, total_calories_kcal, sleep_minutes,
          resting_heart_rate_bpm, hrv_ms, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(profile_id, day) DO UPDATE SET
         steps = excluded.steps,
         active_zone_minutes = excluded.active_zone_minutes,
         total_calories_kcal = excluded.total_calories_kcal,
         sleep_minutes = excluded.sleep_minutes,
         resting_heart_rate_bpm = excluded.resting_heart_rate_bpm,
         hrv_ms = excluded.hrv_ms,
         updated_at = excluded.updated_at`,
    ).bind(
      profileId,
      summary.day,
      summary.steps,
      summary.activeZoneMinutes,
      summary.totalCaloriesKcal,
      summary.sleepMinutes,
      summary.restingHeartRateBpm,
      summary.hrvMs,
      syncedAt,
    ))];
    statements.push(
      env.DB!.prepare('UPDATE google_health_connections SET last_synced_at = ? WHERE profile_id = ?')
        .bind(syncedAt, profileId),
    );
    await env.DB!.batch(statements);

    return json({ connected: true, lastSyncedAt: syncedAt, summaries: await getSummaries(env.DB!, profileId) });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Google Health sync failed' }, 502);
  }
};

const disconnect = async (request: Request, env: GoogleHealthEnv) => {
  const input = await readObject(request);
  const profileId = typeof input?.profileId === 'string' ? input.profileId : null;
  if (!validProfileId(profileId)) return json({ error: 'A valid profileId is required' }, 400);

  await env.DB!.batch([
    env.DB!.prepare('DELETE FROM google_health_connections WHERE profile_id = ?').bind(profileId),
    env.DB!.prepare('DELETE FROM google_health_daily_summaries WHERE profile_id = ?').bind(profileId),
  ]);
  return json({ connected: false, connectedAt: null, lastSyncedAt: null, summaries: [] });
};

const fetchHealthSummaries = async (accessToken: string, profileId: string, endDate: string) => {
  const startDate = addDays(endDate, -(SYNC_DAYS - 1));
  const exclusiveEndDate = addDays(endDate, 1);
  const range = dailyRange(startDate, exclusiveEndDate);

  const [steps, activeZoneMinutes, calories, sleep, restingHeartRate, hrv] = await Promise.all([
    dailyRollup(accessToken, 'steps', range),
    dailyRollup(accessToken, 'active-zone-minutes', range),
    dailyRollup(accessToken, 'total-calories', range),
    reconciledDataPoints(accessToken, 'sleep',
      `sleep.interval.civil_end_time >= "${startDate}" AND sleep.interval.civil_end_time < "${exclusiveEndDate}"`, 25),
    reconciledDataPoints(accessToken, 'daily-resting-heart-rate', undefined, 30),
    reconciledDataPoints(accessToken, 'daily-heart-rate-variability', undefined, 30),
  ]);

  const byDay = new Map<string, DailySummary>();
  const rowFor = (day: string) => {
    let row = byDay.get(day);
    if (!row) {
      row = {
        profileId,
        day,
        steps: null,
        activeZoneMinutes: null,
        totalCaloriesKcal: null,
        sleepMinutes: null,
        restingHeartRateBpm: null,
        hrvMs: null,
        updatedAt: '',
      };
      byDay.set(day, row);
    }
    return row;
  };

  rollupPoints(steps).forEach((point) => {
    const day = civilDay(point.civilStartTime);
    const value = numberValue(point.steps, 'countSum');
    if (day && value !== null) rowFor(day).steps = Math.round(value);
  });
  rollupPoints(activeZoneMinutes).forEach((point) => {
    const day = civilDay(point.civilStartTime);
    if (!day || !isObject(point.activeZoneMinutes)) return;
    const values = ['sumInCardioHeartZone', 'sumInPeakHeartZone', 'sumInFatBurnHeartZone']
      .map((field) => numberValue(point.activeZoneMinutes, field))
      .filter((value): value is number => value !== null);
    if (values.length) rowFor(day).activeZoneMinutes = Math.round(values.reduce((sum, value) => sum + value, 0));
  });
  rollupPoints(calories).forEach((point) => {
    const day = civilDay(point.civilStartTime);
    const value = numberValue(point.totalCalories, 'kcalSum');
    if (day && value !== null) rowFor(day).totalCaloriesKcal = Math.round(value);
  });

  dataPoints(sleep).forEach((point) => {
    if (!isObject(point.sleep)) return;
    const day = civilDay(isObject(point.sleep.interval) ? point.sleep.interval.civilEndTime : null);
    const minutes = numberValue(point.sleep.summary, 'minutesAsleep');
    const metadata = isObject(point.sleep.metadata) ? point.sleep.metadata : {};
    const isMain = metadata.main !== false && metadata.nap !== true;
    if (!day || minutes === null || !isMain) return;
    rowFor(day).sleepMinutes = Math.max(rowFor(day).sleepMinutes ?? 0, Math.round(minutes));
  });
  dataPoints(restingHeartRate).forEach((point) => {
    if (!isObject(point.dailyRestingHeartRate)) return;
    const day = dateObjectDay(point.dailyRestingHeartRate.date);
    const value = numberValue(point.dailyRestingHeartRate, 'beatsPerMinute');
    if (day && day >= startDate && day <= endDate && value !== null) rowFor(day).restingHeartRateBpm = Math.round(value);
  });
  dataPoints(hrv).forEach((point) => {
    if (!isObject(point.dailyHeartRateVariability)) return;
    const day = dateObjectDay(point.dailyHeartRateVariability.date);
    const value = numberValue(point.dailyHeartRateVariability, 'averageHeartRateVariabilityMilliseconds');
    if (day && day >= startDate && day <= endDate && value !== null) rowFor(day).hrvMs = Math.round(value * 10) / 10;
  });

  return [...byDay.values()]
    .filter((summary) => summary.day >= startDate && summary.day <= endDate)
    .sort((a, b) => b.day.localeCompare(a.day));
};

const dailyRollup = async (accessToken: string, dataType: string, range: unknown) => {
  const response = await fetch(`${HEALTH_API_URL}/dataTypes/${dataType}/dataPoints:dailyRollUp`, {
    method: 'POST',
    headers: healthHeaders(accessToken, true),
    body: JSON.stringify({
      range,
      windowSizeDays: 1,
      pageSize: SYNC_DAYS,
      dataSourceFamily: 'users/me/dataSourceFamilies/google-wearables',
    }),
  });
  return healthJson(response, dataType);
};

const reconciledDataPoints = async (
  accessToken: string,
  dataType: string,
  filter?: string,
  pageSize = 30,
) => {
  const params = new URLSearchParams({
    dataSourceFamily: 'users/me/dataSourceFamilies/google-wearables',
    pageSize: String(pageSize),
  });
  if (filter) params.set('filter', filter);
  const response = await fetch(
    `${HEALTH_API_URL}/dataTypes/${dataType}/dataPoints:reconcile?${params}`,
    { headers: healthHeaders(accessToken) },
  );
  return healthJson(response, dataType);
};

const refreshAccessToken = async (refreshToken: string, env: GoogleHealthEnv) => {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_HEALTH_CLIENT_ID!,
      client_secret: env.GOOGLE_HEALTH_CLIENT_SECRET!,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  const token = await response.json<TokenResponse>();
  if (!response.ok || !token.access_token) {
    throw new Error(token.error_description || 'Google authorization expired. Reconnect Google Health.');
  }
  return token.access_token;
};

const exchangeAuthorizationCode = async (code: string, env: GoogleHealthEnv) => {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_HEALTH_CLIENT_ID!,
      client_secret: env.GOOGLE_HEALTH_CLIENT_SECRET!,
      code,
      grant_type: 'authorization_code',
      redirect_uri: env.GOOGLE_HEALTH_REDIRECT_URI!,
    }),
  });
  const token = await response.json<TokenResponse>();
  if (!response.ok) {
    throw new Error(token.error_description || token.error || 'Google token exchange failed');
  }
  return token;
};

const getSummaries = async (db: D1Database, profileId: string) => {
  const result = await db.prepare(
    `SELECT profile_id, day, steps, active_zone_minutes, total_calories_kcal, sleep_minutes,
            resting_heart_rate_bpm, hrv_ms, updated_at
     FROM google_health_daily_summaries
     WHERE profile_id = ? ORDER BY day DESC LIMIT ?`,
  ).bind(profileId, SYNC_DAYS).all<SummaryRow>();
  return (result.results ?? []).map((row): DailySummary => ({
    profileId: row.profile_id,
    day: row.day,
    steps: row.steps,
    activeZoneMinutes: row.active_zone_minutes,
    totalCaloriesKcal: row.total_calories_kcal,
    sleepMinutes: row.sleep_minutes,
    restingHeartRateBpm: row.resting_heart_rate_bpm,
    hrvMs: row.hrv_ms,
    updatedAt: row.updated_at,
  }));
};

const configuredError = (env: GoogleHealthEnv) => {
  if (!env.APP_ACCESS_KEY) return 'Cloud sync requires APP_ACCESS_KEY';
  if (!env.DB) return 'D1 database binding DB is not configured';
  if (!env.GOOGLE_HEALTH_CLIENT_ID) return 'GOOGLE_HEALTH_CLIENT_ID is not configured';
  if (!env.GOOGLE_HEALTH_CLIENT_SECRET) return 'GOOGLE_HEALTH_CLIENT_SECRET is not configured';
  if (!env.GOOGLE_HEALTH_REDIRECT_URI) return 'GOOGLE_HEALTH_REDIRECT_URI is not configured';
  if (!env.GOOGLE_HEALTH_TOKEN_KEY) return 'GOOGLE_HEALTH_TOKEN_KEY is not configured';
  return null;
};

const encryptToken = async (token: string, encodedKey: string) => {
  const key = await encryptionKey(encodedKey, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token));
  return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
};

const decryptToken = async (value: string, encodedKey: string) => {
  const [ivText, cipherText] = value.split('.');
  if (!ivText || !cipherText) throw new Error('Stored Google Health credentials are invalid');
  const key = await encryptionKey(encodedKey, ['decrypt']);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(ivText) },
    key,
    base64ToBytes(cipherText),
  );
  return new TextDecoder().decode(decrypted);
};

const encryptionKey = async (encodedKey: string, usages: KeyUsage[]) => {
  const bytes = base64ToBytes(encodedKey.trim());
  if (bytes.byteLength !== 32) throw new Error('GOOGLE_HEALTH_TOKEN_KEY must be a base64-encoded 32-byte key');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, usages);
};

const callbackRedirect = (
  request: Request,
  env: GoogleHealthEnv,
  status: 'connected' | 'error',
  message?: string,
) => {
  const redirectUri = env.GOOGLE_HEALTH_REDIRECT_URI || request.url;
  const target = new URL('/', new URL(redirectUri).origin);
  target.searchParams.set('googleHealth', status);
  if (message) target.searchParams.set('message', message);
  return Response.redirect(target.toString(), 302);
};

const healthJson = async (response: Response, label: string): Promise<Record<string, unknown>> => {
  const body: Record<string, unknown> = await response.json<Record<string, unknown>>().catch(() => ({}));
  if (!response.ok) {
    const apiError = isObject(body.error) && typeof body.error.message === 'string' ? body.error.message : '';
    throw new Error(apiError || `Google Health could not read ${label}`);
  }
  return body;
};

const healthHeaders = (accessToken: string, jsonBody = false) => ({
  accept: 'application/json',
  authorization: `Bearer ${accessToken}`,
  ...(jsonBody ? { 'content-type': 'application/json' } : {}),
});

const readObject = async (request: Request): Promise<Record<string, unknown> | null> => {
  try {
    const input: unknown = await request.json();
    return isObject(input) ? input : null;
  } catch {
    return null;
  }
};

const dailyRange = (start: string, end: string) => ({
  start: civilDateTime(start),
  end: civilDateTime(end),
});

const civilDateTime = (day: string) => ({
  date: toDateParts(day),
  time: { hours: 0, minutes: 0, seconds: 0, nanos: 0 },
});

const toDateParts = (day: string): DateParts => {
  const [year, month, date] = day.split('-').map(Number);
  return { year, month, day: date };
};

const addDays = (day: string, amount: number) => {
  const { year, month, day: date } = toDateParts(day);
  const value = new Date(Date.UTC(year, month - 1, date + amount));
  return value.toISOString().slice(0, 10);
};

const validDay = (value: string | null): value is string => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parts = toDateParts(value);
  return addDays(value, 0) === value && parts.year >= 2000 && parts.year <= 2100;
};

const validProfileId = (value: string | null): value is string =>
  Boolean(value && value.length <= 128 && /^[a-zA-Z0-9_-]+$/.test(value));

const rollupPoints = (value: Record<string, unknown>) =>
  Array.isArray(value.rollupDataPoints)
    ? value.rollupDataPoints.filter(isObject)
    : [];

const dataPoints = (value: Record<string, unknown>) =>
  Array.isArray(value.dataPoints)
    ? value.dataPoints.filter(isObject)
    : [];

const civilDay = (value: unknown) => {
  if (!isObject(value)) return null;
  return dateObjectDay(value.date);
};

const dateObjectDay = (value: unknown) => {
  if (!isObject(value)) return null;
  const year = numberValue(value, 'year');
  const month = numberValue(value, 'month');
  const day = numberValue(value, 'day');
  if (year === null || month === null || day === null) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const numberValue = (value: unknown, field: string) => {
  if (!isObject(value)) return null;
  const candidate = value[field];
  if (typeof candidate !== 'number' && typeof candidate !== 'string') return null;
  const parsed = Number(candidate);
  return Number.isFinite(parsed) ? parsed : null;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const randomBase64Url = (length: number) =>
  bytesToBase64(crypto.getRandomValues(new Uint8Array(length)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

const sha256Hex = async (value: string) => {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
};

const base64ToBytes = (value: string) => {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
