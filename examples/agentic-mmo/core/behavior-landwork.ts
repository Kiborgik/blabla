import { exchangePromisedResources } from './behavior-knowledge.ts';
import { foodAllocation, selectedInstitutionsFunded } from './behavior-paid-food-sites.ts';
import { BUILDINGS, ECONOMY_RULES, IMPROVEMENTS, RESOURCE_IDS, STRATEGIC_RESOURCE_IDS, TURN_RULES } from './content.ts';
import { borderReturnReservations } from './simulation/border-incidents.ts';
import { buildingEligibility, improvementEligibility } from './simulation/capabilities.ts';
import { constructionWork, requiredConstructionWork } from './simulation/construction.ts';
import { buildingBaseProduction, districtSiteBlock } from './simulation/districts.ts';
import { allocatedCityFoodProduction, householdFoodUpkeep } from './simulation/food-security.ts';
import { governmentModifiers } from './simulation/government.ts';
import { hasFeatures } from './simulation/history.ts';
import { improvementSiteBlock, orderedImprovements } from './simulation/improvements.ts';
import { availableCampusHighGround } from './simulation/observatory.ts';
import { paidRecipe, productiveBuildings, projectOperationAllocation } from './simulation/operations.ts';
import { siteProduction } from './simulation/sites.ts';
import { createTerritoryPlanner } from './simulation/territory.ts';
import { usesIndependentTurns } from './simulation/turns.ts';
import { availableMountainCatchments } from './simulation/water.ts';
import { wonderBaseProduction } from './simulation/wonders.ts';
import { cityProductivity } from './simulation/world.ts';
import type { BuildingDefinition, ConstructionOrder, GameAction, ImprovementDefinition, Resources, StrategicResources, WorldState } from './types.ts';

export interface FundedLandworkQuote {
  readonly kind: 'conditional-landwork';
  readonly revision: number;
  readonly cityId: string;
  readonly tileId: number;
  readonly action: Extract<GameAction, { type: 'improve' | 'build' }>;
  readonly orderId: string | null;
  readonly acquisitionCost: Readonly<Partial<Resources>>;
  readonly setupCost: Readonly<Partial<Resources>>;
  readonly operatingInputs: Readonly<Partial<Resources>>;
  readonly strategicInputs: Readonly<StrategicResources>;
  readonly waitBeats: number;
  readonly acquisitionDelayBeats: number;
  readonly startDelayBeats: number;
  readonly workBeats: number;
  readonly firstOperationBeat: number;
  readonly protectedHorizon: number;
  readonly protectedBudget: Readonly<{ ordinary: Readonly<Resources>; strategic: Readonly<StrategicResources> }>;
  readonly marginalOutput: Readonly<Resources>;
  readonly retainedOperations: readonly string[];
  readonly allocations: readonly { key: string; required: number; available: number; allocated: number }[];
}
export interface FundedCharcoalOperationQuote extends Omit<FundedLandworkQuote, 'action'> {
  readonly targetOperationBeats: number;
  readonly requiredByBorder: boolean;
  readonly action: Extract<GameAction, { type: 'set-improvement-operation' }>;
}
export interface LandworkAssessment { readonly quotes: readonly FundedLandworkQuote[]; readonly reason: string | null }
interface Footprint { key: string; cityId: string; ordinary: Partial<Resources>; strategic: StrategicResources }
interface PendingUse { cityId: string; order: ConstructionOrder; definition: BuildingDefinition | ImprovementDefinition; footprint: Footprint | null }
interface Candidate { action: FundedLandworkQuote['action']; definition: BuildingDefinition | ImprovementDefinition; work: number; footprint: Footprint | null }

