import { BUILDINGS, POLICIES, RESIDENT_CAPACITY_RULES } from './content.ts';

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function keys(value: Record<string, unknown>, expected: readonly string[]): boolean { return Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key)); }
function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum; }
function quantized(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER && Math.round(value * 100) / 100 === value; }
function dense(value: unknown): value is unknown[] { return Array.isArray(value) && Object.keys(value).length === value.length && Array.from(value).every((_, index) => Object.hasOwn(value, index)); }

export function validPolicyExclusivity(assignments: unknown): boolean {
  if (!dense(assignments)) return false;
  const groups = new Set<string>();
  for (const assignment of assignments) {
    if (!record(assignment) || typeof assignment.policyId !== 'string') return false;
    const policy = POLICIES.find(candidate => candidate.id === assignment.policyId);
    if (!policy) return false;
    if (policy.exclusiveGroup === undefined) continue;
    if (groups.has(policy.exclusiveGroup)) return false;
    groups.add(policy.exclusiveGroup);
  }
  return true;
}

export function validInstitutionalScienceReceipt(value: unknown, buildingId: string): boolean {
  if (!record(value)) return false;
  if (!Object.hasOwn(value, 'policyContribution')) return true;
  const contribution = value.policyContribution;
  if (!record(contribution) || !keys(contribution, ['policyId', 'percent', 'unboostedScience', 'bonusScience'])
    || typeof contribution.policyId !== 'string' || !quantized(contribution.unboostedScience) || !quantized(contribution.bonusScience)) return false;
  const policy = POLICIES.find(candidate => candidate.id === contribution.policyId);
  const building = BUILDINGS.find(candidate => candidate.id === buildingId);
  const effect = policy?.institutionalSciencePercent;
  if (!policy || !building || !effect || !effect.buildingIds.includes(buildingId) || contribution.percent !== effect.percent
    || value.status !== 'operated' || !integer(value.round, 1) || !dense(value.shortages) || value.shortages.length !== 0
    || !record(value.paid) || !building.operatingInputs || !keys(value.paid, Object.keys(building.operatingInputs))
    || !Object.entries(building.operatingInputs).every(([resource, amount]) => (value.paid as Record<string, unknown>)[resource] === amount)) return false;
  const residents = value.residents;
  if (!record(residents) || !keys(residents, ['ruleVersion', 'openingPopulation', 'communityReserve', 'required', 'available', 'allocated'])
    || residents.ruleVersion !== RESIDENT_CAPACITY_RULES.ruleVersion || !integer(residents.openingPopulation, 1)
    || residents.communityReserve !== RESIDENT_CAPACITY_RULES.communityReserve || residents.required !== RESIDENT_CAPACITY_RULES.perPaidRecipe
    || residents.allocated !== RESIDENT_CAPACITY_RULES.perPaidRecipe
    || !integer(residents.available, RESIDENT_CAPACITY_RULES.perPaidRecipe, Math.max(0, residents.openingPopulation - RESIDENT_CAPACITY_RULES.communityReserve))) return false;
  const expectedBonus = Math.round((contribution.unboostedScience * effect.percent / 100) * 100) / 100;
  const expectedScience = Math.round((contribution.unboostedScience + contribution.bonusScience) * 100) / 100;
  return contribution.bonusScience === expectedBonus && record(value.produced) && keys(value.produced, ['science'])
    && quantized(value.produced.science) && value.produced.science === expectedScience;
}

export function validInstitutionalScienceOperation(value: unknown, buildingId: string, features: readonly string[]): boolean {
  if (!record(value) || !validInstitutionalScienceReceipt(value, buildingId)) return false;
  if (!Object.hasOwn(value, 'policyContribution')) return true;
  const contribution = value.policyContribution;
  if (!record(contribution)) return false;
  const policy = POLICIES.find(candidate => candidate.id === contribution.policyId);
  const building = BUILDINGS.find(candidate => candidate.id === buildingId);
  return !!policy && !!building && features.includes('building-operations') && features.includes('resident-capacity')
    && policy.requiredFeatures.every(feature => features.includes(feature)) && building.requiredFeatures.every(feature => features.includes(feature));
}
