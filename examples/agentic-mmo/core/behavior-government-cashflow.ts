import { exchangePromisedResources } from './behavior-knowledge.ts';
import { selectedInstitutionsFunded } from './behavior-paid-food-sites.ts';
import type { BehaviorProfile } from './behavior-profiles.ts';
import { BUILDINGS, CIVIC_RULES, IMPROVEMENTS, LEARNING_PATRONAGE_RULES, POLICIES, RESOURCE_IDS, STRATEGIC_RESOURCE_IDS, TECHNOLOGIES } from './content.ts';
import { KNOWLEDGE_RULES } from './knowledge-content.ts';
import { produceCity, supplyCity } from './simulation/city-production-supply.ts';
import { resolveCivics } from './simulation/civics.ts';
import { openingConstructionWork, resolveConstruction } from './simulation/construction.ts';
import { adoptGovernment, canonicalAssignments, governmentActionBlock, governmentPrice, resolveGovernmentTransitions } from './simulation/government.ts';
import { hexDistance } from './simulation/geography.ts';
import { cityGrowthFacts } from './simulation/growth.ts';
import { hasFeatures } from './simulation/history.ts';
import { extractCityMetals } from './simulation/metals.ts';
import { allocateOperations, paidRecipe } from './simulation/operations.ts';
import { recordRiverFlow } from './simulation/river-intakes.ts';
import { prepareWoodlandBeat, recordWoodlands } from './simulation/woodlands.ts';
import { citiesOf } from './simulation/world.ts';
import type { City, GameAction, GameEvent, PolicyAssignment, Resources, WorldState } from './types.ts';

export type ArrangementAction = Extract<GameAction, { type: 'adopt-government' }>;
export interface GovernmentOperationCheckpoint {
  readonly key: string;
  readonly status: 'operated' | 'blocked' | 'paused' | 'civic-works';
  readonly paid: Readonly<Partial<Resources>>;
  readonly residents: number;
  readonly power: number;
  readonly woodland: number;
  readonly river: number;
}
export interface GovernmentHouseholdCheckpoint {
  readonly cityId: string;
  readonly required: number;
  readonly paid: number;
  readonly growthPaid: number;
  readonly shortfall: number;
  readonly population: number;
  readonly wellbeing: number;
}
export interface GovernmentCashflowBeat {
  readonly beat: number;
  readonly netOutput: Readonly<Resources>;
  readonly closing: Readonly<Resources>;
  readonly constructionWork: Readonly<Record<string, number>>;
  readonly operations: readonly GovernmentOperationCheckpoint[];
  readonly households: readonly GovernmentHouseholdCheckpoint[];
  readonly institutionsFunded: boolean;
}
export interface GovernmentFundingFailure { readonly beat: number; readonly stage: 'opening' | 'households' | 'civic' | 'tail'; readonly key: string }
export interface GovernmentCashflowAssessment {
  readonly supported: boolean;
  readonly reason: string;
  readonly diagnosticOnly: boolean;
  readonly forecastBeats: number;
  readonly protectedHorizon: number;
  readonly projectionBeatLimit: number;
  readonly paidCredits: number;
  readonly spentReformCompletionEventId: string | null;
  readonly targetEffectiveRound: number;
  readonly policyLockUntilRound: number;
  readonly governmentLockUntilRound: number;
  readonly netArrangementGain: number;
  readonly netResourceDelta: Readonly<Resources>;
  readonly proposedValue: number;
  readonly retainedValue: number;
  readonly priorityGain: number;
  readonly bonusScience: number;
  readonly marginalOutput: Readonly<Resources>;
  readonly reservedPromises: Readonly<Resources>;
  readonly firstAdverseCheckpoint: GovernmentFundingFailure | null;
  readonly unpricedPopulationDelta: number;
  readonly unpricedConstructionWorkDelta: number;
  readonly proposedBeats: readonly GovernmentCashflowBeat[];
  readonly retainedBeats: readonly GovernmentCashflowBeat[];
}
interface Projection {
  value: number;
  output: Resources;
  bonusScience: number;
  beats: GovernmentCashflowBeat[];
  cities: City[];
  reservationFailure: { reason: string; checkpoint: GovernmentFundingFailure } | null;
}
interface Pair { retained: Projection; neutral: Projection; promises: ReturnType<typeof exchangePromisedResources> }

