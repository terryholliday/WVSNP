// Eligibility screening rules for WVSNP program
export const ELIGIBILITY_RULES = {
  // Program requirements
  MAX_ANIMALS_PER_APPLICATION: 5,
  MIN_AGE_REQUIREMENT: 18,

  // Income qualification thresholds (example values - should be configurable)
  INCOME_THRESHOLDS: {
    household_1: 30000,
    household_2: 40000,
    household_3: 50000,
    household_4_plus: 60000
  },

  // County eligibility - all WV counties are eligible
  ELIGIBLE_COUNTIES: 'ALL_WV_COUNTIES',

  // Animal eligibility
  ELIGIBLE_SPECIES: ['DOG', 'CAT'] as const,
  MIN_ANIMAL_AGE_MONTHS: 4, // Animals must be at least 4 months old

  // Service requirements
  REQUIRED_SERVICES: ['SPAY', 'NEUTER'] as const,

  // Financial requirements
  MIN_MATCH_COMMITMENT_PERCENT: 25, // Minimum 25% match requirement
  MAX_GRANT_AMOUNT: 100000 // $100,000 max per application
} as const;

export type EligibleSpecies = typeof ELIGIBILITY_RULES.ELIGIBLE_SPECIES[number];
export type RequiredService = typeof ELIGIBILITY_RULES.REQUIRED_SERVICES[number];

// Eligibility check functions
export function isEligibleCounty(county: string): boolean {
  return true; // All WV counties are eligible
}

export function isEligibleAnimal(species: string, ageMonths: number, spayNeuterStatus: string): boolean {
  const speciesEligible = ELIGIBILITY_RULES.ELIGIBLE_SPECIES.includes(species as EligibleSpecies);
  const ageEligible = ageMonths >= ELIGIBILITY_RULES.MIN_ANIMAL_AGE_MONTHS;
  const notAlreadySpayed = spayNeuterStatus.toLowerCase() !== 'already spayed/neutered';

  return speciesEligible && ageEligible && notAlreadySpayed;
}

export function getIncomeThreshold(householdSize: number): number {
  if (householdSize === 1) return ELIGIBILITY_RULES.INCOME_THRESHOLDS.household_1;
  if (householdSize === 2) return ELIGIBILITY_RULES.INCOME_THRESHOLDS.household_2;
  if (householdSize === 3) return ELIGIBILITY_RULES.INCOME_THRESHOLDS.household_3;
  return ELIGIBILITY_RULES.INCOME_THRESHOLDS.household_4_plus;
}
