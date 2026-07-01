import type { RecompEntry, UserProfile } from '../types';
import { validateImportedEntry, validateImportedProfile } from './validation';

export interface CloudRecord {
  kind: 'entry' | 'profile';
  id: string;
  value: RecompEntry | UserProfile | null;
  version: string;
  deleted: boolean;
}

interface SyncResult {
  entries: RecompEntry[];
  profiles: UserProfile[];
}

const QUEUE_KEY = 'recomptrack.syncQueue.v1';
const CHUNK_SIZE = 100;

export const entryCloudRecord = (entry: RecompEntry): CloudRecord => ({
  kind: 'entry',
  id: entry.id,
  value: entry,
  version: entry.updatedAt,
  deleted: false,
});

export const profileCloudRecord = (profile: UserProfile): CloudRecord => ({
  kind: 'profile',
  id: profile.id,
  value: profile,
  version: profile.updatedAt,
  deleted: false,
});

export const deletedCloudRecord = (
  kind: CloudRecord['kind'],
  id: string,
  version = new Date().toISOString(),
): CloudRecord => ({ kind, id, value: null, version, deleted: true });

export const queueCloudRecords = (records: CloudRecord[]) => {
  const merged = mergeRecords([...loadQueue(), ...records]);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(merged));
};

export const flushCloudQueue = async (accessKey: string) => {
  const records = loadQueue();
  if (!accessKey.trim() || !records.length) return 0;
  await sendRecords(accessKey, records);
  removeFromQueue(records);
  return records.length;
};

export const syncWithCloud = async (
  accessKey: string,
  localEntries: RecompEntry[],
  localProfiles: UserProfile[],
): Promise<SyncResult> => {
  const remote = await fetchRecords(accessKey);
  const remoteHasProfile = remote.some((record) => record.kind === 'profile' && !record.deleted);
  const profilesToUpload =
    remoteHasProfile && localEntries.length === 0 && localProfiles.length === 1 && isPristineDefault(localProfiles[0])
      ? []
      : localProfiles;
  const local = [
    ...localEntries.map(entryCloudRecord),
    ...profilesToUpload.map(profileCloudRecord),
  ];
  const queued = loadQueue();
  const merged = mergeRecords([...remote, ...local, ...queued]);
  const outgoing = mergeRecords([...local, ...queued]);

  if (outgoing.length) {
    await sendRecords(accessKey, outgoing);
    removeFromQueue(outgoing);
  }

  return recordsToState(merged);
};

const isPristineDefault = (profile: UserProfile) =>
  profile.name === 'Me' &&
  profile.sex === 'unspecified' &&
  !profile.ageYears &&
  !profile.height &&
  !profile.weight &&
  !profile.skeletalMusclePercent &&
  !profile.visceralFatLevel &&
  !profile.restingMetabolismKcal &&
  !profile.baselineNotes;

const fetchRecords = async (accessKey: string): Promise<CloudRecord[]> => {
  const response = await fetch('/api/sync', {
    headers: { 'x-app-access-key': accessKey.trim() },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(await syncError(response));
  const result = (await response.json()) as { records?: unknown };
  if (!Array.isArray(result.records)) throw new Error('Cloud sync returned an invalid response');
  return result.records.flatMap(normalizeCloudRecord);
};

const sendRecords = async (accessKey: string, records: CloudRecord[]) => {
  for (let index = 0; index < records.length; index += CHUNK_SIZE) {
    const response = await fetch('/api/sync', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-app-access-key': accessKey.trim(),
      },
      body: JSON.stringify({ records: records.slice(index, index + CHUNK_SIZE) }),
    });
    if (!response.ok) throw new Error(await syncError(response));
  }
};

const recordsToState = (records: CloudRecord[]): SyncResult => {
  const entries: RecompEntry[] = [];
  const profiles: UserProfile[] = [];
  records.forEach((record) => {
    if (record.deleted || !record.value) return;
    if (record.kind === 'entry') {
      const entry = validateImportedEntry(record.value);
      if (entry) entries.push(entry);
    } else {
      const profile = validateImportedProfile(record.value);
      if (profile) profiles.push(profile);
    }
  });
  return { entries, profiles };
};

const normalizeCloudRecord = (value: unknown): CloudRecord[] => {
  if (!value || typeof value !== 'object') return [];
  const candidate = value as Partial<CloudRecord>;
  if (candidate.kind !== 'entry' && candidate.kind !== 'profile') return [];
  if (typeof candidate.id !== 'string' || typeof candidate.version !== 'string') return [];
  if (typeof candidate.deleted !== 'boolean' || Number.isNaN(Date.parse(candidate.version))) return [];
  return [{
    kind: candidate.kind,
    id: candidate.id,
    value: candidate.deleted ? null : candidate.value ?? null,
    version: new Date(candidate.version).toISOString(),
    deleted: candidate.deleted,
  }];
};

const mergeRecords = (records: CloudRecord[]) => {
  const byId = new Map<string, CloudRecord>();
  records.forEach((record) => {
    const key = `${record.kind}:${record.id}`;
    const existing = byId.get(key);
    if (!existing || record.version >= existing.version) byId.set(key, record);
  });
  return [...byId.values()];
};

const loadQueue = (): CloudRecord[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.flatMap(normalizeCloudRecord) : [];
  } catch {
    return [];
  }
};

const removeFromQueue = (sent: CloudRecord[]) => {
  const sentVersions = new Map(sent.map((record) => [`${record.kind}:${record.id}`, record.version]));
  const remaining = loadQueue().filter((record) => {
    const sentVersion = sentVersions.get(`${record.kind}:${record.id}`);
    return !sentVersion || record.version > sentVersion;
  });
  if (remaining.length) localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
  else localStorage.removeItem(QUEUE_KEY);
};

const syncError = async (response: Response) => {
  try {
    const result = (await response.json()) as { error?: string };
    return result.error || `Cloud sync failed (${response.status})`;
  } catch {
    return `Cloud sync failed (${response.status})`;
  }
};
