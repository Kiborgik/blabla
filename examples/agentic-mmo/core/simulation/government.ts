import { CIVIC_RULES, GOVERNMENTS, POLICIES, POLICY_SLOT_TYPES } from '../content.ts';
import type { ActionOption, GameEvent, GovernmentDefinition, PolicyAssignment, Resources, WorldState } from '../types.ts';
import { emitEvent } from './events.ts';
import { hasFeatures } from './history.ts';
import { civilizationById } from './world.ts';

export function canonicalAssignments(assignments: readonly PolicyAssignment[]): PolicyAssignment[] {
  return assignments.map(assignment => ({ ...assignment })).toSorted((left, right) => POLICY_SLOT_TYPES.indexOf(left.slotType) - POLICY_SLOT_TYPES.indexOf(right.slotType) || left.slotIndex - right.slotIndex || left.policyId.localeCompare(right.policyId));
}

export function sameAssignments(left: readonly PolicyAssignment[], right: readonly PolicyAssignment[]): boolean {
  const a = canonicalAssignments(left); const b = canonicalAssignments(right);
  return a.length === b.length && a.every((assignment, index) => assignment.slotType === b[index]?.slotType && assignment.slotIndex === b[index]?.slotIndex && assignment.policyId === b[index]?.policyId);
}

function prerequisites(state: WorldState, seat: number, definition: { requiredFeatures: readonly string[]; requires: string[] }): boolean {
  const completed = civilizationById(state, seat).civics?.completedCivicIds ?? [];
  return hasFeatures(state, definition.requiredFeatures) && definition.requires.every(id => completed.includes(id));
}

export function governmentPrice(state: WorldState, seat: number, governmentId: string): { credits: number; completionEventId: string | null } {
  const civilization = civilizationById(state, seat);
  const entitlement = civilization.civics?.reformEntitlement;
  const completed = civilization.civics?.lastCompleted;
  const valid = entitlement && completed && civilization.government?.lastSpentReformCompletionEventId !== entitlement.completionEventId && entitlement.civicId === completed.civicId && entitlement.completedRound === completed.completedRound && entitlement.completionEventId === completed.eventId && civilization.civics?.completedCivicIds.includes(entitlement.civicId);
  return { credits: valid ? 0 : civilization.government?.active?.governmentId === governmentId ? CIVIC_RULES.reslotCredits : CIVIC_RULES.governmentCredits, completionEventId: valid ? entitlement.completionEventId : null };
}

export function governmentActionBlock(state: WorldState, seat: number, governmentId: string, assignments: readonly PolicyAssignment[]): string | null {
  const civilization = state.civilizations.find(candidate => candidate.id === seat);
  const government = civilization?.government;
  if (!hasFeatures(state, [CIVIC_RULES.featureId]) || !government || !civilization?.civics) return 'Government arrangements are not released';
  const definition = GOVERNMENTS.find(candidate => candidate.id === governmentId);
  if (!definition || !prerequisites(state, seat, definition)) return 'The target government requires its own released capabilities and completed civics';
  if (government.pending) return 'The current government transition must finish first';
  const occupied = new Set<string>(); const usedPolicies = new Set<string>();
  for (const assignment of assignments) {
    if (!POLICY_SLOT_TYPES.includes(assignment.slotType) || !Number.isSafeInteger(assignment.slotIndex) || assignment.slotIndex < 0 || assignment.slotIndex >= definition.slots[assignment.slotType]) return 'The exact target slot does not exist';
    const key = `${assignment.slotType}:${assignment.slotIndex}`;
    const policy = POLICIES.find(candidate => candidate.id === assignment.policyId);
    if (occupied.has(key) || usedPolicies.has(assignment.policyId)) return 'A slot and a policy may each be assigned only once';
    if (!policy || !prerequisites(state, seat, policy) || (assignment.slotType !== 'wildcard' && assignment.slotType !== policy.slotType)) return 'The exact policy is unavailable or incompatible with the target slot';
    occupied.add(key); usedPolicies.add(assignment.policyId);
  }
  const current = government.active;
  if (current) {
    if (current.governmentId === governmentId && sameAssignments(current.assignments, assignments)) return 'The requested arrangement is already active';
    if (state.round < current.policyLockUntilRound || (current.governmentId !== governmentId && state.round < current.governmentLockUntilRound)) return 'The current arrangement commitment has not expired';
  }
  if (civilization.civics.reformEntitlement && !governmentPrice(state, seat, governmentId).completionEventId) return 'The reform entitlement must match the latest actual civic completion';
  return civilization.resources.credits < governmentPrice(state, seat, governmentId).credits ? 'Insufficient Credits for the exact arrangement' : null;
}

function arrangements(state: WorldState, seat: number, definition: GovernmentDefinition): PolicyAssignment[][] {
  const slots = POLICY_SLOT_TYPES.flatMap(slotType => Array.from({ length: definition.slots[slotType] }, (_, slotIndex) => ({ slotType, slotIndex })));
  let values: PolicyAssignment[][] = [[]];
  for (const slot of slots) {
    const eligible = POLICIES.filter(policy => prerequisites(state, seat, policy) && (slot.slotType === 'wildcard' || policy.slotType === slot.slotType));
    values = values.flatMap(value => [value, ...eligible.filter(policy => !value.some(assignment => assignment.policyId === policy.id)).map(policy => [...value, { ...slot, policyId: policy.id }])]);
  }
  return values;
}