const empty = (): Resources => ({ food: 0, materials: 0, energy: 0, credits: 0, science: 0, culture: 0 });
const q = (value: number): number => Math.round(value * 100) / 100;
const priority = (assignment: PolicyAssignment): boolean => POLICIES.find(policy => policy.id === assignment.policyId)?.exclusiveGroup === LEARNING_PATRONAGE_RULES.exclusiveGroup;
const projectionBeatLimit = KNOWLEDGE_RULES.studySeasons * KNOWLEDGE_RULES.maximumCadence;
const keyOf = (cityId: string, kind: string, id: string | number): string => `${cityId}/${kind}/${id}`;
const difference = (proposed: Readonly<Resources>, retained: Readonly<Resources>): Resources => Object.fromEntries(RESOURCE_IDS.map(id => [id, q(proposed[id] - retained[id])])) as Resources;
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.freeze(value); for (const nested of Object.values(value)) freeze(nested); }
  return value;
}

function horizon(state: WorldState, civId: number, valueBeats: number): number {
  let result = valueBeats + CIVIC_RULES.commitmentBeats;
  for (const compact of state.knowledge?.active ?? []) if (compact.status === 'accepted' && (compact.terms.teacherId === civId || compact.terms.learnerId === civId)) result = Math.max(result, compact.deadlineRound - state.round);
  for (const charter of state.relief?.active ?? []) if (charter.status === 'accepted' && (charter.terms.donorId === civId || charter.terms.recipientId === civId)) result = Math.max(result, charter.dueRound - state.round);
  for (const project of state.publicProjects ?? []) if (project.status === 'committed' && (project.proposer === civId || project.recipient === civId)) result = Math.max(result, project.dueRound - state.round);
  for (const route of state.routes) if (route.agreement?.enabled && (route.owner === civId || route.partner === civId)) result = Math.max(result, route.agreement.nextDeliveryRound - state.round);
  for (const incident of state.border?.active ?? []) for (const party of incident.defender ? [incident.initiator, incident.defender] : [incident.initiator]) if (party.departure.actorId === civId && party.returned === null) result = Math.max(result, party.departure.returnByRound - state.round);
  return result;
}

function dependencyFailure(state: WorldState, civId: number): string | null {
  if (state.civicWorks?.active.some(commission => commission.civId === civId)) return 'active civic-works fees, donor substitution and earlier construction are outside this government forecast.';
  const actor = state.civilizations.find(candidate => candidate.id === civId)!;
  if (state.border?.active.some(incident => incident.initiatorId === civId || incident.defenderId === civId)) return 'active border clashes and returning residents are outside this bounded dependency closure.';
  if (state.spaceflight?.civilizations[civId]?.activeMission || state.spaceflight?.civilizations[civId]?.colony) return 'active off-world commitments are outside this bounded dependency closure.';
  const intakes = state.cities.filter(city => Object.values(city.improvements ?? {}).some(improvement => improvement.improvementId === 'river-intake' && improvement.operation.enabled)
    || city.construction?.active && 'kind' in city.construction.active && city.construction.active.kind === 'improvement' && city.construction.active.improvementId === 'river-intake');
  if (intakes.some(city => city.civId === civId) && intakes.some(city => city.civId !== civId)) return 'mixed-owner river competition depends on external funding and is unsupported; no already-withdrawn flow is promised.';
  for (const city of citiesOf(state, civId)) {
    for (const definition of BUILDINGS.filter(building => city.buildings.includes(building.id) || city.construction?.active && !('kind' in city.construction.active) && city.construction.active.buildingId === building.id)) {
      const adjacency = definition.district?.adjacency; const tileId = city.districtSites?.[definition.id] ?? city.construction?.active?.tileId;
      const site = state.tiles.find(tile => tile.id === tileId);
      if (!site || !adjacency || !('improvement' in adjacency) && !('wonder' in adjacency)) continue;
      if (state.cities.some(other => {
        const order = other.construction?.active; const target = state.tiles.find(tile => tile.id === order?.tileId);
        return other.civId !== civId && order && 'kind' in order && target && hexDistance(site, target) === 1 && (order.kind === 'wonder' && adjacency.wonder || order.kind === 'improvement' && adjacency.improvement === order.improvementId);
      })) return 'neighboring foreign paid construction can change productive adjacency outside this bounded dependency closure.';
    }
    if (['bronze-working', 'industrialization'].includes(actor.researchTarget) && (Object.values(city.improvements ?? {}).some(improvement => improvement.improvementId === 'mine') || city.construction?.active && 'kind' in city.construction.active && city.construction.active.kind === 'improvement' && city.construction.active.improvementId === 'mine')) return 'the current research target could reveal standing Mine inputs outside this bounded research dependency closure.';
    const order = city.construction?.active; if (!order) continue;
    if ('kind' in order && order.kind !== 'improvement') return 'contested wonder or route completion is outside this bounded productive quote.';
    const definition = 'kind' in order ? IMPROVEMENTS.find(item => item.id === order.improvementId) : BUILDINGS.find(item => item.id === order.buildingId);
    if (!definition || !hasFeatures(state, definition.requiredFeatures)) return 'an existing paid order lacks its released productive definition.';
    if ('effects' in definition && definition.effects.some(effect => effect.kind !== 'city' || effect.field === 'population' || effect.amount < 0)) return 'an existing paid order has effects outside this bounded productive quote.';
  }
  return null;
}

