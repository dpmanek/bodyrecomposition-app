import type { UserProfile } from '../types';
import { emptyProfile } from './validation';

const PROFILE_KEY = 'recomptrack.profile.v1';

export const loadProfile = (): UserProfile => {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return emptyProfile();
    return { ...emptyProfile(), ...(JSON.parse(raw) as Partial<UserProfile>) };
  } catch {
    return emptyProfile();
  }
};

export const saveProfile = (profile: UserProfile) => {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
};
