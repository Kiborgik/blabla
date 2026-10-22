import type { BuildingOperationResult, ImprovementOperationResult, ConstructionCompletion, ConstructionOrder, GameAction, Command, DirectorTickCommand, GameEvent, HistoryAdvanceCommand, ReleaseApplyCommand, WorldState } from '../core/types.ts';

export type PublicTransition =
  | { kind: 'action'; command: Command }
  | { kind: 'director-tick'; command: DirectorTickCommand }
  | { kind: 'clock-catchup'; expectedRevision: number; timestamp: string }
  | { kind: 'strategy-catchup'; expectedRevision: number; timestamp: string }
  | { kind: 'history-advance'; command: HistoryAdvanceCommand }
  | { kind: 'release-apply'; command: ReleaseApplyCommand };

export interface ProceduralProvenance { version: string; profileId: string; phase: string; reason: string; decision: number; seed: number }
export interface PublicProvenance { kind: 'development-agent' | 'clock-service' | 'procedural-policy'; model: string | null; seat: number; commandId: string; recordedAt: string; policy?: ProceduralProvenance }
export interface PublicChronicleEntry { transition: PublicTransition; provenance: PublicProvenance; events: GameEvent[]; startRevision: number; endRevision: number }
export interface PublicHistoryEntry extends PublicChronicleEntry { state: WorldState }
export interface PublicPage<T> { entries: T[]; hasMore: boolean; nextRevision: number | null }
export type PublicChroniclePage = PublicPage<PublicChronicleEntry>;
export type PublicHistoryPage = PublicPage<PublicHistoryEntry>;
export interface PublicWorldRead { ok: true; authoritative: true; initial: WorldState; state: WorldState }

export function isPublicProvenance(value: unknown): value is PublicProvenance {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  const text = (item: unknown, maximum: number): item is string => typeof item === 'string' && item.trim().length > 0 && item.length <= maximum;
  if (!Number.isSafeInteger(entry.seat) || Number(entry.seat) < 0 || Number(entry.seat) > 5
    || !text(entry.commandId, 1000) || !text(entry.recordedAt, 64) || !Number.isFinite(Date.parse(entry.recordedAt))) return false;
  if (entry.kind === 'development-agent') return text(entry.model, 200) && entry.policy === undefined;
  if (entry.kind === 'clock-service') return entry.model === null && entry.policy === undefined;
  if (entry.kind !== 'procedural-policy' || entry.model !== null || typeof entry.policy !== 'object' || entry.policy === null || Array.isArray(entry.policy)) return false;
  const policy = entry.policy as Record<string, unknown>;
  return text(policy.version, 128) && text(policy.profileId, 128) && text(policy.phase, 128) && text(policy.reason, 1000)
    && Number.isSafeInteger(policy.decision) && Number(policy.decision) > 0
    && Number.isSafeInteger(policy.seed) && Number(policy.seed) >= 0 && Number(policy.seed) <= 0xffffffff;
}

export const RECORDED_CHOICES_FORMAT = 'recorded-choices-v1';
export interface RecordedChoiceProvenance { kind: PublicProvenance['kind']; model: string | null; seat: number; recordedAt: string; policy: Omit<ProceduralProvenance, 'reason'> | null }
export interface RecordedChronicleEntry { startRevision: number; endRevision: number; kind: PublicTransition['kind']; action: GameAction | null; provenance: RecordedChoiceProvenance; recordedReason: string | null; events: GameEvent[] }
export interface RecordedChroniclePage extends PublicPage<RecordedChronicleEntry> { format: typeof RECORDED_CHOICES_FORMAT; after: number; through: number }
export interface RecordedTownConsequences {
  status: 'available' | 'unavailable';
  unavailableReason: 'transition_not_found' | 'civilization_not_found' | 'town_not_found' | 'town_not_owned' | null;
  cityId: string;
  name: string | null;
  construction: { active: ConstructionOrder | null; started: ConstructionOrder | null; completed: ConstructionCompletion | null; lastCompleted: ConstructionCompletion | null };
  operations: Array<{ buildingId: string; enabled: boolean; result: BuildingOperationResult | null }>;
  improvements: Array<{ improvementId: string; tileId: number; enabled: boolean; result: ImprovementOperationResult | null }>;
}
export interface RecordedChoiceDetail {
  format: typeof RECORDED_CHOICES_FORMAT;
  endRevision: number;
  civilizationId: number;
  cityId: string;
  entry: RecordedChronicleEntry | null;
  recordedReason: string | null;
  consequences: {
    status: 'available' | 'unavailable';
    basis: 'exact-end-revision-snapshot';
    revision: number | null;
    round: number | null;
    year: number | null;
    releaseId: string | null;
    town: RecordedTownConsequences;
  };
}