function promiseDependencyFailure(state: WorldState, civId: number, promises: Pair['promises']): string | null {
  const cities = citiesOf(state, civId);
  const routes = state.routes.filter(route => route.agreement?.enabled && (route.owner === civId || route.partner === civId));
  const incomingFood = routes.some(route => { const terms = route.agreement!.terms; return ((route.owner === civId ? terms.recipientCargo : terms.proposerCargo).food ?? 0) > 0; })
    || state.relief?.active.some(charter => charter.status === 'accepted' && charter.terms.recipientId === civId && charter.terms.food > 0);
  const incomingStrategic = routes.some(route => STRATEGIC_RESOURCE_IDS.some(id => (route.agreement!.terms.strategicCargo?.[route.owner === civId ? 'recipient' : 'proposer'][id] ?? 0) > 0));
  if ((promises.ordinary.food > 0 || incomingFood) && cities.some(city => {
    const order = city.construction?.active;
    const building = order && !('kind' in order) ? BUILDINGS.find(item => item.id === order.buildingId) : undefined;
    return city.population < cityGrowthFacts(state, city).capacity || (building?.housing ?? 0) > 0
      || building?.effects.some(effect => effect.kind === 'city' && effect.field === 'wellbeing' && effect.amount > 0);
  })) return 'promised or incoming Food has unescrowed growth or housing dependencies; its actual due-payment timing is unsupported.';
  if ((incomingStrategic || STRATEGIC_RESOURCE_IDS.some(id => (promises.strategic[id] ?? 0) > 0)) && cities.some(city => Object.values(city.improvements ?? {}).some(improvement => improvement.improvementId === 'mine' && improvement.operation.enabled)
    || city.construction?.active && 'kind' in city.construction.active && city.construction.active.kind === 'improvement' && city.construction.active.improvementId === 'mine')) return 'promised or incoming strategic cargo has Mine storage and extraction dependencies; payment cannot free capacity before its actual due beat.';
  return null;
}

function operations(cities: readonly City[]): GovernmentOperationCheckpoint[] {
  return cities.flatMap(city => [
    ...Object.entries(city.buildingOperations ?? {}).flatMap(([id, operation]) => operation.lastResult ? [{ key: keyOf(city.id, 'building', id), status: operation.lastResult.status, paid: { ...operation.lastResult.paid }, residents: operation.lastResult.residents?.allocated ?? 0, power: operation.lastResult.localPower?.consumed ?? 0, woodland: 0, river: 0 }] : []),
    ...Object.values(city.improvements ?? {}).flatMap(improvement => improvement.operation.lastResult ? [{ key: keyOf(city.id, 'improvement', improvement.tileId), status: improvement.operation.lastResult.status, paid: { ...improvement.operation.lastResult.paid }, residents: improvement.operation.lastResult.residents.allocated, power: 0, woodland: improvement.operation.lastResult.woodland?.harvested ?? 0, river: improvement.operation.lastResult.river?.withdrawn ?? 0 }] : []),
  ]);
}

