import type { Outcome, Resources, StrategicResources } from './types.ts';

export type BorderAction =
  | { type: 'dispatch-border'; sourceCityId: string; tileId: number; people: 2 | 3 }
  | { type: 'respond-border'; incidentId: string; response: 'defend'; sourceCityId: string; people: 2 | 3 }
  | { type: 'respond-border'; incidentId: string; response: 'yield' }
  | { type: 'withdraw-border'; incidentId: string };
export type BorderDepartureAction = Extract<BorderAction, { type: 'dispatch-border' } | { response: 'defend' }>;
export interface BorderOperationForecast {
  kind: 'building' | 'improvement';
  cityId: string;
  id: string;
  tileId: number | null;
  round: number;
  horizon: number;
  inputs: Partial<Resources>;
  strategicInputs: StrategicResources;
  residents: number;
}
export interface BorderPromises {
  ordinary: Partial<Resources>;
  strategic: StrategicResources;
  operationForecast: BorderOperationForecast[];
  horizon: number;
  failure: string | null;
}
export interface BorderDepartureQuote {
  ruleVersion: 1;
  actorId: number;
  sourceCityId: string;
  sourceTileId: number;
  tileId: number;
  purchaseId: string;
  people: 2 | 3;
  departureRound: number;
  returnByRound: number;
  pathTileIds: number[];
  sourcePopulationBefore: number;
  sourcePopulationAfter: number;
  setup: { materials: number; credits: number };
  cargo: { food: number };
  totalCost: { materials: number; credits: number; food: number };
  legitimacyCost: number;
  householdReserve: { food: number };
  promised: Partial<Resources>;
  promisedStrategic: StrategicResources;
  operationForecast: BorderOperationForecast[];
  promiseHorizon: number;
}
export type BorderQuoteResult = { ok: true; quote: BorderDepartureQuote } | { ok: false; reason: string };
export interface BorderStepReceipt {
  round: number;
  fromTileId: number;
  toTileId: number;
  phase: 'outbound' | 'holding' | 'returning';
  people: number;
  foodBefore: number;
  foodConsumed: number;
  foodAfter: number;
}
export interface BorderReturnReceipt {
  round: number;
  eventId: string;
  sourceCityId: string;
  people: number;
  populationBefore: number;
  populationAfter: number;
  foodRefunded: number;
  foodStockBefore: number;
  foodStockAfter: number;
}
export interface BorderParty {
  id: string;
  side: 'initiator' | 'defender';
  departure: BorderDepartureQuote;
  departureEventId: string;
  people: number;
  casualties: 0 | 1;
  positionTileId: number;
  pathIndex: number;
  phase: 'outbound' | 'holding' | 'returning' | 'returned';
  food: number;
  foodConsumed: number;
  steps: BorderStepReceipt[];
  returned: BorderReturnReceipt | null;
}
export interface BorderControlReceipt {
  ruleVersion: 1;
  incidentId: string;
  purchaseId: string;
  tileId: number;
  previousCivId: number;
  previousCityId: string;
  civId: number;
  cityId: string;
  round: number;
  eventId: string;
}
export interface BorderClashReceipt {
  seedBefore: number;
  seedAfter: number;
  roll: number;
  initiatorPower: number;
  defenderPower: number;
  winnerId: number;
  casualtyCivId: number;
  casualties: 1;
}
export interface BorderResolution {
  round: number;
  eventId: string;
  outcome: 'captured' | 'defended' | 'withdrawn' | 'cancelled';
  reason: string;
  clash: BorderClashReceipt | null;
  control: BorderControlReceipt | null;
}
export interface BorderIncident {
  ruleVersion: 1;
  id: string;
  sequence: number;
  initiatorId: number;
  defenderId: number;
  sourceCityId: string;
  defenderCityId: string;
  tileId: number;
  purchaseId: string;
  openedRound: number;
  openedRevision: number;
  responseDeadlineRound: number;
  resolveRound: number;
  returnByRound: number;
  response: 'pending' | 'defend' | 'yield';
  responseRound: number | null;
  responseEventId: string | null;
  initiator: BorderParty;
  defender: BorderParty | null;
  resolution: BorderResolution | null;
}
export interface BorderResult {
  incident: BorderIncident;
  completedRound: number;
  eventId: string;
}
export interface BorderState {
  ruleVersion: 1;
  active: BorderIncident[];
  sequences: number[];
  lastResults: BorderResult[];
  controls: Record<string, BorderControlReceipt>;
  pairProtectionUntil: Record<string, number>;
  siteProtectionUntil: Record<string, number>;
  initiationCooldownUntil: number[];
  dealCooldownUntil: Record<string, number>;
  draining: { round: number; candidate: Outcome } | null;
}
export type BorderEvent =
  | { kind: 'departure'; incidentId: string; party: BorderParty }
  | { kind: 'response'; incidentId: string; response: 'defend' | 'yield'; actorId: number | null; reason: string }
  | { kind: 'step'; incidentId: string; partyId: string; step: BorderStepReceipt }
  | { kind: 'resolution'; incidentId: string; resolution: BorderResolution }
  | { kind: 'return'; incidentId: string; partyId: string; returned: BorderReturnReceipt }
  | { kind: 'completed'; result: BorderResult };
