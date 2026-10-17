import { purchasedSiteBlock } from './site-binding.ts';
import { RESOURCE_IDS, TECHNOLOGIES, WONDERS, WONDER_RULES } from '../content.ts';
import type { ActionOption, City, ConstructionOrder, GameAction, GameEvent, Resources, WonderConstructionOrder, WonderDefinition, WorldState } from '../types.ts';
import type { CapabilityEligibility } from './capabilities.ts';
import { districtSiteOccupied } from './districts.ts';
import { emitEvent } from './events.ts';
import { hexDistance } from './geography.ts';
import { hasFeatures } from './history.ts';
import { completeResearch } from './research.ts';
import { civilizationById, transferCost } from './world.ts';

function quantize(value: number): number { return Math.round(value * 100) / 100; }
export function isWonderOrder(order: ConstructionOrder): order is WonderConstructionOrder { return 'kind' in order && order.kind === 'wonder'; }

export function wonderSiteBlock(state: WorldState, city: City, definition: WonderDefinition, tileId: number): string | null {
  const site = state.tiles.find(tile => tile.id === tileId);
  const center = state.tiles.find(tile => tile.id === city.tileId);
  if (!Number.isSafeInteger(tileId) || !site || !center) return 'The exact wonder site is missing';
  if (site.owner !== city.civId) return 'The wonder site must already belong to this civilization';
  const binding = purchasedSiteBlock(state, city, tileId); if (binding) return binding;
  if (site.terrain === 'ocean' || site.terrain === 'mountain') return 'The wonder requires buildable land';
  if (hexDistance(center, site) > definition.siteRange) return `The wonder site must be within ${definition.siteRange} hexes of its town`;
  if (state.cities.some(town => town.tileId === tileId)) return 'A town center occupies this site';
  if (districtSiteOccupied(state, tileId)) return 'A completed or reserved asset occupies this site';
  return null;
}

export function availableWonderSites(state: WorldState, city: City, definition: WonderDefinition): number[] {
  return state.tiles.filter(tile => wonderSiteBlock(state, city, definition, tile.id) === null).map(tile => tile.id).toSorted((a, b) => a - b);
}

export function wonderEligibility(state: WorldState, civId: number, definition: WonderDefinition, cityId: string | null): CapabilityEligibility {
  const civilization = state.civilizations.find(civ => civ.id === civId);
  const city = state.cities.find(town => town.id === cityId);
  const blockers: CapabilityEligibility['blockers'] = definition.requiredFeatures.filter(feature => !hasFeatures(state, [feature])).map(featureId => ({ kind: 'feature', featureId }));
  if (!civilization) blockers.push({ kind: 'civilization', civilizationId: civId });
  else {
    for (const technologyId of definition.requires) if (!civilization.technologies.includes(technologyId)) blockers.push({ kind: 'technology', technologyId });
    if (civilization.era < definition.minEra) blockers.push({ kind: 'era', required: definition.minEra, available: civilization.era });
    for (const resource of RESOURCE_IDS) if (civilization.resources[resource] < (definition.cost[resource] ?? 0)) blockers.push({ kind: 'resource', resource, required: definition.cost[resource] ?? 0, available: civilization.resources[resource] });
  }
  if (cityId === null) blockers.push({ kind: 'city-selection' });
  else if (!city) blockers.push({ kind: 'missing-city', cityId });
  else if (city.civId !== civId) blockers.push({ kind: 'foreign-city', cityId, owner: city.civId });
  else {
    if (city.construction?.active) blockers.push({ kind: 'active-commitment', targetId: city.construction.active.id });
    if (!availableWonderSites(state, city, definition).length) blockers.push({ kind: 'wonder-site', cityId });
  }
  const contender = state.cities.find(town => town.civId === civId && town.construction?.active && isWonderOrder(town.construction.active) && town.construction.active.wonderId === definition.id);
  if (contender) blockers.push({ kind: 'wonder-contender', wonderId: definition.id, cityId: contender.id });
  const completed = state.wonders?.[definition.id];
  if (completed) blockers.push({ kind: 'wonder-completed', wonderId: definition.id, civilizationId: completed.completion.civId });
  return { completed: completed?.completion.cityId === cityId && completed.completion.civId === civId, researching: false, blockers, targetCityId: city?.civId === civId ? city.id : null };
}