function tailFailure(state: WorldState, proposed: Projection, retained: Projection): string | null {
  for (const city of proposed.cities) {
    const baseline = retained.cities.find(candidate => candidate.id === city.id)!;
    if (city.population > baseline.population) return `additional ${city.id} household liabilities remain beyond the bounded protection tail.`;
    if (city.population < cityGrowthFacts(state, city).capacity && (city.wellbeing > baseline.wellbeing || proposed.beats.at(-1)!.closing.food > retained.beats.at(-1)!.closing.food)) return `additional ${city.id} growth timing liabilities remain beyond the bounded protection tail.`;
    const opening = state.cities.find(candidate => candidate.id === city.id)!.construction?.active;
    if (!opening || 'kind' in opening && opening.kind !== 'improvement') continue;
    const definition = 'kind' in opening ? IMPROVEMENTS.find(item => item.id === opening.improvementId) : BUILDINGS.find(item => item.id === opening.buildingId);
    const liability = definition && ('residentsRequired' in definition || paidRecipe(definition) || (definition.housing ?? 0) > 0 || definition.effects.some(effect => effect.kind === 'city' && effect.field === 'wellbeing' && effect.amount > 0));
    if (liability && (city.construction?.active?.workDone ?? opening.workRequired) > (baseline.construction?.active?.workDone ?? opening.workRequired)) return `advanced ${city.id} paid recipe or growth liabilities remain beyond the bounded protection tail.`;
  }
  return null;
}

function adverse(proposed: Projection, retained: Projection): { reason: string; checkpoint: GovernmentFundingFailure } | null {
  for (const [index, beat] of proposed.beats.entries()) {
    const baseline = retained.beats[index]!;
    const fail = (stage: GovernmentFundingFailure['stage'], key: string, reason: string) => ({ reason, checkpoint: { beat: beat.beat, stage, key } });
    if (!beat.institutionsFunded) return fail('opening', 'accepted-institution', 'an accepted institution would lack its protected opening inputs, residents or Power.');
    for (const operation of baseline.operations) if (operation.status === 'operated' && beat.operations.find(candidate => candidate.key === operation.key)?.status !== 'operated') return fail('opening', operation.key, `${operation.key} loses baseline-funded opening inputs, residents, Power or finite local support.`);
    for (const operation of beat.operations) if (!baseline.operations.some(candidate => candidate.key === operation.key) && operation.status === 'blocked') return fail('opening', operation.key, `advanced ${operation.key} lacks its first actual opening inputs, residents, Power or finite local support.`);
    for (const town of beat.households) {
      const current = baseline.households.find(candidate => candidate.cityId === town.cityId)!;
      if (town.shortfall > current.shortfall) return fail('households', town.cityId, `${town.cityId} acquires an earlier or larger household Food shortfall.`);
      if (current.shortfall > 0 && (town.required > current.required || town.growthPaid > current.growthPaid)) return fail('households', town.cityId, `${town.cityId} adds household liabilities to an already-underfunded baseline.`);
    }
    if (baseline.households.some(town => town.shortfall > 0)) for (const operation of beat.operations) {
      const current = baseline.operations.find(candidate => candidate.key === operation.key);
      if (operation.status === 'operated' && (!current || RESOURCE_IDS.some(id => (operation.paid[id] ?? 0) > (current.paid[id] ?? 0)))) return fail('opening', operation.key, `${operation.key} adds operating liabilities to an already-underfunded baseline.`);
    }
  }
  return null;
}

