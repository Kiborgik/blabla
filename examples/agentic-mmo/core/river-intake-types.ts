export interface RiverIntakeFlowReceipt {
  ruleVersion: 1;
  ruleId: 'uniform-runoff-1';
  tileId: number;
  downstreamTileId: number;
  outletTileId: number;
  required: number;
  availableBefore: number;
  withdrawn: number;
  remainingAfter: number;
  supportBuildingId: 'irrigation';
  supportAllocationRound: number | null;
}

export interface RiverFlowWithdrawal {
  cityId: string;
  civId: number;
  tileId: number;
  orderId: string;
  quantity: number;
}

export interface RiverFlowOutlet {
  tileId: number;
  quantity: number;
}

export interface RiverFlowBeat {
  ruleVersion: 1;
  ruleId: 'uniform-runoff-1';
  round: number;
  sourceUnits: number;
  withdrawals: RiverFlowWithdrawal[];
  outlets: RiverFlowOutlet[];
  eventId: string;
}

export type RiverFlowPlan = Omit<RiverFlowBeat, 'eventId'>;

export interface RiverFlowState {
  ruleVersion: 1;
  ruleId: 'uniform-runoff-1';
  lastBeat: RiverFlowBeat | null;
}
