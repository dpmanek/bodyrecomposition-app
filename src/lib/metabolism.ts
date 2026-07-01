import type { HeightUnit, ProfileSex, WeightUnit } from '../types';

interface RestingMetabolismInputs {
  ageYears: string;
  height: string;
  heightUnit: HeightUnit;
  sex: ProfileSex;
  weight: string;
  weightUnit: WeightUnit;
}

export const estimateRestingMetabolismKcal = ({
  ageYears,
  height,
  heightUnit,
  sex,
  weight,
  weightUnit,
}: RestingMetabolismInputs): number | null => {
  if (sex !== 'female' && sex !== 'male') return null;

  const age = positiveNumber(ageYears);
  const rawHeight = positiveNumber(height);
  const rawWeight = positiveNumber(weight);
  if (age === null || rawHeight === null || rawWeight === null) return null;

  const heightCm = heightUnit === 'in' ? rawHeight * 2.54 : rawHeight;
  const weightKg = weightUnit === 'lb' ? rawWeight / 2.2046226218 : rawWeight;
  const sexConstant = sex === 'male' ? 5 : -161;

  return Math.round(10 * weightKg + 6.25 * heightCm - 5 * age + sexConstant);
};

const positiveNumber = (value: string) => {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};