export function researchBoostFacts(state: WorldState, civId: number, wonderId: string) {
  const completed = state.wonders?.[wonderId];
  const remaining = completed ? Math.max(0, completed.boostLimit - completed.boosts.length) : 0;
  const civilization = state.civilizations.find(civ => civ.id === civId);
  const technology = TECHNOLOGIES.find(candidate => candidate.id === civilization?.researchTarget);
  let blocker: string | null = null;
  if (!hasFeatures(state, [WONDER_RULES.featureId])) blocker = 'Unique wonders are not released';
  else if (!completed || completed.completion.civId !== civId) blocker = 'This civilization has no completed award from this wonder';
  else if (remaining === 0) blocker = 'All boost charges have been used';
  else if (!technology || !civilization) blocker = 'Choose an eligible active discovery before using a boost';
  else if (civilization.technologies.includes(technology.id)) blocker = 'The active discovery is already completed';
  else if (!hasFeatures(state, technology.requiredFeatures) || technology.era > WONDER_RULES.boostMaximumEra) blocker = 'The active discovery is unreleased or beyond the eligible research eras';
  else if (completed.boosts.some(boost => boost.technologyId === technology.id)) blocker = 'This wonder already boosted that discovery';
  else if (civilization.researchProgress >= technology.cost) blocker = 'The active discovery has no remaining work';
  const nominalAmount = technology && completed ? quantize(technology.cost * completed.boostPercent / 100) : 0;
  const amount = technology && civilization ? quantize(Math.min(nominalAmount, Math.max(0, technology.cost - civilization.researchProgress))) : 0;
  return { remaining, blocker, quote: blocker || !technology || !civilization ? null : {
    technologyId: technology.id, costBasis: technology.cost, nominalAmount, progressBefore: civilization.researchProgress,
    amount, progressAfter: quantize(civilization.researchProgress + amount), unusedAmount: quantize(nominalAmount - amount),
  } };
}

export function observedWonders(state: WorldState, civId: number) {
  return WONDERS.map(definition => ({ wonderId: definition.id,
    contenders: state.cities.flatMap(city => city.construction?.active && isWonderOrder(city.construction.active) && city.construction.active.wonderId === definition.id ? [{ ...structuredClone(city.construction.active), civId: city.civId }] : []),
    completed: structuredClone(state.wonders?.[definition.id] ?? null), boost: researchBoostFacts(state, civId, definition.id),
  }));
}

export function availableWonderActions(state: WorldState, civId: number): ActionOption[] {
  if (!hasFeatures(state, [WONDER_RULES.featureId])) return [];
  const choices: ActionOption[] = [];
  for (const definition of WONDERS) {
    for (const city of state.cities.filter(town => town.civId === civId)) {
      if (wonderEligibility(state, civId, definition, city.id).blockers.length) continue;
      for (const tileId of availableWonderSites(state, city, definition)) choices.push({
        action: { type: 'build-wonder', wonderId: definition.id, cityId: city.id, tileId }, label: `${city.name}: ${definition.name} at site ${tileId}`,
        reason: `Pay ${RESOURCE_IDS.filter(resource => (definition.cost[resource] ?? 0) > 0).map(resource => `${definition.cost[resource]} ${resource}`).join(', ')} once; ${definition.requiredWork} work. First completion wins globally. Losing contenders recover ${WONDER_RULES.loserMaterialRefundPercent}% of recorded materials only. Base ${JSON.stringify(definition.production)} begins the following beat.`,
      });
    }
    const boost = researchBoostFacts(state, civId, definition.id);
    if (boost.quote) choices.push({ action: { type: 'apply-research-boost', wonderId: definition.id, technology: boost.quote.technologyId }, label: `${definition.name}: boost ${boost.quote.technologyId}`,
      reason: `${boost.remaining} charges remain; progress ${boost.quote.progressBefore} → ${boost.quote.progressAfter}/${boost.quote.costBasis}; adds ${boost.quote.amount}, unused nominal excess ${boost.quote.unusedAmount}. No science stock debit or automatic next discovery.` });
  }
  return choices;
}

