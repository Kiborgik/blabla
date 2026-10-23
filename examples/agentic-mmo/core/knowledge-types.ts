import type { KNOWLEDGE_INSTITUTION_IDS, KNOWLEDGE_TECHNOLOGY_IDS } from './knowledge-content.ts';
import type { BuildingOperationResult, Resources, StrategicResources, TradeTerms } from './types.ts';

export type KnowledgeTechnologyId = typeof KNOWLEDGE_TECHNOLOGY_IDS[number];
export type KnowledgeInstitutionId = typeof KNOWLEDGE_INSTITUTION_IDS[number];
export type KnowledgeAction =
  | { type: 'propose-knowledge'; routeId: string; teacherCityId: string; learnerCityId: string; technologyId: KnowledgeTechnologyId; teacherInstitutionId: KnowledgeInstitutionId; learnerInstitutionId: KnowledgeInstitutionId }
  | { type: 'respond-knowledge'; compactId: string; accept: boolean }
  | { type: 'withdraw-knowledge'; compactId: string };

export interface ResolvedTradeDelivery {
  ruleVersion: 1;
  routeId: string;
  agreementOfferId: string;
  agreementAcceptedRound: number;
  owner: number;
  partner: number;
  fromCityId: string;
  toCityId: string;
  fromTileId: number;
  toTileId: number;
  round: number;
  revision: number;
  eventId: string;
  deliveryCount: number;
  tradeTerms: TradeTerms;
  proposerPaid: Partial<Resources>;
  recipientPaid: Partial<Resources>;
  proposerStrategicPaid: StrategicResources;
  recipientStrategicPaid: StrategicResources;
}

export interface KnowledgeTerms {
  ruleVersion: 1;
  routeId: string;
  agreementOfferId: string;
  agreementAcceptedRound: number;
  owner: number;
  partner: number;
  fromCityId: string;
  toCityId: string;
  fromTileId: number;
  toTileId: number;
  tradeTerms: TradeTerms;
  teacherId: number;
  learnerId: number;
  teacherCityId: string;
  learnerCityId: string;
  teacherTileId: number;
  learnerTileId: number;
  teacherInstitutionId: KnowledgeInstitutionId;
  learnerInstitutionId: KnowledgeInstitutionId;
  technologyId: KnowledgeTechnologyId;
  costBasis: number;
  requiredFeatures: string[];
  prerequisites: string[];
  basisReleaseId: string;
  learnerContribution: Partial<Resources>;
  teacherContribution: Partial<Resources>;
  transferred: Partial<Resources>;
  consumed: Partial<Resources>;
  percent: 10;
  nominalAmount: number;
  requiredStudies: 2;
  pendingLifetime: 8;
  studyCadences: 3;
  names: { teacher: string; learner: string; teacherCity: string; learnerCity: string; teacherInstitution: string; learnerInstitution: string; technology: string };
}

export interface KnowledgeInstitutionProof {
  civId: number;
  cityId: string;
  tileId: number;
  institutionId: KnowledgeInstitutionId;
  inputs: Partial<Resources>;
  residentsRequired: number;
  result: BuildingOperationResult;
}

export interface KnowledgeStudyProof {
  delivery: ResolvedTradeDelivery;
  teacher: KnowledgeInstitutionProof;
  learner: KnowledgeInstitutionProof;
}

export interface KnowledgeStudyAttempt {
  delivery: ResolvedTradeDelivery;
  teacher: KnowledgeInstitutionProof | null;
  learner: KnowledgeInstitutionProof | null;
  blockers: Array<{ party: 'teacher' | 'learner'; reason: string }>;
}

export type KnowledgeCompact = {
  id: string;
  sequence: number;
  proposedRound: number;
  proposedRevision: number;
  terms: KnowledgeTerms;
} & (
  | { status: 'proposed'; expiresRound: number }
  | { status: 'accepted'; acceptedRound: number; acceptedRevision: number; baselineDeliveryCount: number; lastSeenDeliveryCount: number; deadlineRound: number; studies: KnowledgeStudyProof[]; lastStudyAttempt: KnowledgeStudyAttempt | null }
);

export type KnowledgeReason = 'settled' | 'declined-by-learner' | 'withdrawn-by-participant' | 'consent-window-ended' | 'study-window-ended' | 'feature-unreleased' | 'route-missing' | 'route-consent-stopped' | 'agreement-replaced' | 'route-participants-changed' | 'route-endpoints-changed' | 'trade-terms-changed' | 'institution-identity-changed' | 'teacher-knowledge-missing' | 'target-already-completed' | 'target-changed' | 'target-ineligible' | 'cost-basis-changed' | 'entitlement-used' | 'learner-contribution-shortfall' | 'teacher-contribution-shortfall' | 'unsafe-accounting' | 'no-positive-work';
export interface KnowledgeBalances { teacher: Resources; learner: Resources }
export interface KnowledgeResult {
  ruleVersion: 1;
  compact: KnowledgeCompact;
  outcome: 'completed' | 'declined' | 'withdrawn' | 'expired' | 'failed';
  reason: KnowledgeReason;
  detail: string;
  actor: number | null;
  resolvedRound: number;
  resolvedRevision: number;
  eventId: string;
  before: KnowledgeBalances;
  after: KnowledgeBalances;
  learnerPaid: Partial<Resources>;
  teacherPaid: Partial<Resources>;
  transferred: Partial<Resources>;
  consumed: Partial<Resources>;
  nominalAmount: number;
  amount: number;
  unusedAmount: number;
  progressBefore: number;
  progressAfter: number;
  researchCompletionEventId: string | null;
}

export interface KnowledgeStudyEvent { compactId: string; attempt: KnowledgeStudyAttempt; studyCount: number }
export interface KnowledgeState {
  ruleVersion: 1;
  active: KnowledgeCompact[];
  sequences: number[];
  lastResults: Array<KnowledgeResult | null>;
  grants: Array<Record<KnowledgeTechnologyId, KnowledgeResult | null>>;
}
export type KnowledgeProposalQuote = { ok: true; terms: KnowledgeTerms } | { ok: false; reason: string };
