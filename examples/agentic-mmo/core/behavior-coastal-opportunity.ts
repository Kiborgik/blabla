import { createFoundingProtection, freezeFoundingFacts, type FoundingFunding, type FoundingFundingAssessment } from './behavior-founding-protection.ts';
import { ACTION_FEATURES, BUILDINGS, COASTAL_FOUNDING_RULES, ECONOMY_RULES, LOCAL_GROWTH_RULES, TECHNOLOGIES } from './content.ts';
import { cityHasCapability, coastalPathBlock, coastalSourceBlock, createCoastalPlanner, foundingSiteEligible, foundingSourceEligible, isCoastalSite } from './simulation/coastal.ts';
import { constructionWork, requiredConstructionWork } from './simulation/construction.ts';
import { hexDistance } from './simulation/geography.ts';
import { hasFeatures } from './simulation/history.ts';
import type { ActionOption, City, CoastalFoundingQuote, GameAction, Resources, WorldState } from './types.ts';

export interface CoastalOpportunityWitness extends FoundingFunding {
  readonly kind: 'local-coastal-opportunity';
  readonly revision: number;
  readonly round: number;
  readonly civId: number;
  readonly sourceCityId: string;
  readonly sourceTileId: number;
  readonly tileId: number;
  readonly pathTileIds: readonly number[];
  readonly yard: 'missing' | 'active' | 'completed';
  readonly navigation: 'missing' | 'active' | 'completed';
  readonly mode: 'preparation' | 'founding';
  readonly protectedHorizon: number;
  readonly foundingCost: Readonly<Partial<Resources>>;
  readonly setupCost: Readonly<Partial<Resources>>;
}
export interface CoastalActionAssessment {
  readonly hold: boolean;
  readonly reason: string | null;
  readonly witness: CoastalOpportunityWitness | null;
}
interface SourceProspect {
  readonly source: City;
  readonly yard: CoastalOpportunityWitness['yard'];
  readonly navigation: CoastalOpportunityWitness['navigation'];
  readonly paths: ReadonlyMap<number, CoastalFoundingQuote>;
  readonly enablingTileId: number | null;
}
const amountSafe = (value: number): boolean => Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 100));
const result = (hold: boolean, reason: string | null, witness: CoastalOpportunityWitness | null = null): CoastalActionAssessment => freezeFoundingFacts({ hold, reason, witness });

function closure(state: WorldState, civId: number): { horizon: number; reason: string | null } {
  const actor = state.civilizations.find(candidate => candidate.id === civId);
  if (!actor) return { horizon: 8, reason: 'coastal-actor: the exact actor is unavailable' };
  if (state.spaceflight?.civilizations[civId]?.activeMission || state.spaceflight?.civilizations[civId]?.colony) return { horizon: 8, reason: 'unsupported-off-world: active mission or colony support is outside this coastal snapshot' };
  const intakes = state.cities.filter(city => Object.values(city.improvements ?? {}).some(site => site.improvementId === 'river-intake' && site.operation.enabled) || city.construction?.active && 'kind' in city.construction.active && city.construction.active.kind === 'improvement' && city.construction.active.improvementId === 'river-intake');
  if (intakes.some(city => city.civId === civId) && intakes.some(city => city.civId !== civId)) return { horizon: 8, reason: 'unsupported-river-competition: another actor controls retained local flow dependencies' };
  let horizon = 8;
  for (const city of state.cities.filter(city => city.civId === civId)) {
    const order = city.construction?.active;
    if (['bronze-working', 'industrialization'].includes(actor.researchTarget) && !actor.technologies.includes(actor.researchTarget) && (Object.values(city.improvements ?? {}).some(site => site.improvementId === 'mine') || order && 'kind' in order && order.kind === 'improvement' && order.improvementId === 'mine')) return { horizon, reason: 'unsupported-research-reveal: active research can change retained Mine dependencies' };
    if (!order) continue;
    if ('kind' in order && order.kind !== 'improvement') return { horizon, reason: 'unsupported-order-closure: paid Wonder or Rail completion is outside this coastal snapshot' };
    const work = constructionWork(state, city);
    if (!amountSafe(work) || work <= 0 || !amountSafe(order.workRequired) || !amountSafe(order.workDone) || order.workDone > order.workRequired) return { horizon, reason: 'unsupported-order-work: retained construction has no bounded positive work rate' };
    const beats = Math.max(1, Math.ceil((order.workRequired - order.workDone) / work));
    if (!Number.isSafeInteger(beats)) return { horizon, reason: 'unsupported-order-horizon: retained completion cannot be bounded' };
    horizon = Math.max(horizon, beats + 1);
  }
  return { horizon, reason: null };
}