export function createGovernmentCashflowPolicy(state: WorldState, civId: number, weights: Readonly<Resources>, priorities: BehaviorProfile['priorities']) {
  const actor = state.civilizations.find(candidate => candidate.id === civId);
  const revision = state.revision; const round = state.round;
  const cache = new Map<string, GovernmentCashflowAssessment>(); const baselines = new Map<string, Pair>();
  const counts = { projections: 0, baselineProjections: 0, projectedBeats: 0, cacheHits: 0, projectionBeatLimit };
  const project = (valueBeats: number, protectedHorizon: number, promises: Pair['promises'], action: ArrangementAction | null, neutral: boolean): Projection => {
    counts.projections++;
    const projected = structuredClone(state); const payer = projected.civilizations.find(candidate => candidate.id === civId)!;
    if (action) adoptGovernment(projected, civId, action.governmentId, action.assignments, []);
    if (neutral) {
      if (payer.government?.active) payer.government.active.assignments = payer.government.active.assignments.filter(assignment => !priority(assignment));
      if (payer.government?.pending) payer.government.pending.targetAssignments = payer.government.pending.targetAssignments.filter(assignment => !priority(assignment));
    }
    const research = TECHNOLOGIES.find(technology => technology.id === actor!.researchTarget);
    let remaining = research ? Math.max(0, research.cost - actor!.researchProgress) : 0;
    const result: Projection = { value: 0, output: empty(), bonusScience: 0, beats: [], cities: [], reservationFailure: null };
    const protect = (beat: number, stage: GovernmentFundingFailure['stage'], key: string): void => {
      const ordinary = RESOURCE_IDS.find(id => !Number.isSafeInteger(Math.round(payer.resources[id] * 100)) || q(payer.resources[id]) < promises.ordinary[id]);
      const strategic = STRATEGIC_RESOURCE_IDS.find(id => !Number.isSafeInteger(payer.strategicResources?.[id] ?? 0) || (payer.strategicResources?.[id] ?? 0) < (promises.strategic[id] ?? 0));
      if (ordinary || strategic) result.reservationFailure ??= { reason: `${key} cannot retain promised ${ordinary ?? strategic} at its actual ${stage} checkpoint; reservations are not an earlier physical payment.`, checkpoint: { beat, stage, key } };
    };
    const ownCities = citiesOf(projected, civId);
    for (let beat = 1; beat <= protectedHorizon; beat++) {
      counts.projectedBeats++; projected.round++;
      const events: GameEvent[] = []; const woodland = prepareWoodlandBeat(projected);
      const work = new Map([...openingConstructionWork(projected)].filter(([cityId]) => ownCities.some(city => city.id === cityId)));
      const before = { ...payer.resources }; const river = allocateOperations(projected, woodland);
      const funded = operations(ownCities); const net = difference(payer.resources, before); protect(beat, 'opening', 'operation allocation');
      for (const city of ownCities.toSorted((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)) extractCityMetals(projected, city);
      const households: GovernmentHouseholdCheckpoint[] = [];
      let producedScience = 0; let producedCulture = 0;
      for (const city of ownCities) {
        const foodBefore = payer.resources.food; const beforeProduction = { ...payer.resources };
        const production = produceCity(projected, city); const output = difference(payer.resources, beforeProduction);
        producedScience = q(producedScience + production.science); producedCulture = q(producedCulture + production.culture);
        if (beat <= valueBeats) for (const operation of Object.values(city.buildingOperations ?? {})) result.bonusScience = q(result.bonusScience + (operation.lastResult?.policyContribution?.bonusScience ?? 0));
        supplyCity(projected, city, events, production.food, foodBefore);
        const supply = city.lastFoodSupply!; protect(beat, 'households', city.id);
        households.push({ cityId: city.id, required: supply.required, paid: supply.paid, growthPaid: supply.growthPaid, shortfall: q(supply.required - supply.paid), population: city.population, wellbeing: city.wellbeing });
        for (const id of RESOURCE_IDS) net[id] = q(net[id] + output[id] - (id === 'food' ? supply.paid + supply.growthPaid : 0));
      }
      const usefulScience = q(Math.min(producedScience, remaining)); remaining = q(remaining - usefulScience);
      net.science = q(net.science - producedScience + usefulScience);
      if (beat <= valueBeats) for (const id of RESOURCE_IDS) {
        result.output[id] = q(result.output[id] + net[id]);
        result.value += net[id] * weights[id] * (id === 'science' ? priorities.research : priorities.construction) / beat;
      }
      recordWoodlands(projected, woodland, events); recordRiverFlow(projected, river, events);
      resolveCivics(projected, civId, producedCulture, events); protect(beat, 'civic', 'current civic investment');
      result.beats.push({ beat, netOutput: net, closing: { ...payer.resources }, constructionWork: Object.fromEntries(work), operations: funded, households, institutionsFunded: selectedInstitutionsFunded(projected, civId) });
      resolveConstruction(projected, work, events); resolveGovernmentTransitions(projected, events);
    }
    result.cities = ownCities; return result;
  };
  const evaluate = (action: ArrangementAction, diagnosticOnly = false): GovernmentCashflowAssessment => {
    const key = JSON.stringify([action.governmentId, canonicalAssignments(action.assignments), diagnosticOnly]);
    const transition = !diagnosticOnly && actor?.government?.active && actor.government.active.governmentId !== action.governmentId ? CIVIC_RULES.transitionBeats : 0;
    const forecastBeats = CIVIC_RULES.commitmentBeats + transition;
    const protectedHorizon = horizon(state, civId, forecastBeats);
    const price = actor && !diagnosticOnly ? governmentPrice(state, civId, action.governmentId) : { credits: 0, completionEventId: null };
    const targetEffectiveRound = diagnosticOnly ? actor?.government?.active?.effectiveRound ?? round : round + transition;
    const initial: GovernmentCashflowAssessment = {
      supported: false, reason: '', diagnosticOnly, forecastBeats, protectedHorizon, projectionBeatLimit, paidCredits: price.credits, spentReformCompletionEventId: price.completionEventId,
      targetEffectiveRound, policyLockUntilRound: diagnosticOnly ? actor?.government?.active?.policyLockUntilRound ?? round : targetEffectiveRound + CIVIC_RULES.commitmentBeats,
      governmentLockUntilRound: transition || !actor?.government?.active ? targetEffectiveRound + CIVIC_RULES.commitmentBeats : actor.government.active.governmentLockUntilRound,
      netArrangementGain: 0, netResourceDelta: empty(), proposedValue: 0, retainedValue: 0, priorityGain: 0, bonusScience: 0, marginalOutput: empty(), reservedPromises: empty(),
      firstAdverseCheckpoint: null, unpricedPopulationDelta: 0, unpricedConstructionWorkDelta: 0, proposedBeats: [], retainedBeats: [],
    };
    const refuse = (reason: string, fields: Partial<GovernmentCashflowAssessment> = {}): GovernmentCashflowAssessment => freeze({ ...initial, ...fields, reason: `Government arrangement held: ${reason}` });
    if (state.revision !== revision || state.round !== round) return refuse('the chooser snapshot changed; create a new evaluator.');
    const cached = cache.get(key); if (cached) { counts.cacheHits++; return cached; }
    const save = (result: GovernmentCashflowAssessment) => { const immutable = freeze(result); cache.set(key, immutable); return immutable; };
    if (!actor || !hasFeatures(state, [LEARNING_PATRONAGE_RULES.featureId, 'food-budget'])) return save(refuse('the released civilization, priority and household accounting are required.'));
    if (!diagnosticOnly) { const blocked = governmentActionBlock(state, civId, action.governmentId, action.assignments); if (blocked) return save(refuse(blocked)); }
    if (!Number.isSafeInteger(protectedHorizon) || protectedHorizon > projectionBeatLimit || !Number.isSafeInteger(round + protectedHorizon)) return save(refuse(`the actual protected deadline exceeds the ${projectionBeatLimit}-beat bounded closure; it is not truncated.`));
    const dependency = dependencyFailure(state, civId); if (dependency) return save(refuse(dependency));
    const baselineKey = `${forecastBeats}/${protectedHorizon}`;
    let pair = baselines.get(baselineKey);
    const promises = pair?.promises ?? exchangePromisedResources(state, civId, protectedHorizon);
    for (const id of RESOURCE_IDS) if (!Number.isSafeInteger(Math.round(promises.ordinary[id] * 100)) || actor.resources[id] < promises.ordinary[id] + (id === 'credits' ? price.credits : 0)) return save(refuse(`opening ${id} cannot pay the actual arrangement while retaining explicit accepted promises; incoming receipts are not financing.`, { reservedPromises: promises.ordinary }));
    for (const id of STRATEGIC_RESOURCE_IDS) if (!Number.isSafeInteger(promises.strategic[id] ?? 0) || (actor.strategicResources?.[id] ?? 0) < (promises.strategic[id] ?? 0)) return save(refuse(`opening ${id} cannot retain explicit accepted promises.`, { reservedPromises: promises.ordinary }));
    const promiseDependency = promiseDependencyFailure(state, civId, promises); if (promiseDependency) return save(refuse(promiseDependency, { reservedPromises: promises.ordinary }));
    if (!pair) {
      const retained = project(forecastBeats, protectedHorizon, promises, null, false);
      const neutral = actor.government?.active?.assignments.some(priority) ? project(forecastBeats, protectedHorizon, promises, null, true) : retained;
      counts.baselineProjections += neutral === retained ? 1 : 2; pair = { retained, neutral, promises }; baselines.set(baselineKey, pair);
    }
    const retained = pair.retained;
    const proposed = diagnosticOnly ? retained : project(forecastBeats, protectedHorizon, promises, action, false);
    const fields = { reservedPromises: promises.ordinary, proposedBeats: proposed.beats, retainedBeats: retained.beats,
      unpricedPopulationDelta: proposed.cities.reduce((sum, city, index) => sum + city.population - retained.cities[index]!.population, 0),
      unpricedConstructionWorkDelta: q(proposed.cities.reduce((sum, city, index) => {
        const original = state.cities.find(item => item.id === city.id)!.construction?.active;
        return sum + (original ? (city.construction?.active?.workDone ?? original.workRequired) - (retained.cities[index]!.construction?.active?.workDone ?? original.workRequired) : 0);
      }, 0)),
    };
    const reservation = retained.reservationFailure ?? proposed.reservationFailure;
    if (reservation) return save(refuse(`${retained.reservationFailure ? 'Unchanged baseline: ' : ''}${reservation.reason}`, { ...fields, firstAdverseCheckpoint: reservation.checkpoint }));
    const failure = adverse(proposed, retained); if (failure) return save(refuse(failure.reason, { ...fields, firstAdverseCheckpoint: failure.checkpoint }));
    const tail = tailFailure(state, proposed, retained); if (tail) return save(refuse(tail, { ...fields, firstAdverseCheckpoint: { beat: protectedHorizon, stage: 'tail', key: 'additional-liabilities' } }));
    const neutral = diagnosticOnly ? pair.neutral : action.assignments.some(priority) || actor.government?.active?.assignments.some(priority) && transition ? project(forecastBeats, protectedHorizon, promises, action, true) : proposed;
    const proposedValue = proposed.value - neutral.value; const retainedValue = retained.value - pair.neutral.value;
    const netArrangementGain = diagnosticOnly ? 0 : proposed.value - retained.value - price.credits * weights.credits;
    const netResourceDelta = difference(proposed.output, retained.output); netResourceDelta.credits = q(netResourceDelta.credits - price.credits);
    const bonusScience = q(proposed.bonusScience - neutral.bonusScience);
    const reason = `Compared with keeping government: conditional gain ${q(netArrangementGain)} over ${forecastBeats} beats; ${price.credits} Credits${price.completionEventId ? ', spends reform' : ''}. Protect ${protectedHorizon} beats; policy lock to round ${initial.policyLockUntilRound}. Later own income only; no future choices or incoming funds. Science capped; growth/work unpriced.`;
    return save({ ...initial, ...fields, supported: true, reason, netArrangementGain, netResourceDelta, proposedValue, retainedValue, priorityGain: proposedValue - retainedValue, bonusScience, marginalOutput: difference(proposed.output, neutral.output) });
  };
  return Object.assign((action: ArrangementAction) => evaluate(action), {
    compareUnchanged: () => evaluate({ type: 'adopt-government', governmentId: actor?.government?.active?.governmentId ?? 'chiefdom', assignments: actor?.government?.active?.assignments ?? [] }, true),
    diagnostics: () => Object.freeze({ ...counts }),
  });
}
