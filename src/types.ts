export type WeightUnit = 'lb' | 'kg';
export type EntrySource = 'manual' | 'ai';

export type MeasurementField =
  | 'weight'
  | 'bmi'
  | 'bodyFatPercent'
  | 'skeletalMusclePercent'
  | 'visceralFatLevel'
  | 'restingMetabolismKcal'
  | 'bodyAgeYears';

export interface RecompEntry {
  id: string;
  capturedAt: string;
  weight: number | null;
  weightUnit: WeightUnit;
  bmi: number | null;
  bodyFatPercent: number | null;
  skeletalMusclePercent: number | null;
  visceralFatLevel: number | null;
  restingMetabolismKcal: number | null;
  bodyAgeYears: number | null;
  notes: string;
  source: EntrySource;
  createdAt: string;
  updatedAt: string;
}

export type ExtractionValues = Omit<
  RecompEntry,
  'id' | 'capturedAt' | 'notes' | 'source' | 'createdAt' | 'updatedAt'
>;

export type FieldConfidence = Partial<Record<MeasurementField | 'weightUnit', number>>;

export interface ExtractionResult {
  values: Partial<ExtractionValues>;
  confidence: FieldConfidence;
}

export interface EntryDraft {
  capturedAt: string;
  weight: string;
  weightUnit: WeightUnit;
  bmi: string;
  bodyFatPercent: string;
  skeletalMusclePercent: string;
  visceralFatLevel: string;
  restingMetabolismKcal: string;
  bodyAgeYears: string;
  notes: string;
  source: EntrySource;
}

export interface UserProfile {
  weight: string;
  weightUnit: WeightUnit;
  bodyAgeYears: string;
  skeletalMusclePercent: string;
  visceralFatLevel: string;
  restingMetabolismKcal: string;
}

export type ValidationIssueKind = 'missing' | 'range' | 'confidence';

export interface ValidationIssue {
  field: MeasurementField | 'capturedAt';
  kind: ValidationIssueKind;
  message: string;
}

export type AppTab = 'capture' | 'log' | 'trends' | 'backup';
