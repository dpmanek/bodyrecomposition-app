export type WeightUnit = 'lb' | 'kg';
export type HeightUnit = 'in' | 'cm';
export type EntrySource = 'manual' | 'ai';
export type ProfileSex = 'female' | 'male' | 'other' | 'unspecified';

export type MeasurementField =
  | 'weight'
  | 'bmi'
  | 'bodyFatPercent'
  | 'skeletalMusclePercent'
  | 'visceralFatLevel'
  | 'restingMetabolismKcal'
  | 'bodyAgeYears';

export interface UserProfile {
  id: string;
  name: string;
  sex: ProfileSex;
  ageYears: string;
  height: string;
  heightUnit: HeightUnit;
  weight: string;
  weightUnit: WeightUnit;
  skeletalMusclePercent: string;
  visceralFatLevel: string;
  restingMetabolismKcal: string;
  baselineNotes: string;
  createdAt: string;
  updatedAt: string;
}

export interface RecompEntry {
  id: string;
  profileId: string | null;
  profileName: string;
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
  'id' | 'profileId' | 'profileName' | 'capturedAt' | 'notes' | 'source' | 'createdAt' | 'updatedAt'
>;

export type FieldConfidence = Partial<Record<MeasurementField | 'weightUnit', number>>;

export interface ExtractionResult {
  values: Partial<ExtractionValues>;
  confidence: FieldConfidence;
}

export interface EntryDraft {
  profileId: string | null;
  profileName: string;
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

export type ValidationIssueKind = 'missing' | 'range' | 'confidence';

export interface ValidationIssue {
  field: MeasurementField | 'capturedAt';
  kind: ValidationIssueKind;
  message: string;
}

export interface HealthDailySummary {
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

export interface GoogleHealthStatus {
  connected: boolean;
  connectedAt: string | null;
  lastSyncedAt: string | null;
  summaries: HealthDailySummary[];
}

export type AppTab = 'capture' | 'dashboard' | 'log' | 'profiles' | 'settings';
