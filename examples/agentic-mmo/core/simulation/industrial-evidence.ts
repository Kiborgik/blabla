import type { City, GameEvent, IndustrialFoundryReceipt, WorldState } from '../types.ts';

export function recordIndustrialFoundry(state: WorldState, city: City, events: GameEvent[]): void {
  if (!state.industrialEvidence) return;
  const result = city.buildingOperations?.foundry?.lastResult;
  if (!result || result.status !== 'operated' || result.round !== state.round || (result.produced.materials ?? 0) <= 0 || !result.residents) return;
  const event = events.findLast(candidate => candidate.type === 'building-operation' && candidate.detail === `${city.id}/foundry at strategic round ${state.round}`);
  if (!event) throw new RangeError('Productive Foundry proof requires its actual operation event');
  const receipt: IndustrialFoundryReceipt = { ruleVersion: 1, cityId: city.id, civId: city.civId, round: state.round, eventId: event.id, paid: structuredClone(result.paid), strategicPaid: structuredClone(result.strategicPaid ?? {}), produced: structuredClone(result.produced), residents: structuredClone(result.residents) };
  event.industrialFoundry = structuredClone(receipt);
  if (state.industrialEvidence.foundryOperations.length < 2 && !state.industrialEvidence.foundryOperations.some(prior => prior.cityId === city.id)) state.industrialEvidence.foundryOperations.push(receipt);
}

export function industrialEvidenceComplete(state: WorldState): boolean {
  const evidence = state.industrialEvidence;
  const delivery = evidence?.steamDelivery;
  return !!evidence && new Set(evidence.foundryOperations.map(receipt => receipt.cityId)).size >= 2 && !!delivery && delivery.terms.transport?.mode === 'steam' && delivery.terms.transport.railEdges.length > 0 && delivery.terms.cadenceRounds < delivery.terms.transport.unrailedCadence;
}
