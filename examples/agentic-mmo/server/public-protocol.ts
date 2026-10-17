import type { Command, DirectorTickCommand, GameEvent, HistoryAdvanceCommand, ReleaseApplyCommand, WorldState } from '../core/types.ts';

export type PublicTransition =
  | { kind: 'action'; command: Command }
  | { kind: 'director-tick'; command: DirectorTickCommand }
  | { kind: 'clock-catchup'; expectedRevision: number; timestamp: string }
  | { kind: 'strategy-catchup'; expectedRevision: number; timestamp: string }
  | { kind: 'history-advance'; command: HistoryAdvanceCommand }
  | { kind: 'release-apply'; command: ReleaseApplyCommand };

export interface PublicProvenance { kind: 'development-agent' | 'clock-service'; model: string | null; seat: number; commandId: string; recordedAt: string }
export interface PublicChronicleEntry { transition: PublicTransition; provenance: PublicProvenance; events: GameEvent[]; startRevision: number; endRevision: number }
export interface PublicHistoryEntry extends PublicChronicleEntry { state: WorldState }
export interface PublicPage<T> { entries: T[]; hasMore: boolean; nextRevision: number | null }
export type PublicChroniclePage = PublicPage<PublicChronicleEntry>;
export type PublicHistoryPage = PublicPage<PublicHistoryEntry>;
export interface PublicWorldRead { ok: true; authoritative: true; initial: WorldState; state: WorldState }
