import type { RecompEntry } from '../types';

const STORAGE_KEY = 'recomptrack.entries.v1';

export const loadEntries = (): RecompEntry[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecompEntry[];
    return Array.isArray(parsed) ? sortEntries(parsed) : [];
  } catch {
    return [];
  }
};

export const saveEntries = (entries: RecompEntry[]) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sortEntries(entries)));
};

export const sortEntries = (entries: RecompEntry[]) =>
  [...entries].sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime());
