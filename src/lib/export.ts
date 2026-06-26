import type { RecompEntry, UserProfile } from '../types';
import { validateImportedEntry, validateImportedProfile } from './validation';

export const downloadFile = (filename: string, contents: string, type: string) => {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

export const exportJson = (entries: RecompEntry[], profiles: UserProfile[]) =>
  JSON.stringify(
    { app: 'RecompTrack', version: 2, exportedAt: new Date().toISOString(), profiles, entries },
    null,
    2,
  );

export const exportCsv = (entries: RecompEntry[]) => {
  const headers = [
    'capturedAt',
    'weight',
    'weightUnit',
    'bmi',
    'bodyFatPercent',
    'skeletalMusclePercent',
    'visceralFatLevel',
    'restingMetabolismKcal',
    'bodyAgeYears',
    'notes',
    'source',
  ];
  const rows = entries.map((entry) =>
    headers.map((header) => csvCell(entry[header as keyof RecompEntry])).join(','),
  );
  return [headers.join(','), ...rows].join('\n');
};

export const parseBackup = (raw: string): { entries: RecompEntry[]; profiles: UserProfile[] } => {
  const parsed = JSON.parse(raw) as unknown;
  const entryValues =
    parsed && typeof parsed === 'object' && 'entries' in parsed
      ? (parsed as { entries: unknown }).entries
      : parsed;
  const profileValues =
    parsed && typeof parsed === 'object' && 'profiles' in parsed
      ? (parsed as { profiles: unknown }).profiles
      : [];
  if (!Array.isArray(entryValues)) throw new Error('Backup must contain an entries array');

  const entries = entryValues.map(validateImportedEntry).filter((entry): entry is RecompEntry => Boolean(entry));
  const profiles = Array.isArray(profileValues)
    ? profileValues.map(validateImportedProfile).filter((profile): profile is UserProfile => Boolean(profile))
    : [];

  if (entries.length === 0 && entryValues.length > 0) {
    throw new Error('No valid entries found in backup');
  }
  return { entries, profiles };
};

const csvCell = (value: unknown) => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