export function createCoastalOpportunity(state: WorldState, civId: number, legalOptions: readonly ActionOption[]) {
  const revision = state.revision; const round = state.round;
  const actor = state.civilizations.find(candidate => candidate.id === civId);
  const yardDefinition = BUILDINGS.find(building => building.id === 'boat-yard');
  const navigationDefinition = TECHNOLOGIES.find(technology => technology.id === COASTAL_FOUNDING_RULES.requiredTechnology);
  const protection = createFoundingProtection(state, civId);
  const planner = createCoastalPlanner(state);
  const ownCities = state.cities.filter(city => city.civId === civId).toSorted((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const sources = ownCities.filter(city => foundingSourceEligible(city) && isCoastalSite(state, city.tileId));
  const sites = state.tiles.filter(tile => foundingSiteEligible(state, tile)).toSorted((a, b) => a.id - b.id);
  const ownedTiles = state.tiles.filter(tile => tile.owner === civId);
  const frontierSites = new Set(sites.filter(tile => ownedTiles.some(owned => hexDistance(owned, tile) <= 2)).map(tile => tile.id));
  const legalYards = new Set(legalOptions.flatMap(option => option.action.type === 'build' && option.action.project === 'boat-yard' && option.action.cityId ? [option.action.cityId] : []));
  const legalFoundings = new Map(legalOptions.flatMap(option => option.action.type === 'settle-coast' ? [[`${option.action.sourceCityId}/${option.action.tileId}`, option] as const] : []));
  const prospects = new Map<string, SourceProspect>();
  const funding = new Map<string, { assessment: FoundingFundingAssessment; horizon: number; setupCost: Partial<Resources> }>();
  const assessments = new Map<string, CoastalActionAssessment>();
  const counts = { endpointQuotes: 0, fundingAssessments: 0 };
  const released = hasFeatures(state, ACTION_FEATURES['settle-coast']);
  if (released && actor && yardDefinition && navigationDefinition) for (const source of sources) {
    const yard: CoastalOpportunityWitness['yard'] = cityHasCapability(source, COASTAL_FOUNDING_RULES.requiredBuildingCapability) ? 'completed' : source.construction?.active && !('kind' in source.construction.active) && source.construction.active.buildingId === yardDefinition.id ? 'active' : 'missing';
    const navigation: CoastalOpportunityWitness['navigation'] = actor.technologies.includes(navigationDefinition.id) ? 'completed' : actor.researchTarget === navigationDefinition.id ? 'active' : 'missing';
    if (yard === 'missing' && (!hasFeatures(state, yardDefinition.requiredFeatures) || yardDefinition.requires.some(id => !actor.technologies.includes(id))) || navigation === 'missing' && (!hasFeatures(state, navigationDefinition.requiredFeatures) || navigationDefinition.requires.some(id => !actor.technologies.includes(id)))) continue;
    const paths = new Map<number, CoastalFoundingQuote>(); let enablingTileId: number | null = null;
    for (const tile of sites) {
      counts.endpointQuotes++;
      const path = planner.quote(source.tileId, tile.id); if (!path || coastalPathBlock(state, path, source.tileId, tile.id)) continue;
      paths.set(tile.id, path); if (enablingTileId === null && !frontierSites.has(tile.id)) enablingTileId = tile.id;
    }
    if (paths.size) prospects.set(source.id, { source, yard, navigation, paths, enablingTileId });
  }
  let closureFacts: ReturnType<typeof closure> | undefined;
  const support = (prospect: SourceProspect, mode: CoastalOpportunityWitness['mode']) => {
    const key = `${prospect.source.id}/${mode}`; const cached = funding.get(key); if (cached) return cached;
    counts.fundingAssessments++;
    const setupCost = mode === 'preparation' && prospect.yard === 'missing' ? { ...yardDefinition!.cost } : {};
    const reject = (reason: string, horizon = 8) => { const value = { assessment: { facts: null, reason }, horizon, setupCost }; funding.set(key, value); return value; };
    closureFacts ??= closure(state, civId); if (closureFacts.reason) return reject(closureFacts.reason, closureFacts.horizon);
    const prepared = protection.prepare(); if (prepared.failure) return reject(prepared.failure);
    const horizon = Math.max(8, closureFacts.horizon, prepared.horizon);
    if (!Number.isSafeInteger(horizon) || horizon > 18) return reject('unsupported-horizon: necessary support exceeds the eighteen-beat coastal bound', horizon);
    if (mode === 'preparation' && prospect.yard === 'missing') {
      const work = constructionWork(state, prospect.source); const beats = Math.ceil(requiredConstructionWork(yardDefinition!.id) / work);
      if (!amountSafe(work) || work <= 0 || !Number.isSafeInteger(beats) || beats > 8) return reject('yard-work-horizon: a new Yard needs bounded positive work within eight supplied beats', horizon);
    }
    const destination: City = { id: 'coastal-opportunity-prospective-town', name: 'Conditional coastal town', civId, tileId: prospect.paths.keys().next().value!, ...ECONOMY_RULES.initialCity, population: ECONOMY_RULES.settle.population, focus: prospect.source.focus, buildings: [], housing: { ruleVersion: 1, origin: 'founded', baseCapacity: LOCAL_GROWTH_RULES.foundedBaseCapacity, establishedRound: round } };
    const assessment = protection.fund({ source: prospect.source, destination, horizon, foundingCost: ECONOMY_RULES.settle.cost, setupCost, preserveWaitingHouseholds: mode === 'preparation', allocationMode: 'actual-payment', requireEnabledOperations: true });
    const value = { assessment, horizon, setupCost }; funding.set(key, value); return value;
  };
  const witness = (prospect: SourceProspect, tileId: number, mode: CoastalOpportunityWitness['mode']): CoastalActionAssessment => {
    const path = prospect.paths.get(tileId); if (!path) return result(true, 'coastal-path: the exact legal destination and ocean path are unavailable');
    const funded = support(prospect, mode); if (!funded.assessment.facts) return result(true, funded.assessment.reason);
    const facts: CoastalOpportunityWitness = { kind: 'local-coastal-opportunity', revision, round, civId, sourceCityId: prospect.source.id, sourceTileId: prospect.source.tileId, tileId, pathTileIds: [...path.tileIds], yard: prospect.yard, navigation: prospect.navigation, mode, protectedHorizon: funded.horizon, foundingCost: { ...ECONOMY_RULES.settle.cost }, setupCost: { ...funded.setupCost }, ...funded.assessment.facts };
    return result(false, mode === 'founding' ? `Current coastal opportunity ${prospect.source.id} → ${tileId}: stocks protect base-town households and retained obligations for ${funded.horizon} beats` : `Conditional coastal opportunity ${prospect.source.id} → ${tileId}: setup and ${funded.horizon}-beat support fit current stocks; later choices remain independent`, facts);
  };
  const investmentOrder = { completed: 0, active: 1, missing: 2 };
  const preparedProspects = [...prospects.values()].filter(prospect => prospect.enablingTileId !== null).toSorted((a, b) => investmentOrder[a.yard] - investmentOrder[b.yard] || (a.source.id < b.source.id ? -1 : a.source.id > b.source.id ? 1 : 0));
  const supportedPaid = preparedProspects.filter(prospect => prospect.yard !== 'missing' && !!support(prospect, 'preparation').assessment.facts);
  const navigationProspect = preparedProspects.find(prospect => prospect.navigation !== 'completed' && !!support(prospect, 'preparation').assessment.facts);
  const researchBusy = !!actor && !!actor.researchTarget && !actor.technologies.includes(actor.researchTarget);
  const navigationGoal = !!navigationProspect && !researchBusy;
  const assessment = (action: GameAction): CoastalActionAssessment => {
    const coastal = action.type === 'settle-coast' || action.type === 'build' && action.project === 'boat-yard';
    const navigation = action.type === 'research' && action.technology === COASTAL_FOUNDING_RULES.requiredTechnology;
    if (!coastal && !navigation) return result(false, null);
    if (state.revision !== revision || state.round !== round) return result(coastal, 'stale-coastal-assessment: rebuild the local opportunity for the current snapshot');
    const key = JSON.stringify(action); const cached = assessments.get(key); if (cached) return cached;
    let answer: CoastalActionAssessment;
    if (action.type === 'settle-coast') {
      const prospect = prospects.get(action.sourceCityId); const option = legalFoundings.get(`${action.sourceCityId}/${action.tileId}`);
      const block = coastalSourceBlock(state, civId, action.sourceCityId);
      if (!prospect || !option || block || !option.coastalQuote || coastalPathBlock(state, option.coastalQuote, prospect.source.tileId, action.tileId)) answer = result(true, `coastal-not-ready: ${block ?? 'an exact current legal sea-founding option and path are required'}`);
      else answer = witness(prospect, action.tileId, 'founding');
    } else if (action.type === 'build') {
      const prospect = action.cityId ? prospects.get(action.cityId) : undefined;
      if (!prospect || prospect.enablingTileId === null) answer = result(true, 'coastal-no-beneficiary: this new Yard has no eligible shore beyond current ordinary frontier reach');
      else if (!legalYards.has(prospect.source.id) || prospect.yard !== 'missing') answer = result(true, 'coastal-yard-not-legal: only an exact idle-town legal new Yard is assessed; paid work is retained');
      else {
        const beneficiary = [...prospect.paths.keys()].find(tileId => !frontierSites.has(tileId) && !supportedPaid.some(paid => paid.source.id !== prospect.source.id && paid.paths.has(tileId)));
        answer = beneficiary === undefined ? result(true, 'coastal-existing-investment: an already-paid viable departure town serves these same shores') : witness(prospect, beneficiary, 'preparation');
      }
    } else if (researchBusy) answer = result(false, `coastal-research-busy: retain active ${actor!.researchTarget} and its paid progress; no research duration is forecast`);
    else if (navigationProspect) answer = witness(navigationProspect, navigationProspect.enablingTileId!, 'preparation');
    else answer = result(false, 'coastal-no-research-bonus: no supported current shore prospect; ordinary Navigation remains available');
    assessments.set(key, answer); return answer;
  };
  return Object.freeze({ navigationGoal, assessment, get work() { return Object.freeze({ sources: sources.length, sites: sites.length, endpointQuotes: counts.endpointQuotes, trees: planner.work.trees, visitedTiles: planner.work.visitedTiles, fundingAssessments: counts.fundingAssessments }); } });
}
