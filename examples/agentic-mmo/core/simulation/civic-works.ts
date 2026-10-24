import { CIVIC_WORKS_RULES, civicWorksTargetTile } from '../civic-works-content.ts';
import type { CivicWorksAction, CivicWorksCommission, CivicWorksReceipt, CivicWorksState } from '../civic-works-types.ts';
import { BUILDINGS, RESOURCE_IDS } from '../content.ts';
import { CIV_COUNT, type ActionOption, type BuildingConstructionOrder, type City, type GameAction, type GameEvent, type WorldState } from '../types.ts';
import { constructionWorkMultiplier } from './construction.ts';
import { projectCivicWorksProtection } from './economy.ts';
export { projectCivicWorksProtection } from './economy.ts';
import { emitEvent } from './events.ts';
import { governmentModifiers, originalCapitalCityId } from './government.ts';
import { hasFeatures } from './history.ts';

const q = (value: number): number => Math.round(value * 100) / 100;

export function createCivicWorksState(): CivicWorksState {
  return { ruleVersion: CIVIC_WORKS_RULES.ruleVersion, active: [], lastResults: Array.from({ length: CIV_COUNT }, () => null) };
}

export function hasActiveCivicWorks(state: WorldState, civId: number): boolean {
  return state.civicWorks?.active.some(commission => commission.civId === civId) ?? false;
}

function ordinaryOrder(city: City | undefined, orderId: string): BuildingConstructionOrder | null {
  const order = city?.construction?.active;
  return order && !('kind' in order) && order.id === orderId ? order : null;
}

function dependencyBlock(state: WorldState, civId: number): string | null {
  if (state.routes.some(route => route.agreement?.enabled && (route.owner === civId || route.partner === civId))) return 'Accepted trade has protected due payments outside the civic-works dependency closure';
  if (state.publicProjects?.some(project => project.status === 'committed' && (project.proposer === civId || project.recipient === civId))) return 'A committed public project retains its exact due contributions';
  if (state.relief?.active.some(charter => charter.status === 'accepted' && (charter.terms.donorId === civId || charter.terms.recipientId === civId))) return 'An accepted relief charter retains its exact due supplies';
  if (state.knowledge?.active.some(compact => compact.status === 'accepted' && (compact.terms.teacherId === civId || compact.terms.learnerId === civId))) return 'An accepted knowledge compact retains its institution and payment commitments';
  if (state.border?.active.some(incident => incident.initiatorId === civId || incident.defenderId === civId)) return 'Border parties and returning residents are outside the civic-works dependency closure';
  if (state.spaceflight?.civilizations[civId]?.activeMission || state.spaceflight?.civilizations[civId]?.colony) return 'Off-world commitments are outside the civic-works dependency closure';
  return null;
}

export function civicWorksTargetBlock(state: WorldState, civId: number, action: CivicWorksAction): string | null {
  if (state.outcome) return 'The world has reached its outcome';
  if (!Number.isSafeInteger(state.round + CIVIC_WORKS_RULES.durationBeats)) return 'The fixed schedule exceeds valid strategic chronology';
  if (!state.civicWorks || !hasFeatures(state, [CIVIC_WORKS_RULES.featureId, 'resident-capacity', 'building-operations', 'recurring-decisions'])) return 'Kiln civic works are not released';
  const actor = state.civilizations.find(actor => actor.id === civId);
  if (!actor?.civics?.completedCivicIds.includes(CIVIC_WORKS_RULES.civicId)) return 'Completed State workforce is required';
  if (action.donorBuildingId !== CIVIC_WORKS_RULES.donorBuildingId) return 'Only a completed Kiln can supply civic works';
  const city = state.cities.find(city => city.id === action.cityId && city.civId === civId);
  const order = ordinaryOrder(city, action.orderId);
  if (!city || !order || order.cityId !== city.id) return 'The exact owned active ordinary building order is required';
  if (civicWorksTargetTile(city, order) === null) return 'The exact ordinary target worksite is missing or ambiguous';
  const definition = BUILDINGS.find(building => building.id === order.buildingId);
  if (!definition || !hasFeatures(state, definition.requiredFeatures) || city.buildings.includes(definition.id) || order.workDone >= order.workRequired
    || RESOURCE_IDS.some(resource => (order.paid[resource] ?? 0) !== (definition.cost[resource] ?? 0))) return 'The exact unfinished order must retain its full original construction payment';
  if (!city.buildings.includes(CIVIC_WORKS_RULES.donorBuildingId) || !city.buildingOperations?.kiln?.enabled) return 'The completed donor Kiln must remain enabled';
  if ((definition.housing ?? 0) > 0 || definition.effects.some(effect => effect.kind !== 'city' || effect.field !== 'infrastructure' || effect.amount < 0)) return 'The target has housing or other effects outside the bounded civic-works protection closure';
  return dependencyBlock(state, civId);
}