export function executeWonderAction(state: WorldState, civId: number, action: Extract<GameAction, { type: 'build-wonder' | 'apply-research-boost' }>, events: GameEvent[]): void {
  if (action.type === 'build-wonder') {
    const definition = WONDERS.find(wonder => wonder.id === action.wonderId);
    const city = state.cities.find(town => town.id === action.cityId && town.civId === civId);
    if (!definition || !city || wonderEligibility(state, civId, definition, city.id).blockers.length || wonderSiteBlock(state, city, definition, action.tileId)) throw new RangeError('Wonder start requires its exact currently eligible town and site');
    transferCost(civilizationById(state, civId).resources, definition.cost);
    city.construction ??= { active: null, lastCompleted: null };
    city.construction.active = { kind: 'wonder', ruleVersion: WONDER_RULES.ruleVersion, id: `construction-${state.revision}`, wonderId: definition.id, cityId: city.id, tileId: action.tileId, startedRound: state.round, paid: structuredClone(definition.cost), workRequired: definition.requiredWork, workDone: 0 };
    emitEvent(state, events, { type: 'construction-started', title: `${city.name} starts ${definition.name}`, detail: city.construction.active.id, actor: civId, target: civId, tileId: action.tileId, cause: 'An exact owned site and the town construction lane were committed to the global first-completion contest', effects: [...RESOURCE_IDS.filter(resource => (definition.cost[resource] ?? 0) > 0).map(resource => `Paid ${definition.cost[resource]} ${resource}`), `Work 0/${definition.requiredWork}`, 'No wonder output or award before completion'], importance: 3 });
    return;
  }
  const completed = state.wonders?.[action.wonderId];
  const facts = researchBoostFacts(state, civId, action.wonderId);
  const quote = facts.quote;
  const technology = TECHNOLOGIES.find(candidate => candidate.id === action.technology);
  if (!completed || !quote || !technology || quote.technologyId !== action.technology || quote.amount <= 0) throw new RangeError(facts.blocker ?? 'Boost requires the exact eligible active discovery');
  const civilization = civilizationById(state, civId);
  civilization.researchProgress = quote.progressAfter;
  const event = emitEvent(state, events, { type: 'research-boost', title: `${civilization.name} uses ${action.wonderId}`, detail: action.technology, actor: civId, target: civId, tileId: completed.completion.tileId, cause: 'The actor explicitly used one retained wonder boost on its current discovery', effects: [`Research progress +${quote.amount}`, `Unused nominal boost ${quote.unusedAmount}; no overflow`, 'Science stock unchanged'], importance: 3 });
  const receipt = { ruleVersion: WONDER_RULES.ruleVersion, wonderId: action.wonderId, wonderCompletionEventId: completed.completion.eventId, civId, basisReleaseId: state.releaseId, percent: completed.boostPercent, ...quote, round: state.round, eventId: event.id, researchCompletionEventId: null as string | null };
  if (quote.progressAfter >= quote.costBasis) receipt.researchCompletionEventId = completeResearch(state, civId, technology, events, `Recorded research progress ${quote.progressBefore} and an explicit ${quote.amount} wonder boost completed this discovery without further science payment`).id;
  event.researchBoost = structuredClone(receipt);
  completed.boosts.push(receipt);
}

