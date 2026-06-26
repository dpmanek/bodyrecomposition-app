import type {
  EntryDraft,
  MeasurementField,
  RecompEntry,
  UserProfile,
  ValidationIssue,
  WeightUnit,
  FieldConfidence,
} from '../types';

type Range = { min: number; max: number; label: string };

export const FIELD_RANGES: Record<MeasurementField, Range> = {
  weight: { min: 0, max: Number.POSITIVE_INFINITY, label: 'Weight must be greater than 0' },
  bmi: { min: 5, max: 80, label: 'BMI is outside the expected 5-80 range' },
  bodyFatPercent: { min: 1, max: 75, label: 'Body fat is outside the expected 1-75% range' },
  skeletalMusclePercent: { min: 1, max: 75, label: 'Skeletal muscle is outside the expected 1-75% range' },
  visceralFatLevel: { min: 1, max: 30, label: 'Visceral fat is outside the expected 1-30 range' },
  restingMetabolismKcal: { min: 500, max: 5000, label: 'Resting metabolism is outside the expected 500-5000 kcal range' },
  bodyAgeYears: { min: 1, max: 120, label: 'Body age is outside the expected 1-120 range' },
};

export const emptyProfile = (): UserProfile => ({
  weight: '',
  weightUnit: 'lb',
  bodyAgeYears: '',
  skeletalMusclePercent: '',
  visceralFatLevel: '',
  restingMetabolismKcal: '',
});

export const emptyDraft = (profile: UserProfile = emptyProfile()): EntryDraft => ({
  capturedAt: new Date().toISOString().slice(0, 16),
  weight: profile.weight,
  weightUnit: profile.weightUnit,
  bmi: '',
  bodyFatPercent: '',
  skeletalMusclePercent: profile.skeletalMusclePercent,
  visceralFatLevel: profile.visceralFatLevel,
  restingMetabolismKcal: profile.restingMetabolismKcal,
  bodyAgeYears: profile.bodyAgeYears,
  notes: '',
  source: 'manual',
});

export const profileToDraftPatch = (profile: UserProfile) => ({
  weight: profile.weight,
  weightUnit: profile.weightUnit,
  skeletalMusclePercent: profile.skeletalMusclePercent,
  visceralFatLevel: profile.visceralFatLevel,
  restingMetabolismKcal: profile.restingMetabolismKcal,
  bodyAgeYears: profile.bodyAgeYears,
});

export const entryToDraft = (entry: RecompEntry): EntryDraft => ({
  capturedAt: entry.capturedAt.slice(0, 16),
  weight: stringifyNumber(entry.weight),
  weightUnit: entry.weightUnit,
  bmi: stringifyNumber(entry.bmi),
  bodyFatPercent: stringifyNumber(entry.bodyFatPercent),
  skeletalMusclePercent: stringifyNumber(entry.skeletalMusclePercent),
  visceralFatLevel: stringifyNumber(entry.visceralFatLevel),
  restingMetabolismKcal: stringifyNumber(entry.restingMetabolismKcal),
  bodyAgeYears: stringifyNumber(entry.bodyAgeYears),
  notes: entry.notes,
  source: entry.source,
});

export const draftToEntry = (draft: EntryDraft, existing?: RecompEntry): RecompEntry => {
  const now = new Date().toISOString();

  return {
    id: existing?.id ?? crypto.randomUUID(),
    capturedAt: new Date(draft.capturedAt).toISOString(),
    weight: parseOptionalNumber(draft.weight),
    weightUnit: draft.weightUnit,
    bmi: parseOptionalNumber(draft.bmi),
    bodyFatPercent: parseOptionalNumber(draft.bodyFatPercent),
    skeletalMusclePercent: parseOptionalNumber(draft.skeletalMusclePercent),
    visceralFatLevel: parseOptionalNumber(draft.visceralFatLevel),
    restingMetabolismKcal: parseOptionalNumber(draft.restingMetabolismKcal),
    bodyAgeYears: parseOptionalNumber(draft.bodyAgeYears),
    notes: draft.notes.trim(),
    source: draft.source,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
};

export const validateDraft = (
  draft: EntryDraft,
  confidence: FieldConfidence = {},
): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];

  if (!draft.capturedAt || Number.isNaN(new Date(draft.capturedAt).getTime())) {
    issues.push({ field: 'capturedAt', kind: 'missing', message: 'Capture date is required' });
  }

  Object.entries(FIELD_RANGES).forEach(([fieldName, range]) => {
    const field = fieldName as MeasurementField;
    const parsed = parseOptionalNumber(draft[field]);
    if (parsed === null) return;
    if (parsed < range.min || parsed > range.max || (field === 'weight' && parsed <= 0)) {
      issues.push({ field, kind: 'range', message: range.label });
    }
    const fieldConfidence = confidence[field];
    if (fieldConfidence !== undefined && fieldConfidence < 0.72) {
      issues.push({
        field,
        kind: 'confidence',
        message: `Low AI confidence (${Math.round(fieldConfidence * 100)}%)`,
      });
    }
  });

  return issues;
};

export const validateImportedEntry = (value: unknown): RecompEntry | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<RecompEntry>;
  if (!candidate.id || !candidate.capturedAt) return null;
  if (candidate.weightUnit !== 'lb' && candidate.weightUnit !== 'kg') return null;

  const draft = entryToDraft({
    id: String(candidate.id),
    capturedAt: String(candidate.capturedAt),
    weight: normalizeNullableNumber(candidate.weight),
    weightUnit: candidate.weightUnit as WeightUnit,
    bmi: normalizeNullableNumber(candidate.bmi),
    bodyFatPercent: normalizeNullableNumber(candidate.bodyFatPercent),
    skeletalMusclePercent: normalizeNullableNumber(candidate.skeletalMusclePercent),
    visceralFatLevel: normalizeNullableNumber(candidate.visceralFatLevel),
    restingMetabolismKcal: normalizeNullableNumber(candidate.restingMetabolismKcal),
    bodyAgeYears: normalizeNullableNumber(candidate.bodyAgeYears),
    notes: String(candidate.notes ?? ''),
    source: candidate.source === 'ai' ? 'ai' : 'manual',
    createdAt: String(candidate.createdAt ?? candidate.capturedAt),
    updatedAt: String(candidate.updatedAt ?? candidate.capturedAt),
  });

  if (validateDraft(draft).some((issue) => issue.kind === 'range' || issue.kind === 'missing')) {
    return null;
  }

  return draftToEntry(draft, {
    id: String(candidate.id),
    capturedAt: String(candidate.capturedAt),
    weight: null,
    weightUnit: candidate.weightUnit as WeightUnit,
    bmi: null,
    bodyFatPercent: null,
    skeletalMusclePercent: null,
    visceralFatLevel: null,
    restingMetabolismKcal: null,
    bodyAgeYears: null,
    notes: '',
    source: 'manual',
    createdAt: String(candidate.createdAt ?? candidate.capturedAt),
    updatedAt: String(candidate.updatedAt ?? candidate.capturedAt),
  });
};

export const parseOptionalNumber = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

const stringifyNumber = (value: number | null): string => (value === null ? '' : String(value));

const normalizeNullableNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