export function civicWorksCommission(state: WorldState, civId: number, action: CivicWorksAction, acceptedEventId = `${state.revision}:0`): CivicWorksCommission {
  const city = state.cities.find(city => city.id === action.cityId && city.civId === civId)!;
  const order = ordinaryOrder(city, action.orderId)!;
  return { id: `civic-works-${state.revision}`, civId, cityId: city.id, orderId: order.id, buildingId: order.buildingId, targetTileId: civicWorksTargetTile(city, order)!, donorBuildingId: 'kiln', acceptedRound: state.round, firstRound: state.round + 1, expiresRound: state.round + CIVIC_WORKS_RULES.durationBeats, acceptedEventId };
}

export interface CivicWorksProtection {
  supported: boolean;
  reason: string;
  retained: WorldState[];
  proposed: WorldState[];
}

export function civicWorksProjectionAdverse(retained: WorldState, proposed: WorldState, commission: CivicWorksCommission): string | null {
  for (const baseline of retained.cities) {
    const city = proposed.cities.find(city => city.id === baseline.id)!;
    for (const [id, operation] of Object.entries(baseline.buildingOperations ?? {})) {
      if (city.id === commission.cityId && id === commission.donorBuildingId) continue;
      const result = city.buildingOperations?.[id]?.lastResult;
      if (operation.lastResult?.status === 'operated' && (result?.status !== 'operated' || (result.residents?.allocated ?? 0) < (operation.lastResult.residents?.allocated ?? 0))) return `${city.id}/${id} loses baseline-funded non-donor work at round ${proposed.round}`;
    }
    for (const [id, improvement] of Object.entries(baseline.improvements ?? {})) {
      const result = city.improvements?.[id]?.operation.lastResult;
      if (improvement.operation.lastResult?.status === 'operated' && (result?.status !== 'operated' || result.residents.allocated < improvement.operation.lastResult.residents.allocated)) return `${city.id}/site-${id} loses baseline-funded non-donor work at round ${proposed.round}`;
    }
    if (city.civId !== commission.civId) continue;
    const supply = city.lastFoodSupply; const prior = baseline.lastFoodSupply;
    if (!supply || !prior || q(supply.required - supply.paid) > q(prior.required - prior.paid)) return `${city.id} has a larger household shortfall at round ${proposed.round}`;
    if (city.population !== baseline.population || supply.growthPaid !== prior.growthPaid) return `${city.id} has changed population or growth liabilities outside the protected closure at round ${proposed.round}`;
    if (city.id === commission.cityId && city.buildings.includes(commission.buildingId) && city.construction?.lastCompleted?.completedRound !== proposed.round) {
      const operation = city.buildingOperations?.[commission.buildingId];
      if (operation && operation.lastResult?.status !== 'operated') return `The advanced ${commission.buildingId} cannot fund its actual opening operation at round ${proposed.round}`;
    }
  }
  return null;
}


export function civicWorksBlock(state: WorldState, civId: number, action: CivicWorksAction): string | null {
  const blocked = civicWorksTargetBlock(state, civId, action); if (blocked) return blocked;
  if (hasActiveCivicWorks(state, civId)) return 'Only one civic-works commission may be active per civilization';
  const projection = projectCivicWorksProtection(state, civicWorksCommission(state, civId, action));
  return projection.supported ? null : projection.reason;
}

export function availableCivicWorksActions(state: WorldState, civId: number): ActionOption[] {
  if (!state.civicWorks || hasActiveCivicWorks(state, civId)) return [];
  return state.cities.filter(city => city.civId === civId).flatMap(city => {
    const order = city.construction?.active; if (!order || 'kind' in order) return [];
    const action: CivicWorksAction = { type: 'commission-civic-works', cityId: city.id, orderId: order.id, donorBuildingId: 'kiln' };
    if (civicWorksBlock(state, civId, action)) return [];
    return [{ action, label: `Commission ${city.name} Kiln crew`, reason: `Next two scheduled beats: three real Kiln staff and 1 Material + 2 Credits per successful beat replace Materials production with up to 2 extra base work on ${order.id}` }];
  });
}

