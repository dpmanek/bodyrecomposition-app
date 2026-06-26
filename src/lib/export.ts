import type { RecompEntry } from '../types';
import { validateImportedEntry } from './validation';

export const downloadFile = (filename: string, contents: string, type: string) => {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

export const exportJson = (entries: RecompEntry[]) =>
  JSON.stringify({ app: 'RecompTrack', version: 1, exportedAt: new Date().toISOString(), entries }, null, 2);

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

export const parseBackup = (raw: string): RecompEntry[] => {
  const parsed = JSON.parse(raw) as unknown;
  const values =
    parsed && typeof parsed === 'object' && 'entries' in parsed
      ? (parsed as { entries: unknown }).entries
      : parsed;
  if (!Array.isArray(values)) throw new Error('Backup must contain an entries array');

  const entries = values.map(validateImportedEntry).filter((entry): entry is RecompEntry => Boolean(entry));
  if (entries.length === 0 && values.length > 0) {
    throw new Error('No valid entries found in backup');
  }
  return entries;
};

const csvCell = (value: unknown) => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
