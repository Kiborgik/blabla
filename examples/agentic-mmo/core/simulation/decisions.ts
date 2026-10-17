import { wonderEligibility } from './wonders.ts';
import { constructionTarget } from './improvements.ts';
import { BUILDINGS, IMPROVEMENTS, TECHNOLOGIES, WONDERS } from '../content.ts';
import { DIRECTOR_SEAT, type DecisionObligation, type DecisionObligations, type GameAction, type WorldState } from '../types.ts';
import { buildingEligibility, improvementEligibility, researchEligibility } from './capabilities.ts';
import { constructionWork } from './construction.ts';
import { hasFeatures } from './history.ts';
import { citiesOf, civilizationById } from './world.ts';

export function decisionObligations(state: WorldState, civilizationId: number): DecisionObligations {
  const civilization = civilizationById(state, civilizationId);
  const research: DecisionObligation = { kind: 'research', cityId: null, status: 'blocked', targetId: null, progress: null, availableIds: [], blockers: [] };
  const target = TECHNOLOGIES.find(technology => technology.id === civilization.researchTarget);
  if (target) {
    research.status = 'active';
    research.targetId = target.id;
    research.progress = { done: civilization.researchProgress, required: target.cost };
  } else {
    for (const technology of TECHNOLOGIES) {
      const eligibility = researchEligibility(state, civilizationId, technology);
      if (eligibility.completed) continue;
      if (!eligibility.blockers.length) research.availableIds.push(technology.id);
      else research.blockers.push(...eligibility.blockers.map(reason => ({ capabilityId: technology.id, reason })));
    }
    if (research.availableIds.length) research.status = 'required';
    else research.blockers.push({ capabilityId: null, reason: { kind: 'no-available-choice' } });
  }
  const construction = citiesOf(state, civilizationId).map(city => {
    const lane: DecisionObligation = { kind: 'construction', cityId: city.id, status: 'blocked', targetId: null, progress: null, availableIds: [], blockers: [] };
    const active = city.construction?.active;
    if (active) {
      lane.status = constructionWork(city) > 0 ? 'active' : 'blocked';
      lane.targetId = constructionTarget(active);
      lane.progress = { done: active.workDone, required: active.workRequired };
      if (lane.status === 'blocked') lane.blockers.push({ capabilityId: constructionTarget(active), reason: { kind: 'zero-work' } });
    } else {
      for (const building of BUILDINGS) {
        const eligibility = buildingEligibility(state, civilizationId, building, city.id);
        if (eligibility.completed) continue;
        if (!eligibility.blockers.length) lane.availableIds.push(building.id);
        else lane.blockers.push(...eligibility.blockers.map(reason => ({ capabilityId: building.id, reason })));
      }
      if (hasFeatures(state, ['worked-land'])) for (const definition of IMPROVEMENTS) {
        const eligibility = improvementEligibility(state, civilizationId, definition, city.id);
        const capabilityId = `improvement:${definition.id}`;
        if (!eligibility.blockers.length) lane.availableIds.push(capabilityId);
        else lane.blockers.push(...eligibility.blockers.map(reason => ({ capabilityId, reason })));
      }
      if (hasFeatures(state, ['unique-wonders'])) for (const definition of WONDERS) {
        const eligibility = wonderEligibility(state, civilizationId, definition, city.id);
        if (eligibility.completed) continue;
        const capabilityId = `wonder:${definition.id}`;
        if (!eligibility.blockers.length) lane.availableIds.push(capabilityId);
        else lane.blockers.push(...eligibility.blockers.map(reason => ({ capabilityId, reason })));
      }
      if (lane.availableIds.length) lane.status = 'required';
      else lane.blockers.push({ capabilityId: null, reason: { kind: 'no-available-choice' } });
    }
    return lane;
  });
  return { research, construction };
}

export function decisionActionBlock(state: WorldState, seat: number, action: GameAction): string | null {
  if (seat === DIRECTOR_SEAT || !hasFeatures(state, ['recurring-decisions'])) return null;
  const civilization = civilizationById(state, seat);
  if (action.type === 'research' && civilization.researchTarget)
    return `Active research ${civilization.researchTarget} must finish before another research commitment`;
  if (action.type === 'build' || action.type === 'improve' || action.type === 'build-wonder') {
    const city = state.cities.find(candidate => candidate.civId === seat && candidate.id === action.cityId);
    if (city?.construction?.active) return `Active construction ${constructionTarget(city.construction.active)} in ${city.id} must finish before another commitment`;
  }
  if (action.type === 'wait') {
    const decisions = decisionObligations(state, seat);
    const required = [decisions.research, ...decisions.construction].filter(lane => lane.status === 'required');
    if (required.length) return `Required decisions remain: ${required.map(lane => lane.kind === 'research' ? 'research' : `construction in ${lane.cityId}`).join(', ')}`;
  }
  return null;
}

export function decisionHoldFacts(state: WorldState, seat: number): string[] {
  const decisions = decisionObligations(state, seat);
  return [decisions.research, ...decisions.construction].map(lane => `${lane.kind}${lane.cityId ? ` ${lane.cityId}` : ''}: ${lane.status}${lane.targetId ? ` ${lane.targetId}` : ''}; ${lane.availableIds.length} available choices${lane.status === 'blocked' ? `; ${JSON.stringify(lane.blockers)}` : ''}`);
}