export function executeCivicWorksAction(state: WorldState, civId: number, action: GameAction, events: GameEvent[]): boolean {
  if (action.type !== 'commission-civic-works' || civicWorksBlock(state, civId, action)) return false;
  const commission = civicWorksCommission(state, civId, action, `${state.revision}:${events.length}`);
  state.civicWorks!.active.push(commission); state.civicWorks!.active.sort((left, right) => left.civId - right.civId);
  emitEvent(state, events, { type: 'civic-works-accepted', title: 'Kiln crew commissioned', detail: commission.id, actor: civId, target: civId, tileId: commission.targetTileId, cause: 'Completed State workforce authorized an exact paid ordinary building commission', effects: [`City ${commission.cityId}; order ${commission.orderId}; donor ${commission.donorBuildingId}`, `Scheduled rounds ${commission.firstRound} and ${commission.expiresRound}; no escrow or payment on acceptance`, 'Each successful beat substitutes three local staff and 1 Material + 2 Credits for Kiln production'], importance: 3 });
  return true;
}

export function prepareCivicWorksProtection(state: WorldState): ReadonlyMap<string, string> {
  return new Map((state.civicWorks?.active ?? []).filter(commission => state.round >= commission.firstRound && state.round <= commission.expiresRound).flatMap(commission => {
    const projection = projectCivicWorksProtection(state, commission, true);
    return projection.supported ? [] : [[commission.id, projection.reason] as const];
  }));
}

export function openingCivicWorksBasis(state: WorldState): ReadonlyMap<string, NonNullable<CivicWorksReceipt['workBasis']>> {
  return new Map((state.civicWorks?.active ?? []).flatMap(commission => {
    const city = state.cities.find(city => city.id === commission.cityId && city.civId === commission.civId);
    if (!city) return [];
    const government = governmentModifiers(state, city.civId);
    return [[commission.id, { wellbeing: city.wellbeing, damage: city.damage, infrastructure: city.infrastructure, focus: city.focus, governmentWork: government.constructionWork, capitalPercent: city.id === originalCapitalCityId(state, city.civId) ? government.capitalConstructionWorkPercent : 0 }] as const];
  }));
}

