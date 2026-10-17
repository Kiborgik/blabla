import { CIVICS, CIVIC_RULES } from '../content.ts';
import type { ActionOption, DecisionObligation, GameEvent, WorldState } from '../types.ts';
import { emitEvent } from './events.ts';
import { hasFeatures } from './history.ts';
import { civilizationById } from './world.ts';

export function civicActionBlock(state: WorldState, seat: number, civicId: string): string | null {
  const civilization = state.civilizations.find(candidate => candidate.id === seat);
  const definition = CIVICS.find(candidate => candidate.id === civicId);
  if (!hasFeatures(state, [CIVIC_RULES.featureId]) || !civilization?.civics) return 'Cultural civics are not released';
  if (!definition || !hasFeatures(state, definition.requiredFeatures)) return 'The exact civic is not released';
  if (civilization.civics.active) return `Active civic ${civilization.civics.active.civicId} must finish first`;
  if (civilization.civics.completedCivicIds.includes(civicId)) return 'The civic is already completed';
  const missing = definition.requires.filter(id => !civilization.civics?.completedCivicIds.includes(id));
  return missing.length ? `Missing completed civics: ${missing.join(', ')}` : null;
}

export function civicDecision(state: WorldState, seat: number): DecisionObligation {
  const civics = civilizationById(state, seat).civics;
  const lane: DecisionObligation = { kind: 'civic', cityId: null, status: 'blocked', targetId: null, progress: null, availableIds: [], blockers: [] };
  if (civics?.active) return { ...lane, status: 'active', targetId: civics.active.civicId, progress: { done: civics.active.progress, required: civics.active.requiredCulture } };
  for (const definition of CIVICS) {
    if (civics?.completedCivicIds.includes(definition.id)) continue;
    if (!civicActionBlock(state, seat, definition.id)) lane.availableIds.push(definition.id);
    else {
      for (const featureId of definition.requiredFeatures.filter(id => !hasFeatures(state, [id]))) lane.blockers.push({ capabilityId: definition.id, reason: { kind: 'feature', featureId } });
      for (const civicId of definition.requires.filter(id => !civics?.completedCivicIds.includes(id))) lane.blockers.push({ capabilityId: definition.id, reason: { kind: 'civic-prerequisite', civicId } });
    }
  }
  if (lane.availableIds.length) lane.status = 'required';
  else lane.blockers.push({ capabilityId: null, reason: { kind: 'no-available-choice' } });
  return lane;
}

export function availableCivicActions(state: WorldState, seat: number): ActionOption[] {
  return CIVICS.filter(definition => !civicActionBlock(state, seat, definition.id)).map(definition => ({ action: { type: 'choose-civic', civicId: definition.id }, label: `Develop ${definition.name}`, reason: `${definition.cost} Culture from actual future city output; stored Culture does not accelerate this commitment. ${definition.capability}` }));
}

export function chooseCivic(state: WorldState, seat: number, civicId: string, events: GameEvent[]): void {
  const block = civicActionBlock(state, seat, civicId);
  if (block) throw new RangeError(block);
  const definition = must(CIVICS.find(candidate => candidate.id === civicId));
  const civilization = civilizationById(state, seat);
  must(civilization.civics).active = { civicId, startedRound: state.round, progress: 0, requiredCulture: definition.cost };
  emitEvent(state, events, { type: 'civic-started', title: `${civilization.name} develops ${definition.name}`, detail: definition.capability, actor: seat, target: seat, tileId: null, cause: 'The civilization explicitly selected a released cultural commitment', effects: [`Civic ${civicId}`, `Required Culture ${definition.cost}`, 'Science research remains independent'], importance: 3 });
}

export function resolveCivics(state: WorldState, seat: number, producedCulture: number, events: GameEvent[]): void {
  if (!hasFeatures(state, [CIVIC_RULES.featureId])) return;
  const civilization = civilizationById(state, seat);
  const civics = civilization.civics;
  const active = civics?.active;
  if (!civics || !active || state.round <= active.startedRound) return;
  const invested = Math.min(Math.max(0, producedCulture), civilization.resources.culture, Math.max(0, active.requiredCulture - active.progress));
  civilization.resources.culture = Math.round((civilization.resources.culture - invested) * 100) / 100;
  active.progress = Math.round((active.progress + invested) * 100) / 100;
  if (active.progress < active.requiredCulture) return;
  const event = emitEvent(state, events, { type: 'civic-completed', title: `${civilization.name} completes ${CIVICS.find(candidate => candidate.id === active.civicId)?.name ?? active.civicId}`, detail: 'Current productive Culture completed the explicitly selected civic', actor: seat, target: seat, tileId: null, cause: `Civic ${active.civicId} received ${active.requiredCulture} Culture`, effects: [`Completed civic ${active.civicId}`, 'One latest-completion reform entitlement; no automatic successor or arrangement'], importance: 4 });
  civics.completedCivicIds.push(active.civicId);
  civics.lastCompleted = { civicId: active.civicId, completedRound: state.round, eventId: event.id };
  civics.reformEntitlement = { civicId: active.civicId, completedRound: state.round, completionEventId: event.id };
  civics.active = null;
}

function must<T>(value: T | null | undefined): T { if (value === null || value === undefined) throw new RangeError("Required civic fact is missing"); return value; }
