import type { UserProfile } from '../types';
import { createProfile, validateImportedProfile } from './validation';

const PROFILES_KEY = 'recomptrack.profiles.v2';
const ACTIVE_PROFILE_KEY = 'recomptrack.activeProfileId.v2';
const LEGACY_PROFILE_KEY = 'recomptrack.profile.v1';

export const loadProfiles = (): UserProfile[] => {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        const profiles = parsed
          .map(validateImportedProfile)
          .filter((profile): profile is UserProfile => Boolean(profile));
        if (profiles.length) return profiles;
      }
    }
  } catch {
    // Fall through to migration/default.
  }

  const migrated = migrateLegacyProfile();
  return [migrated ?? createProfile('Me')];
};

export const saveProfiles = (profiles: UserProfile[]) => {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
};

export const loadActiveProfileId = (profiles: UserProfile[]) => {
  const stored = localStorage.getItem(ACTIVE_PROFILE_KEY);
  if (stored && profiles.some((profile) => profile.id === stored)) return stored;
  return profiles[0]?.id ?? null;
};

export const saveActiveProfileId = (profileId: string | null) => {
  if (profileId) {
    localStorage.setItem(ACTIVE_PROFILE_KEY, profileId);
  } else {
    localStorage.removeItem(ACTIVE_PROFILE_KEY);
  }
};

const migrateLegacyProfile = () => {
  try {
    const raw = localStorage.getItem(LEGACY_PROFILE_KEY);
    if (!raw) return null;
    const legacy = JSON.parse(raw) as Record<string, unknown>;
    const profile = createProfile('Me');
    return {
      ...profile,
      ageYears: stringValue(legacy.bodyAgeYears),
      weight: stringValue(legacy.weight),
      weightUnit: legacy.weightUnit === 'kg' ? 'kg' : 'lb',
      skeletalMusclePercent: stringValue(legacy.skeletalMusclePercent),
      visceralFatLevel: stringValue(legacy.visceralFatLevel),
      restingMetabolismKcal: stringValue(legacy.restingMetabolismKcal),
    } satisfies UserProfile;
  } catch {
    return null;
  }
};

const stringValue = (value: unknown) => {
  if (value === null || value === undefined) return '';
  return String(value);
};