export function allocateCivicWorks(state: WorldState, openingWork: Map<string, number>, events: GameEvent[], protection: ReadonlyMap<string, string>, basis: ReadonlyMap<string, NonNullable<CivicWorksReceipt['workBasis']>>): void {
  if (!state.civicWorks || !hasFeatures(state, [CIVIC_WORKS_RULES.featureId])) return;
  for (const commission of state.civicWorks.active) {
    if (state.round < commission.firstRound || state.civicWorks.lastResults[commission.civId]?.commissionId === commission.id && state.civicWorks.lastResults[commission.civId]?.round === state.round) continue;
    const city = state.cities.find(city => city.id === commission.cityId && city.civId === commission.civId);
    const order = ordinaryOrder(city, commission.orderId);
    const ordinaryWork = order ? Math.min(Math.max(0, order.workRequired - order.workDone), openingWork.get(commission.cityId) ?? 0) : 0;
    const receipt: CivicWorksReceipt = { ruleVersion: 1, commissionId: commission.id, civId: commission.civId, cityId: commission.cityId, orderId: commission.orderId, buildingId: commission.buildingId, targetTileId: commission.targetTileId, donorBuildingId: 'kiln', firstRound: commission.firstRound, expiresRound: commission.expiresRound, acceptedEventId: commission.acceptedEventId, round: state.round, eventId: '', status: 'blocked', reason: '', paid: {}, residents: null, workBasis: order ? basis.get(commission.id) ?? null : null, ordinaryWork: q(ordinaryWork), extraWork: 0, workBefore: order?.workDone ?? 0, workRequired: order?.workRequired ?? 0, terminal: null };
    const operation = city?.buildingOperations?.kiln; const baseline = operation?.lastResult;
    const actor = state.civilizations.find(actor => actor.id === commission.civId);
    if (!order || order.buildingId !== commission.buildingId || civicWorksTargetTile(city!, order) !== commission.targetTileId) { receipt.status = 'ended'; receipt.terminal = 'order-lost'; receipt.reason = 'The exact paid ordinary order is no longer active'; receipt.ordinaryWork = 0; receipt.workBefore = 0; receipt.workRequired = 0; receipt.workBasis = null; }
    else if (state.round > commission.expiresRound) { receipt.status = 'ended'; receipt.terminal = 'expired'; receipt.reason = 'The fixed two-beat schedule has expired'; }
    else if (q(order.workDone + ordinaryWork) >= order.workRequired) { receipt.status = 'ended'; receipt.reason = 'Ordinary work alone finishes the order; no crew fee or work'; }
    else if (state.round <= order.startedRound || ordinaryWork <= 0) receipt.reason = 'No valid opening ordinary construction work';
    else if (!city!.buildings.includes('kiln') || !operation?.enabled || baseline?.round !== state.round || baseline.status !== 'operated' || baseline.paid.energy !== 2 || !baseline.residents || baseline.residents.required !== CIVIC_WORKS_RULES.residents || baseline.residents.allocated !== CIVIC_WORKS_RULES.residents || baseline.residents.available < CIVIC_WORKS_RULES.residents) receipt.reason = 'The ordinary donor Kiln was paused, unfunded or lacked three real opening local staff';
    else if (protection.has(commission.id)) receipt.reason = protection.get(commission.id)!;
    else if (dependencyBlock(state, commission.civId)) receipt.reason = dependencyBlock(state, commission.civId)!;
    else if (!actor || actor.resources.materials < CIVIC_WORKS_RULES.perBeatCost.materials || actor.resources.credits < CIVIC_WORKS_RULES.perBeatCost.credits) receipt.reason = 'Complete commission inputs do not remain after protecting every ordinary opening allocation';
    else {
      receipt.extraWork = Math.min(q(order.workRequired - order.workDone - ordinaryWork), q(CIVIC_WORKS_RULES.extraBaseWork * constructionWorkMultiplier(state, city!)));
      if (receipt.extraWork > 0) {
        actor.resources.energy = q(actor.resources.energy + baseline.paid.energy);
        actor.resources.materials = q(actor.resources.materials - CIVIC_WORKS_RULES.perBeatCost.materials);
        actor.resources.credits = q(actor.resources.credits - CIVIC_WORKS_RULES.perBeatCost.credits);
        receipt.status = 'worked'; receipt.reason = 'Paid exact-order work substituted the funded Kiln allocation without reallocating saved Energy';
        receipt.paid = { ...CIVIC_WORKS_RULES.perBeatCost }; receipt.residents = structuredClone(baseline.residents);
        operation.lastResult = { ...baseline, status: 'civic-works', civicWorksCommissionId: commission.id, paid: {}, produced: {} };
        openingWork.set(city!.id, q((openingWork.get(city!.id) ?? 0) + receipt.extraWork));
      } else receipt.reason = 'No positive remaining crew work';
    }
    const event = emitEvent(state, events, { type: `civic-works-${receipt.status}`, title: `${city?.name ?? commission.cityId}: Kiln civic works ${receipt.status}`, detail: commission.id, actor: commission.civId, target: commission.civId, tileId: commission.targetTileId, cause: receipt.reason, effects: [`Order ${commission.orderId}; ordinary work ${receipt.ordinaryWork}; crew work ${receipt.extraWork}`, receipt.status === 'worked' ? 'Paid 1 Material and 2 Credits; allocated three local staff; no ordinary Kiln payment or output' : 'No civic-works payment, staff reassignment or extra work'], importance: receipt.status === 'worked' ? 2 : 1 });
    receipt.eventId = event.id; event.civicWorks = receipt; state.civicWorks.lastResults[commission.civId] = receipt;
  }
}

export function resolveCivicWorks(state: WorldState, events: GameEvent[]): void {
  if (!state.civicWorks) return;
  state.civicWorks.active = state.civicWorks.active.filter(commission => {
    const receipt = state.civicWorks!.lastResults[commission.civId];
    if (!receipt || receipt.commissionId !== commission.id || receipt.round !== state.round) return true;
    const completion = state.cities.find(city => city.id === commission.cityId)?.construction?.lastCompleted;
    if (completion?.orderId === commission.orderId && completion.completedRound === state.round) receipt.terminal = 'order-completed';
    else if (!receipt.terminal && state.round >= commission.expiresRound) receipt.terminal = 'expired';
    if (!receipt.terminal) return true;
    const event = events.find(event => event.id === receipt.eventId);
    if (event) { event.civicWorks = structuredClone(receipt); event.effects.push(`Commission ended: ${receipt.terminal}`); }
    return false;
  });
}