export function resolveWonderConstruction(state: WorldState, opening: ReadonlyMap<string, number>, events: GameEvent[]): void {
  if (!hasFeatures(state, [WONDER_RULES.featureId])) return;
  const contenders = state.cities.flatMap(city => city.construction?.active && isWonderOrder(city.construction.active) ? [{ city, order: city.construction.active }] : []);
  for (const { city, order } of contenders) {
    const work = opening.get(city.id);
    if (work !== undefined && state.round > order.startedRound) order.workDone = Math.min(order.workRequired, quantize(order.workDone + work));
  }
  for (const definition of WONDERS) {
    const candidates = contenders.filter(candidate => candidate.order.wonderId === definition.id);
    const winner = candidates.filter(candidate => candidate.order.workDone >= candidate.order.workRequired).toSorted((left, right) => left.order.startedRound - right.order.startedRound || left.city.civId - right.city.civId || (left.city.id < right.city.id ? -1 : left.city.id > right.city.id ? 1 : 0) || (left.order.id < right.order.id ? -1 : left.order.id > right.order.id ? 1 : 0))[0];
    if (!winner || state.wonders?.[definition.id]) continue;
    const { city, order } = winner;
    const event = emitEvent(state, events, { type: 'wonder-completed', title: `${city.name} completes ${definition.name}`, detail: order.id, actor: city.civId, target: city.civId, tileId: order.tileId, cause: 'The retained paid order won the global first-completion contest', effects: [`Completed wonder ${definition.id}`, `Base output ${JSON.stringify(definition.production)} begins next beat`, `Retained ${WONDER_RULES.boostLimit} optional research boosts`], importance: 5 });
    const completion = { kind: 'wonder' as const, ruleVersion: order.ruleVersion, wonderId: definition.id, orderId: order.id, civId: city.civId, cityId: city.id, tileId: order.tileId, startedRound: order.startedRound, completedRound: state.round, paid: structuredClone(order.paid), workRequired: order.workRequired, eventId: event.id };
    event.wonderCompletion = structuredClone(completion);
    state.wonders ??= {};
    const completed = { ruleVersion: WONDER_RULES.ruleVersion, completion, losses: [] as NonNullable<WorldState['wonders']>[string]['losses'], boostLimit: WONDER_RULES.boostLimit, boostPercent: WONDER_RULES.boostPercent, boosts: [] as NonNullable<WorldState['wonders']>[string]['boosts'] };
    state.wonders[definition.id] = completed;
    if (!city.construction) throw new RangeError('Wonder winner lost its construction lane');
    city.construction.lastCompleted = structuredClone(completion); city.construction.active = null;
    for (const loser of candidates.filter(candidate => candidate !== winner).toSorted((a, b) => a.city.civId - b.city.civId || (a.city.id < b.city.id ? -1 : a.city.id > b.city.id ? 1 : 0))) {
      const refund = { materials: quantize((loser.order.paid.materials ?? 0) * WONDER_RULES.loserMaterialRefundPercent / 100) };
      transferCost(civilizationById(state, loser.city.civId).resources, refund, 1);
      const lossEvent = emitEvent(state, events, { type: 'wonder-lost', title: `${loser.city.name} ends its ${definition.name} contender`, detail: loser.order.id, actor: loser.city.civId, target: city.civId, tileId: loser.order.tileId, cause: `Winner ${order.id} completed the globally unique wonder`, effects: [`Refunded ${refund.materials} materials`, 'No credit refund, wonder output or boost award; construction lane and unbuilt site released'], importance: 4 });
      const loss = { ruleVersion: loser.order.ruleVersion, wonderId: definition.id, orderId: loser.order.id, civId: loser.city.civId, cityId: loser.city.id, tileId: loser.order.tileId, startedRound: loser.order.startedRound, paid: structuredClone(loser.order.paid), workRequired: loser.order.workRequired, workDone: loser.order.workDone, refund, resolvedRound: state.round, winnerOrderId: order.id, eventId: lossEvent.id };
      completed.losses.push(loss); lossEvent.wonderLoss = structuredClone(loss);
      if (loser.city.construction) loser.city.construction.active = null;
    }
  }
}

export function wonderBaseProduction(state: WorldState, city: City): Partial<Resources> {
  const output: Partial<Resources> = {};
  if (!hasFeatures(state, [WONDER_RULES.featureId])) return output;
  for (const definition of WONDERS) if (state.wonders?.[definition.id]?.completion.cityId === city.id && state.wonders[definition.id]?.completion.civId === city.civId)
    for (const resource of RESOURCE_IDS) output[resource] = (output[resource] ?? 0) + (definition.production[resource] ?? 0);
  return output;
}
