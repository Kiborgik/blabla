export type WoodlandImprovementId = 'lumber-mill' | 'charcoal-clearing';

export interface WoodlandStand {
  stock: number;
  lastHarvestRound: number | null;
}

export interface WoodlandHarvester {
  cityId: string;
  civId: number;
  improvementId: WoodlandImprovementId;
  orderId: string;
}

export interface WoodlandBeatEntry {
  tileId: number;
  opening: number;
  harvested: number;
  recovered: number;
  closing: number;
  harvester: WoodlandHarvester | null;
}

export interface WoodlandBeat {
  ruleVersion: 1;
  profileId: 'worked-woodlands-1';
  round: number;
  eventId: string;
  entries: WoodlandBeatEntry[];
}

export type WoodlandPlan = Omit<WoodlandBeat, 'eventId'>;

export interface WoodlandState {
  ruleVersion: 1;
  profileId: 'worked-woodlands-1';
  stands: Record<string, WoodlandStand>;
  lastBeat: WoodlandBeat | null;
}

export interface WoodlandOperationReceipt {
  ruleVersion: 1;
  profileId: 'worked-woodlands-1';
  tileId: number;
  required: number;
  opening: number;
  harvested: number;
  recovered: number;
  closing: number;
}