export function availableGovernmentActions(state: WorldState, seat: number): ActionOption[] {
  if (!hasFeatures(state, [CIVIC_RULES.featureId])) return [];
  return GOVERNMENTS.filter(definition => prerequisites(state, seat, definition)).flatMap(definition => arrangements(state, seat, definition).filter(assignments => !governmentActionBlock(state, seat, definition.id, assignments)).map(assignments => {
    const price = governmentPrice(state, seat, definition.id);
    const change = civilizationById(state, seat).government?.active?.governmentId;
    return { action: { type: 'adopt-government' as const, governmentId: definition.id, assignments }, label: `${definition.name}: ${assignments.map(assignment => POLICIES.find(policy => policy.id === assignment.policyId)?.name).join(', ') || 'empty policy slots'}`, reason: `${price.credits} Credits${price.completionEventId ? `; spends reform from ${price.completionEventId}` : ''}. ${change && change !== definition.id ? 'Two working beats retain the old arrangement at 75% ordinary output; then the target starts a four-beat commitment.' : 'Effective at the next opening with a four-beat policy commitment.'}` };
  }));
}

export function adoptGovernment(state: WorldState, seat: number, governmentId: string, assignments: readonly PolicyAssignment[], events: GameEvent[]): void {
  const block = governmentActionBlock(state, seat, governmentId, assignments);
  if (block) throw new RangeError(block);
  const civilization = civilizationById(state, seat); const government = must(civilization.government);
  const price = governmentPrice(state, seat, governmentId);
  const canonical = canonicalAssignments(assignments);
  civilization.resources.credits = Math.round((civilization.resources.credits - price.credits) * 100) / 100;
  if (price.completionEventId) { must(civilization.civics).reformEntitlement = null; government.lastSpentReformCompletionEventId = price.completionEventId; }
  if (government.active && government.active.governmentId !== governmentId) {
    government.pending = { targetGovernmentId: governmentId, targetAssignments: canonical, acceptedRound: state.round, completionRound: state.round + CIVIC_RULES.transitionBeats, paidCredits: price.credits, spentCompletionEventId: price.completionEventId };
  } else {
    government.active = { governmentId, assignments: canonical, effectiveRound: state.round, governmentLockUntilRound: government.active?.governmentLockUntilRound ?? state.round + CIVIC_RULES.commitmentBeats, policyLockUntilRound: state.round + CIVIC_RULES.commitmentBeats };
  }
  emitEvent(state, events, { type: 'arrangement-accepted', title: `${civilization.name} chooses ${must(GOVERNMENTS.find(candidate => candidate.id === governmentId)).name}`, detail: canonical.length ? canonical.map(assignment => `${assignment.slotType}:${assignment.slotIndex} ${assignment.policyId}`).join(', ') : 'All policy slots explicitly empty', actor: seat, target: seat, tileId: null, cause: 'The civilization explicitly chose a complete eligible government arrangement', effects: [`Government ${governmentId}`, `Credits paid ${price.credits}`, `Reform completion ${price.completionEventId ?? 'none'}`, government.pending ? `Transition completes after round ${government.pending.completionRound}` : `Policy commitment until round ${must(government.active).policyLockUntilRound}`], importance: 4 });
}

export function governmentModifiers(state: WorldState, seat: number): { baseProduction: Partial<Resources>; constructionWork: number; ordinaryOutputMultiplier: number } {
  const government = civilizationById(state, seat).government;
  if (!hasFeatures(state, [CIVIC_RULES.featureId]) || !government?.active) return { baseProduction: {}, constructionWork: 0, ordinaryOutputMultiplier: 1 };
  const definition = GOVERNMENTS.find(candidate => candidate.id === must(government.active).governmentId);
  const constructionWork = government.active.assignments.reduce((sum, assignment) => sum + (POLICIES.find(candidate => candidate.id === assignment.policyId)?.constructionWork ?? 0), 0);
  return { baseProduction: { ...definition?.baseProduction }, constructionWork, ordinaryOutputMultiplier: government.pending && state.round > government.pending.acceptedRound && state.round <= government.pending.completionRound ? CIVIC_RULES.transitionOutput : 1 };
}

export function resolveGovernmentTransitions(state: WorldState, events: GameEvent[]): void {
  if (!hasFeatures(state, [CIVIC_RULES.featureId])) return;
  for (const civilization of state.civilizations) {
    const government = civilization.government; const pending = government?.pending;
    if (!government || !pending || state.round < pending.completionRound) continue;
    government.active = { governmentId: pending.targetGovernmentId, assignments: structuredClone(pending.targetAssignments), effectiveRound: pending.completionRound, governmentLockUntilRound: pending.completionRound + CIVIC_RULES.commitmentBeats, policyLockUntilRound: pending.completionRound + CIVIC_RULES.commitmentBeats };
    government.pending = null;
    emitEvent(state, events, { type: 'transition-completed', title: `${civilization.name} completes its government transition`, detail: `Government ${pending.targetGovernmentId} applies at the next opening`, actor: civilization.id, target: civilization.id, tileId: null, cause: `The two-beat transition accepted at round ${pending.acceptedRound} completed`, effects: [`Effective round ${pending.completionRound}`, `Commitment until round ${government.active.governmentLockUntilRound}`], importance: 4 });
  }
}

export function observedGovernment(state: WorldState, seat: number) {
  const civilization = civilizationById(state, seat);
  return structuredClone({ civics: civilization.civics, government: civilization.government, modifiers: governmentModifiers(state, seat), targets: GOVERNMENTS.map(definition => ({ governmentId: definition.id, eligible: prerequisites(state, seat, definition), slots: definition.slots, price: governmentPrice(state, seat, definition.id) })) });
}

function must<T>(value: T | null | undefined): T { if (value === null || value === undefined) throw new RangeError("Required civic fact is missing"); return value; }