const empty = (): Resources => ({ food: 0, materials: 0, energy: 0, credits: 0, science: 0, culture: 0 });
const quantize = (value: number): number => Math.round(value * 100) / 100;
const add = (budget: Resources, cost: Partial<Resources>, count = 1): void => { for (const resource of RESOURCE_IDS) budget[resource] = quantize(budget[resource] + (cost[resource] ?? 0) * count); };
const addStrategic = (budget: StrategicResources, cost: StrategicResources, count = 1): void => { for (const resource of STRATEGIC_RESOURCE_IDS) budget[resource] = (budget[resource] ?? 0) + (cost[resource] ?? 0) * count; };
const safe = (ordinary: Partial<Resources>, strategic: StrategicResources = {}): boolean => RESOURCE_IDS.every(id => Number.isFinite(ordinary[id] ?? 0) && (ordinary[id] ?? 0) >= 0 && Number.isSafeInteger(Math.round((ordinary[id] ?? 0) * 100))) && STRATEGIC_RESOURCE_IDS.every(id => Number.isSafeInteger(strategic[id] ?? 0) && (strategic[id] ?? 0) >= 0);
const buildingKey = (cityId: string, id: string): string => `${cityId}/building/${id}`;
const siteKey = (cityId: string, tileId: number): string => `${cityId}/site/${tileId}`;
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const nested of Object.values(value)) freeze(nested); Object.freeze(value); }
  return value;
}
function operated(state: WorldState, civId: number): Map<string, Footprint> {
  const result = new Map<string, Footprint>();
  for (const city of state.cities.filter(city => city.civId === civId)) {
    for (const [id, operation] of Object.entries(city.buildingOperations ?? {})) if (operation.lastResult?.status === 'operated') {
      const key = buildingKey(city.id, id); result.set(key, { key, cityId: city.id, ordinary: { ...operation.lastResult.paid }, strategic: { ...operation.lastResult.strategicPaid } });
    }
    for (const improvement of Object.values(city.improvements ?? {})) if (improvement.operation.lastResult?.status === 'operated') {
      const key = siteKey(city.id, improvement.tileId); result.set(key, { key, cityId: city.id, ordinary: { ...improvement.operation.lastResult.paid }, strategic: {} });
    }
  }
  return result;
}
function installFootprint(state: WorldState, cityId: string, definition: BuildingDefinition | ImprovementDefinition, tileId?: number): void {
  const city = state.cities.find(city => city.id === cityId)!;
  if ('residentsRequired' in definition) {
    city.improvements ??= {};
    city.improvements[String(tileId)] = { improvementId: definition.id, tileId: tileId!, completion: { kind: 'improvement', orderId: 'conditional-landwork', cityId, improvementId: definition.id, tileId: tileId!, startedRound: state.round, completedRound: state.round, paid: {}, workRequired: definition.requiredWork, eventId: 'conditional-landwork' }, operation: { enabled: true, lastResult: null } };
  } else {
    city.buildings = [...city.buildings, definition.id];
    if (definition.district) city.districtSites = { ...city.districtSites, [definition.id]: tileId! };
    if (paidRecipe(definition)) { city.buildingOperations ??= {}; city.buildingOperations[definition.id] = { enabled: true, lastResult: null }; }
  }
}
function withoutPendingOutput(state: WorldState, pending: readonly PendingUse[]): WorldState {
  const cities = state.cities.map(city => {
    const use = pending.find(use => use.cityId === city.id); if (!use) return city;
    if ('residentsRequired' in use.definition) {
      const improvements = { ...city.improvements }; delete improvements[String(use.order.tileId)]; return { ...city, improvements };
    }
    return { ...city, buildings: city.buildings.filter(id => id !== use.definition.id) };
  });
  return { ...state, cities };
}
export function projectedLandworkOutput(state: WorldState, civId: number): Resources {
  const total = empty();
  for (const city of state.cities.filter(city => city.civId === civId)) {
    const government = governmentModifiers(state, civId); const productivity = cityProductivity(city);
    const buildings = productiveBuildings(state, city); const free = buildings.filter(building => !paidRecipe(building)); const paid = buildings.filter(paidRecipe);
    const site = state.tiles.find(tile => tile.id === city.tileId); const terrain = site ? siteProduction(state, site) : {};
    const passive = [...free.map(building => buildingBaseProduction(state, city, building)), wonderBaseProduction(state, city)];
    const improvements = hasFeatures(state, ['worked-land']) ? orderedImprovements(city).filter(item => item.operation.lastResult?.status === 'operated') : [];
    for (const resource of RESOURCE_IDS) {
      if (resource === 'food') { total.food = quantize(total.food + allocatedCityFoodProduction(state, city).total); continue; }
      const raw = (ECONOMY_RULES.baseProduction[resource] ?? 0) + (government.baseProduction[resource] ?? 0) + ((ECONOMY_RULES.focusProduction[city.focus] as Partial<Resources>)[resource] ?? 0)
        + (terrain[resource] ?? 0) + passive.reduce((sum, resources) => sum + (resources[resource] ?? 0), 0)
        + paid.reduce((sum, building) => sum + (building.production[resource] ?? 0), 0)
        + improvements.reduce((sum, item) => sum + (IMPROVEMENTS.find(definition => definition.id === item.improvementId)?.production[resource] ?? 0), 0);
      total[resource] = quantize(total[resource] + quantize(raw * productivity * government.ordinaryOutputMultiplier));
    }
  }
  return total;
}

