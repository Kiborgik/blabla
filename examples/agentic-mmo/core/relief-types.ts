import type { FOOD_BUDGET_RULES } from './food-security-content.ts';
import type { LandTransportQuote } from './types.ts';

export type ReliefAction =
  | { type: 'propose-relief'; routeId: string; sourceCityId: string; recipientCityId: string }
  | { type: 'respond-relief'; charterId: string; accept: boolean }
  | { type: 'withdraw-relief'; charterId: string };

export interface LegacyReliefProposalFacts {
  donorPopulation: number;
  recipientPopulation: number;
  donorFood: number;
  donorEnergy: number;
  recipientFood: number;
  promisedFood: number;
  promisedEnergy: number;
  horizonRounds: number;
}

export type ReliefProposalFacts = LegacyReliefProposalFacts | (LegacyReliefProposalFacts & { kind: 'versioned-food'; foodRule: typeof FOOD_BUDGET_RULES.ruleId });

export interface ReliefTerms {
  ruleVersion: 1;
  routeId: string;
  agreementOfferId: string;
  donorId: number;
  recipientId: number;
  sourceCityId: string;
  recipientCityId: string;
  sourceTileId: number;
  recipientTileId: number;
  path: LandTransportQuote;
  damageDisableAt: number;
  food: number;
  energy: 1;
  travelRounds: number;
  proposal: ReliefProposalFacts;
}

export type ReliefCharter = {
  id: string;
  sequence: number;
  proposedRound: number;
  terms: ReliefTerms;
} & (
  | { status: 'proposed'; expiresRound: number }
  | { status: 'accepted'; acceptedRound: number; dueRound: number }
);

export interface ReliefBalances { donorFood: number; donorEnergy: number; recipientFood: number }
export interface ReliefResult {
  ruleVersion: 1;
  charter: ReliefCharter;
  outcome: 'delivered' | 'declined' | 'withdrawn' | 'expired' | 'failed';
  reason: string;
  actor: number | null;
  resolvedRound: number;
  eventId: string;
  before: ReliefBalances;
  after: ReliefBalances;
  paid: { food: number; energy: number };
  deliveredFood: number;
}
export interface ReliefState { ruleVersion: 1; active: ReliefCharter[]; lastResults: Array<ReliefResult | null> }
export type ReliefProposalQuote = { ok: true; terms: ReliefTerms } | { ok: false; reason: string };
