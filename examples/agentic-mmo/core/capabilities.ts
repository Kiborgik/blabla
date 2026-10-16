import { availableImprovementSites, isImprovementOrder, orderedImprovements } from './simulation/improvements.ts';
import { availableDistrictSites, buildingBaseProduction, districtCapacity, districtCount } from './simulation/districts.ts';
import { BUILDINGS, IMPROVEMENTS, ERAS, FEATURES, HISTORICAL_MILESTONES, TECHNOLOGIES } from './content.ts';
import { RELEASES } from './release.ts';
import type { ActionPlan } from './planning.ts';
import type { ActionOption, CityImprovement, BuildingOperation, ConstructionOrder, ConstructionCompletion, DecisionObligations, ResearchCompletion, Resources, WorldState } from './types.ts';
import { buildingEligibility, improvementEligibility, researchEligibility, type CapabilityBlocker, type CapabilityEligibility } from './simulation/capabilities.ts';
import { admissionError, turnAdmission } from './simulation/turns.ts';
import { hasFeatures, milestoneEligible } from './simulation/history.ts';
import { decisionObligations } from './simulation/decisions.ts';
import { parseUtcTimestamp } from './simulation/time.ts';

export type { CapabilityBlocker } from './simulation/capabilities.ts';
export type CapabilityCatalogue = ReturnType<typeof capabilityCatalogue>;

export interface CapabilityRow {
  nodeId: string;
  status: 'done' | 'available' | 'locked' | 'planned';
  support: 'applied' | 'registered-release' | 'catalogue-only';
  blockers: CapabilityBlocker[];
  choiceRefs: number[];
  research?: { progress: number; cost: number };
  operation?: BuildingOperation;
  construction?: ConstructionOrder;
  district?: { capacity: number; used: number; siteId: number | null; siteBaseProduction: Partial<Resources> | null; availableSites: Array<{ tileId: number; baseProduction: Partial<Resources> }> };
}

export interface ImprovementCapabilityRow extends CapabilityRow {
  availableSites: Array<{ tileId: number; baseProduction: Partial<Resources> }>;
  installed: Array<CityImprovement & { cityId: string }>;
}

export interface CapabilityChoiceContext {
  revision: number;
  observedAt: string;
  seat: number;
  legalActions: readonly ActionOption[];
}

export interface CapabilityProjection {
  choiceReferenceState: 'not-provided' | 'provided';
  revision: number;
  observedAt: string;
  releaseId: string;
  unlockedFeatures: string[];
  civilizationId: number;
  cityId: string | null;
  admission: ReturnType<typeof turnAdmission> & { reason: string | null };
  technologies: CapabilityRow[];
  buildings: CapabilityRow[];
  improvements?: ImprovementCapabilityRow[];
  legalActions: ActionOption[];
  recordedIntent: ActionPlan | null;
  decisions?: DecisionObligations;
  lastResearchCompletion?: ResearchCompletion;
  lastConstructionCompletion?: ConstructionCompletion;
  milestones: Array<{ id: string; achieved: boolean; eligible: boolean }>;
}

export function capabilityCatalogue() {
  return structuredClone({
    technologies: TECHNOLOGIES,
    buildings: BUILDINGS,
    improvements: IMPROVEMENTS,
    edges: [
      ...IMPROVEMENTS.flatMap(improvement => improvement.requires.map(id => ({ from: `technology:${id}`, to: `improvement:${improvement.id}` }))),
      ...TECHNOLOGIES.flatMap(technology => technology.requires.map(id => ({ from: `technology:${id}`, to: `technology:${technology.id}` }))),
      ...BUILDINGS.flatMap(building => (building.requiresBuildings ?? []).map(id => ({ from: `building:${id}`, to: `building:${building.id}` }))),
      ...BUILDINGS.flatMap(building => building.requires.map(id => ({ from: `technology:${id}`, to: `building:${building.id}` }))),
    ],
    features: FEATURES.map(feature => ({ ...feature, releaseIds: RELEASES.filter(release => release.featureIds.includes(feature.id)).map(release => release.id) })),
    releases: RELEASES,
    milestones: HISTORICAL_MILESTONES,
    eras: ERAS,
  });
}

function row(nodeId: string, eligibility: CapabilityEligibility, choiceRefs: number[]): CapabilityRow {
  const missing = eligibility.blockers.flatMap(blocker => blocker.kind === 'feature' ? [blocker.featureId] : []);
  return {
    nodeId,
    status: eligibility.completed ? 'done' : missing.length ? 'planned' : eligibility.blockers.length ? 'locked' : 'available',
    support: !missing.length ? 'applied' : RELEASES.some(release => missing.every(id => release.featureIds.includes(id))) ? 'registered-release' : 'catalogue-only',
    blockers: eligibility.completed ? [] : eligibility.blockers,
    choiceRefs,
  };
}

