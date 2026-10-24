import type { Focus, ResidentAllocationResult, Resources } from './types.ts';

export type CivicWorksAction = {
  type: 'commission-civic-works';
  cityId: string;
  orderId: string;
  donorBuildingId: 'kiln';
};

export interface CivicWorksCommission {
  id: string;
  civId: number;
  cityId: string;
  orderId: string;
  buildingId: string;
  targetTileId: number;
  donorBuildingId: 'kiln';
  acceptedRound: number;
  firstRound: number;
  expiresRound: number;
  acceptedEventId: string;
}

export interface CivicWorksReceipt {
  ruleVersion: 1;
  commissionId: string;
  civId: number;
  cityId: string;
  orderId: string;
  buildingId: string;
  targetTileId: number;
  donorBuildingId: 'kiln';
  firstRound: number;
  expiresRound: number;
  acceptedEventId: string;
  round: number;
  eventId: string;
  status: 'worked' | 'blocked' | 'ended';
  reason: string;
  paid: Partial<Resources>;
  residents: ResidentAllocationResult | null;
  workBasis: {
    wellbeing: number;
    damage: number;
    infrastructure: number;
    focus: Focus;
    governmentWork: number;
    capitalPercent: number;
  } | null;
  ordinaryWork: number;
  extraWork: number;
  workBefore: number;
  workRequired: number;
  terminal: 'order-completed' | 'order-lost' | 'expired' | null;
}

export interface CivicWorksState {
  ruleVersion: 1;
  active: CivicWorksCommission[];
  lastResults: Array<CivicWorksReceipt | null>;
}