export function createLandworkPlanner(state: WorldState, civId: number) {
  const actor = state.civilizations.find(actor => actor.id === civId);
  const territory = createTerritoryPlanner(state);
  const quotes = new Map<string, LandworkAssessment>(); const ownedQuotes = new Map<string, readonly FundedLandworkQuote[]>();
  const preparations = new Map<string, { baseline: WorldState; retained: Map<string, Footprint>; pending: PendingUse[]; horizon: number; targetOperationBeats: number; requiredByBorder: boolean; failure: string | null }>();
  const prepare = (installed?: { cityId: string; tileId: number }) => {
    const key = installed ? siteKey(installed.cityId, installed.tileId) : 'construction';
    const existing = preparations.get(key); if (existing) return existing;
    const baseline = projectOperationAllocation(state, opening => {
      if (installed) opening.cities.find(city => city.id === installed.cityId)!.improvements![String(installed.tileId)]!.operation.enabled = false;
    }); const retained = operated(baseline, civId); const pending: PendingUse[] = [];
    const prepared = { baseline, retained, pending, horizon: 1, targetOperationBeats: 2, requiredByBorder: false, failure: null as string | null };
    preparations.set(key, prepared);
    const reject = (reason: string) => { prepared!.failure ??= reason; };
    if (!actor || !safe(actor.resources, actor.strategicResources)) reject('unsafe-accounting: opening resources are not safely representable');
    if (actor?.government?.pending) reject('government-transition: pending modifiers are not quoted');
    if (!selectedInstitutionsFunded(baseline, civId)) reject('selected-institution-unfunded: an accepted Studies institution lacks its current operation');
    for (const compact of state.knowledge?.active ?? []) if (compact.status === 'accepted' && (compact.terms.teacherId === civId || compact.terms.learnerId === civId)) prepared.horizon = Math.max(prepared.horizon, compact.deadlineRound - state.round);
    for (const charter of state.relief?.active ?? []) if (charter.status === 'accepted' && charter.terms.donorId === civId) prepared.horizon = Math.max(prepared.horizon, charter.dueRound - state.round);
    for (const project of state.publicProjects ?? []) if (project.status === 'committed' && (project.proposer === civId || project.recipient === civId)) prepared.horizon = Math.max(prepared.horizon, project.dueRound - state.round);
    for (const route of state.routes) if (route.agreement?.enabled && (route.owner === civId || route.partner === civId)) {
      if (!Number.isSafeInteger(route.agreement.terms.cadenceRounds) || route.agreement.terms.cadenceRounds < 1) reject('unsafe-accounting: invalid delivery cadence');
      prepared.horizon = Math.max(prepared.horizon, route.agreement.nextDeliveryRound - state.round);
    }
    for (const incident of state.border?.active ?? []) for (const party of incident.defender ? [incident.initiator, incident.defender] : [incident.initiator]) {
      if (party.departure.actorId !== civId || party.returned) continue;
      prepared.horizon = Math.max(prepared.horizon, party.departure.returnByRound - state.round);
      for (const obligation of party.departure.operationForecast) {
        const key = obligation.kind === 'building' ? buildingKey(obligation.cityId, obligation.id) : siteKey(obligation.cityId, obligation.tileId!);
        const target = installed && obligation.kind === 'improvement' && key === siteKey(installed.cityId, installed.tileId);
        const targetDefinition = target ? IMPROVEMENTS.find(definition => definition.id === 'charcoal-clearing') : undefined;
        const current: Footprint | undefined = targetDefinition ? { key, cityId: installed!.cityId, ordinary: targetDefinition.operatingInputs ?? {}, strategic: {} } : retained.get(key);
        if (targetDefinition) {
          prepared.requiredByBorder = true; prepared.targetOperationBeats = Math.max(prepared.targetOperationBeats, party.departure.returnByRound - state.round);
          if (obligation.id !== targetDefinition.id || obligation.residents !== targetDefinition.residentsRequired) reject('border-operation-unfunded: retained clearing recipe does not match its exact forecast');
        }
        if (!current || RESOURCE_IDS.some(id => (current.ordinary[id] ?? 0) !== (obligation.inputs[id] ?? 0)) || STRATEGIC_RESOURCE_IDS.some(id => (current.strategic[id] ?? 0) !== (obligation.strategicInputs[id] ?? 0))) reject('border-operation-unfunded: retained exact operation footprint is unavailable');
      }
    }
    for (const city of state.cities.filter(city => city.civId === civId)) {
      const order = city.construction?.active; if (!order) continue;
      if ('kind' in order && order.kind !== 'improvement') { reject(`unsupported-order: ${order.kind} completion is uncertain`); continue; }
      const definition = 'kind' in order ? IMPROVEMENTS.find(item => item.id === order.improvementId) : BUILDINGS.find(item => item.id === order.buildingId);
      if (!definition || !safe(definition.operatingInputs ?? {}, 'strategicInputs' in definition ? definition.strategicInputs ?? {} : {}) || !hasFeatures(state, definition.requiredFeatures)) { reject('unsupported-order: unknown or unreleased operation demand'); continue; }
      if (!Number.isFinite(order.workRequired) || !Number.isFinite(order.workDone) || order.workDone < 0 || order.workRequired < order.workDone || !Number.isSafeInteger(Math.round(order.workRequired * 100))) { reject('unsafe-accounting: invalid retained construction work'); continue; }
      const temporaryCity = { ...city, construction: { ...city.construction!, active: null } };
      const temporary = { ...state, cities: state.cities.map(item => item.id === city.id ? temporaryCity : item) };
      if ('residentsRequired' in definition) {
        if (improvementSiteBlock(temporary, temporaryCity, definition, order.tileId!)) { reject('unsupported-order-support: retained improvement site is no longer eligible'); continue; }
      } else {
        if ((definition.requiresBuildings ?? []).some(id => !city.buildings.includes(id))) { reject('unsupported-order-support: a current completed building prerequisite is missing'); continue; }
        if ((definition.localPowerOutput ?? 0) > 0 || definition.effects.some(effect => 'amount' in effect && effect.amount < 0)) { reject('unsupported-order-effects: unfinished Power or adverse effects are not projected'); continue; }
        if (city.buildings.includes(definition.id) || definition.district && (order.tileId === undefined || districtSiteBlock(temporary, temporaryCity, definition, order.tileId))) { reject('unsupported-order-support: retained building site is unavailable'); continue; }
        if (definition.siteRequirement === 'campus-high-ground' && (!('highGround' in order) || !order.highGround || !availableCampusHighGround(state, city).some(site => site.campusTileId === order.highGround!.campusTileId && site.sourceTileId === order.highGround!.sourceTileId))
          || definition.siteRequirement === 'mountain-catchment' && (!('catchmentTileId' in order) || !availableMountainCatchments(state, city).includes(order.catchmentTileId!))) { reject('unsupported-order-support: exact retained support is missing'); continue; }
      }
      const footprint = 'residentsRequired' in definition ? { key: siteKey(city.id, order.tileId!), cityId: city.id, ordinary: { ...definition.operatingInputs }, strategic: {} }
        : paidRecipe(definition) ? { key: buildingKey(city.id, definition.id), cityId: city.id, ordinary: { ...definition.operatingInputs }, strategic: { ...definition.strategicInputs } } : null;
      pending.push({ cityId: city.id, order, definition, footprint });
      if (footprint) retained.set(footprint.key, footprint);
    }
    if (!Number.isSafeInteger(prepared.horizon) || !Number.isSafeInteger(state.round + prepared.horizon)) reject('unsafe-accounting: protected horizon exceeds safe rounds');
    return prepared;
  };
  const assess = (cityId: string, tileId: number, operationOnly = false): LandworkAssessment => {
    const key = `${cityId}/${tileId}/${operationOnly}`; const cached = quotes.get(key); if (cached) return cached;
    const save = (result: LandworkAssessment) => { const observation = freeze(result); quotes.set(key, observation); return observation; };
    const refuse = (reason: string) => save({ quotes: [], reason });
    const city = state.cities.find(city => city.id === cityId && city.civId === civId); const tile = state.tiles.find(tile => tile.id === tileId);
    if (!actor || !city || !tile) return refuse('missing-exact-site: existing civilization, town and tile are required');
    const installed = operationOnly ? city.improvements?.[String(tileId)] : undefined;
    if (operationOnly && installed?.improvementId !== 'charcoal-clearing') return refuse('missing-installed-charcoal: operation requires its exact completed clearing');
    const shared = prepare(operationOnly ? { cityId, tileId } : undefined); if (shared.failure) return refuse(shared.failure);
    let acquisitionCost: Partial<Resources> = {}; let ownedState = state;
    if (tile.owner !== civId) {
      const purchase = territory.assess(civId, cityId, tileId); if (!purchase.quote || purchase.blocker) return refuse(`acquisition-ineligible: ${purchase.blocker}`);
      acquisitionCost = { ...purchase.quote.paid };
      ownedState = { ...state, tiles: state.tiles.map(item => item.id === tileId ? { ...item, owner: civId } : item), tileAcquisitions: { ...state.tileAcquisitions, [String(tileId)]: { ...purchase.quote, id: 'conditional-landwork', acquiredRound: state.round, eventId: 'conditional-landwork' } } };
    }
    const work = operationOnly ? 1 : constructionWork(state, city);
    if (!Number.isFinite(work) || work <= 0) return refuse('zero-construction-work: current town cannot progress a paid order');
    const active = operationOnly ? null : city.construction?.active;
    const waitBeats = active ? Math.max(1, Math.ceil(quantize(active.workRequired - active.workDone) / work)) : 0;
    if (!Number.isSafeInteger(waitBeats) || waitBeats > 2) return refuse('wait-horizon: retained paid order needs more than two beats');
    const acquisitionDelayBeats = tile.owner === civId ? 0 : usesIndependentTurns(state) ? Math.ceil(TURN_RULES.tacticalWindowMs / TURN_RULES.strategyIntervalMs) : 1;
    const startDelayBeats = Math.max(waitBeats, acquisitionDelayBeats);
    const candidates: Candidate[] = [];
    for (const original of IMPROVEMENTS.toSorted((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
      if (original.id === 'charcoal-clearing' && tile.owner !== civId || operationOnly && original.id !== installed!.improvementId) continue;
      const definition = operationOnly ? { ...original, cost: {}, requiredWork: 0 } : original;
      const eligibility = improvementEligibility(ownedState, civId, definition, cityId);
      if ((operationOnly ? !hasFeatures(state, definition.requiredFeatures) : eligibility.blockers.some(blocker => blocker.kind !== 'active-commitment')) || improvementSiteBlock(ownedState, city, definition, tileId, operationOnly)) continue;
      candidates.push({ action: { type: 'improve', cityId, tileId, improvementId: definition.id }, definition, work: definition.requiredWork, footprint: { key: siteKey(cityId, tileId), cityId, ordinary: { ...definition.operatingInputs }, strategic: {} } });
    }
    for (const definition of BUILDINGS.filter(item => !operationOnly && item.district).toSorted((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
      if (active && !('kind' in active) && active.buildingId === definition.id || definition.effects.length) continue;
      const eligibility = buildingEligibility(ownedState, civId, definition, cityId);
      if (eligibility.completed || eligibility.blockers.some(blocker => blocker.kind !== 'active-commitment') || districtSiteBlock(ownedState, city, definition, tileId)) continue;
      candidates.push({ action: { type: 'build', cityId, tileId, project: definition.id }, definition, work: requiredConstructionWork(definition.id), footprint: paidRecipe(definition) ? { key: buildingKey(cityId, definition.id), cityId, ordinary: { ...definition.operatingInputs }, strategic: { ...definition.strategicInputs } } : null });
    }
    const results: FundedLandworkQuote[] = []; let reason = 'no-eligible-use: no exact currently released improvement or district fits';
    for (const candidate of candidates) {
      const workBeats = Math.ceil(candidate.work / work); const firstOperationBeat = startDelayBeats + workBeats + 1; const horizon = Math.max(firstOperationBeat + 1, shared.horizon);
      if (!Number.isSafeInteger(workBeats) || workBeats < (operationOnly ? 0 : 1) || firstOperationBeat > 8) { reason = 'first-operation-horizon: candidate cannot operate within eight beats'; continue; }
      if (!Number.isSafeInteger(horizon) || !Number.isSafeInteger(state.round + horizon)) { reason = 'unsafe-accounting: protected horizon exceeds safe rounds'; continue; }
      const external = exchangePromisedResources(state, civId, horizon);
      const ordinary = { ...external.ordinary }; const strategic = { ...external.strategic };
      add(ordinary, acquisitionCost); add(ordinary, candidate.definition.cost);
      ordinary.food = quantize(ordinary.food + state.cities.filter(city => city.civId === civId).reduce((total, city) => total + householdFoodUpkeep(state, city.population + borderReturnReservations(state, city.id)), 0) * horizon);
      const allocationOrdinary = empty(); const allocationStrategic: StrategicResources = {};
      for (const footprint of shared.retained.values()) { add(ordinary, footprint.ordinary, horizon); addStrategic(strategic, footprint.strategic, horizon); add(allocationOrdinary, footprint.ordinary); addStrategic(allocationStrategic, footprint.strategic); }
      if (candidate.footprint) { add(ordinary, candidate.footprint.ordinary, operationOnly ? shared.targetOperationBeats : 2); addStrategic(strategic, candidate.footprint.strategic, operationOnly ? shared.targetOperationBeats : 2); add(allocationOrdinary, candidate.footprint.ordinary); addStrategic(allocationStrategic, candidate.footprint.strategic); }
      if (!safe(ordinary, strategic)) { reason = 'unsafe-accounting: protected costs exceed safe resource units'; continue; }
      if (RESOURCE_IDS.some(id => Math.round(actor.resources[id] * 100) < Math.round(ordinary[id] * 100)) || STRATEGIC_RESOURCE_IDS.some(id => (actor.strategicResources?.[id] ?? 0) < (strategic[id] ?? 0))) { reason = 'opening-budget: purchase, setup, households and protected operations or promises are not funded'; continue; }
      const projected = projectOperationAllocation(ownedState, opening => {
        const payer = opening.civilizations.find(item => item.id === civId)!;
        for (const id of RESOURCE_IDS) payer.resources[id] = quantize(payer.resources[id] - ordinary[id] + allocationOrdinary[id]);
        payer.strategicResources ??= {};
        for (const id of STRATEGIC_RESOURCE_IDS) payer.strategicResources[id] = (payer.strategicResources[id] ?? 0) - (strategic[id] ?? 0) + (allocationStrategic[id] ?? 0);
        for (const use of shared.pending) {
          const town = opening.cities.find(town => town.id === use.cityId)!; town.construction = { ...town.construction!, active: null };
          installFootprint(opening, use.cityId, use.definition, use.order.tileId);
        }
        installFootprint(opening, cityId, candidate.definition, tileId);
      });
      const allocations = operated(projected, civId);
      if ([...shared.retained.keys()].some(key => !allocations.has(key)) || candidate.footprint && !allocations.has(candidate.footprint.key) || !selectedInstitutionsFunded(projected, civId)) { reason = 'operation-displacement: exact current or paid-order inputs, residents or Power would be unavailable'; continue; }
      const actualOutput = withoutPendingOutput(projected, shared.pending); const protectedFood = foodAllocation(shared.baseline, civId); const proposedFood = foodAllocation(actualOutput, civId);
      if ([...protectedFood.producers].some(key => !proposedFood.producers.has(key))) { reason = 'food-producer-displacement: a productive current Food site would be lost'; continue; }
      const candidateAction = candidate.action;
      const localAllocations = projected.cities.filter(town => town.civId === civId).flatMap(town => [
        ...Object.entries(town.buildingOperations ?? {}).flatMap(([id, operation]) => operation.lastResult?.status === 'operated' ? [{ key: buildingKey(town.id, id), required: operation.lastResult.residents?.required ?? 0, available: operation.lastResult.residents?.available ?? 0, allocated: operation.lastResult.residents?.allocated ?? 0 }] : []),
        ...Object.values(town.improvements ?? {}).flatMap(site => site.operation.lastResult?.status === 'operated' ? [{ key: siteKey(town.id, site.tileId), required: site.operation.lastResult.residents.required, available: site.operation.lastResult.residents.available, allocated: site.operation.lastResult.residents.allocated }] : []),
      ]).sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
      const withoutCandidate: WorldState = { ...actualOutput, cities: actualOutput.cities.map(town => {
        if (town.id !== cityId) return town;
        if (candidateAction.type === 'build') return { ...town, buildings: town.buildings.filter(id => id !== candidateAction.project) };
        const improvements = { ...town.improvements }; delete improvements[String(tileId)]; return { ...town, improvements };
      }) };
      const before = projectedLandworkOutput(withoutCandidate, civId); const after = projectedLandworkOutput(actualOutput, civId); const marginalOutput = empty();
      for (const id of RESOURCE_IDS) marginalOutput[id] = quantize(after[id] - before[id]);
      if (!RESOURCE_IDS.every(id => Number.isSafeInteger(Math.round(marginalOutput[id] * 100))) || !RESOURCE_IDS.some(id => marginalOutput[id] > 0)) { reason = 'no-marginal-output: the exact funded use adds no safe current output'; continue; }
      results.push({ kind: 'conditional-landwork', revision: state.revision, cityId, tileId, action: candidate.action, orderId: active?.id ?? null, acquisitionCost, setupCost: { ...candidate.definition.cost }, operatingInputs: { ...candidate.definition.operatingInputs }, strategicInputs: { ...candidate.footprint?.strategic }, waitBeats, acquisitionDelayBeats, startDelayBeats, workBeats, firstOperationBeat, protectedHorizon: horizon, protectedBudget: { ordinary, strategic }, marginalOutput, retainedOperations: [...shared.retained.keys(), ...(operationOnly && shared.requiredByBorder ? [siteKey(cityId, tileId)] : [])].sort(), allocations: localAllocations });
    }
    return save({ quotes: results, reason: results.length ? null : reason });
  };
  return {
    quote: (cityId: string, tileId: number): LandworkAssessment => assess(cityId, tileId),
    charcoalOperation(cityId: string, tileId: number): FundedCharcoalOperationQuote | null {
      const quote = assess(cityId, tileId, true).quotes[0];
      return quote ? freeze({ ...quote, targetOperationBeats: prepare({ cityId, tileId }).targetOperationBeats, requiredByBorder: prepare({ cityId, tileId }).requiredByBorder, action: { type: 'set-improvement-operation', cityId, tileId, improvementId: 'charcoal-clearing', enabled: true } }) : null;
    },
    owned(cityId: string): readonly FundedLandworkQuote[] {
      const existing = ownedQuotes.get(cityId); if (existing) return existing;
      const city = state.cities.find(city => city.id === cityId && city.civId === civId);
      const result = freeze(city ? territory.nearby(city).filter(tile => tile.owner === civId).flatMap(tile => assess(cityId, tile.id).quotes) : []);
      ownedQuotes.set(cityId, result); return result;
    },
  };
}
