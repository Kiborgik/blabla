export const SCHEMA_VERSION = 1;
export const GAME_VERSION = '0.1.0';
export const CIV_COUNT = 5;
export const DIRECTOR_SEAT = 5;

export type Resource = 'food' | 'materials' | 'energy' | 'credits' | 'science' | 'culture';
export type Resources = Record<Resource, number>;
export type Focus = 'growth' | 'industry' | 'research' | 'culture' | 'diplomacy';
export type Terrain = 'ocean' | 'grassland' | 'forest' | 'desert' | 'mountain' | 'tundra';
export type EraId = 'settlement' | 'states' | 'connected' | 'industrial' | 'planetary' | 'interplanetary';
export type EventKind = 'drought' | 'earthquake' | 'resource-boom' | 'crypto-boom' | 'ufo-contact' | 'calm';
export type VictoryKind = 'mars' | 'federation' | 'cultural' | 'economic' | 'military';

export interface HexTile { id: number; q: number; r: number; terrain: Terrain; elevation: number; owner: number | null; resource: Resource | null }
export interface City { id: string; name: string; civId: number; tileId: number; population: number; wellbeing: number; infrastructure: number; focus: Focus; damage: number; buildings: string[] }
export interface Civilization { id: number; name: string; color: string; adjective: string; objective: string; era: number; resources: Resources; technologies: string[]; researchTarget: string; researchProgress: number; influence: number; legitimacy: number; marsProgress: number; marsPopulation: number; marsSupplyStreak: number; federationStreak: number; score: number }
export interface Route { id: string; from: string; to: string; owner: number; partner: number; active: boolean; damage: number; volume: number }
export interface Treaty { id: string; a: number; b: number; kind: 'trade' | 'federation' | 'peace'; since: number }
export interface GameEvent { id: string; round: number; type: string; title: string; detail: string; actor: number | null; target: number | null; tileId: number | null; cause: string; effects: string[]; importance: number }
export interface Outcome { kind: VictoryKind; winners: number[]; round: number; reason: string }
export interface WorldState { schemaVersion: number; gameVersion: string; releaseId: string; unlockedFeatures: string[]; calendarMilestones: string[]; seed: number; rng: number; revision: number; round: number; year: number; phase: number; width: number; height: number; tiles: HexTile[]; civilizations: Civilization[]; cities: City[]; routes: Route[]; treaties: Treaty[]; events: GameEvent[]; eventCounts: Record<string, number>; directorIntervals: Record<string, string>; clockEpoch: string | null; clockTicks: number; outcome: Outcome | null; climate: number; directorCooldown: number }

export type GameAction =
  | { type: 'focus'; focus: Focus }
  | { type: 'research'; technology: string }
  | { type: 'build'; project: string }
  | { type: 'settle'; tileId: number }
  | { type: 'trade'; partner: number }
  | { type: 'federate'; partner: number }
  | { type: 'repair'; routeId: string }
  | { type: 'expedition' }
  | { type: 'event'; event: EventKind; target: number }
  | { type: 'wait' };
export interface Command { seat: number; expectedRevision: number; action: GameAction }
export interface ActionOption { action: GameAction; label: string; reason: string }
export interface Observation { gameVersion: string; revision: number; round: number; year: number; seat: number; activeSeat: number; civilization: Civilization | null; cities: City[]; rivals: Array<{ id: number; name: string; era: number; population: number; objective: string }>; routes: Route[]; treaties: Treaty[]; recentEvents: GameEvent[]; legalActions: ActionOption[]; outcome: Outcome | null }
export interface TransitionResult { ok: boolean; state: WorldState; events: GameEvent[]; error?: string }
export interface ReplayFrame { state: WorldState; events: GameEvent[] }
export interface CampaignReplay { schemaVersion: number; gameVersion: string; seed: number; source: 'builtin-policies' | 'development-agents' | 'contract-probes' | 'mixed'; title: string; initial: WorldState; frames: ReplayFrame[]; commands: Command[] }
export interface EraDefinition { id: EraId; name: string; year: number; technology: string; cost: number; capability: string }
export interface CivilizationDefinition { name: string; adjective: string; color: string; capital: string; objective: string; focus: Focus }
export interface DirectorEventDefinition { id: EventKind; name: string; description: string; consequence: string; requiredFeatures: readonly string[]; minEra: number; effects: EffectDefinition[]; cooldown: number }

export type EffectDefinition =
  | { kind: 'resource'; resource: Resource; amount: number }
  | { kind: 'city'; field: 'population' | 'wellbeing' | 'infrastructure' | 'damage'; amount: number }
  | { kind: 'civilization'; field: 'influence' | 'legitimacy'; amount: number }
  | { kind: 'route'; field: 'damage'; amount: number };
export interface TechnologyDefinition { id: string; name: string; requiredFeatures: readonly string[]; era: number; cost: number; requires: string[]; capability: string }
export interface BuildingDefinition { id: string; name: string; requiredFeatures: readonly string[]; minEra: number; cost: Partial<Resources>; requires: string[]; effects: EffectDefinition[]; production: Partial<Resources>; description: string }

export interface FeatureDefinition { id: string; name: string; description: string }
export interface ReleaseDefinition { id: string; gameVersion: string; featureIds: readonly string[] }
export type MilestoneCondition =
  | { kind: 'city-count'; minimum: number }
  | { kind: 'building-count'; building: string; minimum: number }
  | { kind: 'recorded-event-count'; eventType: string; minimum: number }
  | { kind: 'total-population'; minimum: number }
  | { kind: 'active-routes'; minimum: number }
  | { kind: 'event'; eventType: string }
  | { kind: 'technology'; technology: string; civilizations: number };
export interface HistoricalMilestone { id: string; name: string; requiredFeatures: readonly string[]; requiresMilestones: readonly string[]; conditions: readonly MilestoneCondition[]; year: number; era: number; explanation: string }

export interface DirectorTickCommand { expectedRevision: number; kind: 'event' | 'review' | 'clock'; intervalId: string; timestamp: string; event: EventKind; target: number }