export function projectCapabilities(state: WorldState, civilizationId: number, cityId: string | null, timestamp: string, choices?: CapabilityChoiceContext): CapabilityProjection {
  const civilization = state.civilizations.find(candidate => candidate.id === civilizationId);
  if (!civilization) throw new RangeError('Capability projection requires an existing civilization');
  if (parseUtcTimestamp(timestamp) === null) throw new RangeError('Capability projection requires an explicit UTC timestamp');
  if (choices && (choices.revision !== state.revision || choices.observedAt !== timestamp || choices.seat !== civilizationId))
    throw new RangeError('Capability choice references require the same revision, seat and observation timestamp');
  const legalActions = choices ? [...choices.legalActions] : [];
  const city = state.cities.find(candidate => candidate.id === cityId && candidate.civId === civilizationId);
  const technologies = TECHNOLOGIES.map(technology => {
    const eligibility = researchEligibility(state, civilizationId, technology);
    const choiceRefs = legalActions.flatMap((option, index) => option.action.type === 'research' && option.action.technology === technology.id ? [index] : []);
    return { ...row(`technology:${technology.id}`, eligibility, choiceRefs), ...(eligibility.researching && !eligibility.completed ? { research: { progress: civilization.researchProgress, cost: technology.cost } } : {}) };
  });
  const buildings = BUILDINGS.map(building => {
    const eligibility = buildingEligibility(state, civilizationId, building, cityId);
    const choiceRefs = eligibility.completed || eligibility.blockers.length ? [] : legalActions.flatMap((option, index) => option.action.type === 'build' && option.action.project === building.id && (option.action.cityId === undefined || option.action.cityId === cityId) ? [index] : []);
    const operation = city?.buildingOperations?.[building.id];
    const active = city?.construction?.active;
    const construction = active && !isImprovementOrder(active) && active.buildingId === building.id ? active : null;
    const districtSiteId = city?.districtSites?.[building.id] ?? construction?.tileId;
    return { ...row(`building:${building.id}`, eligibility, choiceRefs), ...(construction ? { status: 'available' as const, blockers: [], construction } : {}), ...(operation ? { operation } : {}), ...(city && building.district ? { district: { capacity: districtCapacity(city), used: districtCount(city), siteId: districtSiteId ?? null, siteBaseProduction: districtSiteId === undefined ? null : buildingBaseProduction(state, city, building, districtSiteId), availableSites: eligibility.completed || eligibility.blockers.length ? [] : availableDistrictSites(state, city, building).map(tileId => ({ tileId, baseProduction: buildingBaseProduction(state, city, building, tileId) })) } } : {}) };
  });
  const improvements: ImprovementCapabilityRow[] = IMPROVEMENTS.map(definition => {
    const eligibility = improvementEligibility(state, civilizationId, definition, cityId);
    const active = city?.construction?.active;
    const construction = active && isImprovementOrder(active) && active.improvementId === definition.id ? active : null;
    const choiceRefs = eligibility.blockers.length ? [] : legalActions.flatMap((option, index) => option.action.type === 'improve' && option.action.improvementId === definition.id && option.action.cityId === cityId ? [index] : []);
    return { ...row(`improvement:${definition.id}`, eligibility, choiceRefs), ...(construction ? { status: 'available' as const, blockers: [], construction } : {}),
      availableSites: city && !eligibility.blockers.length ? availableImprovementSites(state, city, definition).map(tileId => ({ tileId, baseProduction: { ...definition.production } })) : [],
      installed: city ? orderedImprovements(city).filter(improvement => improvement.improvementId === definition.id).map(improvement => ({ ...improvement, cityId: city.id })) : [],
    };
  });
  return structuredClone({
    choiceReferenceState: choices ? 'provided' : 'not-provided',
    revision: state.revision,
    observedAt: timestamp,
    releaseId: state.releaseId,
    unlockedFeatures: state.unlockedFeatures,
    civilizationId,
    cityId,
    admission: { ...turnAdmission(state, civilizationId), reason: state.outcome ? 'The world has reached an outcome' : admissionError(state, civilizationId, timestamp) },
    technologies,
    buildings,
    improvements,
    legalActions,
    recordedIntent: state.actionPlans?.[civilizationId] ?? null,
    ...(hasFeatures(state, ['recurring-decisions']) ? {
      decisions: decisionObligations(state, civilizationId),
      ...(civilization.lastResearchCompletion ? { lastResearchCompletion: civilization.lastResearchCompletion } : {}),
      ...(city?.construction?.lastCompleted ? { lastConstructionCompletion: city.construction.lastCompleted } : {}),
    } : {}),
    milestones: HISTORICAL_MILESTONES.map(milestone => ({ id: milestone.id, achieved: state.calendarMilestones.includes(milestone.id), eligible: milestoneEligible(state, [], milestone) })),
  });
}
