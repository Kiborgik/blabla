import type { ActionPlan, ActionPlanItem } from './planning.ts';
import type { CapabilityBlocker } from './simulation/capabilities.ts';
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
export interface ResidentAllocationResult { ruleVersion: 1; openingPopulation: number; communityReserve: number; required: number; available: number; allocated: number }
export interface ResidentCapacityObservation { ruleVersion: 1; communityReserve: number; perPaidRecipe: number; cities: Array<{ cityId: string; capacity: number }> }
export interface BuildingOperationResult { residents?: ResidentAllocationResult; round: number; status: 'operated' | 'blocked' | 'paused'; paid: Partial<Resources>; produced: Partial<Resources>; shortages: Array<{ resource: Resource; required: number; available: number }> }
export interface BuildingOperation { enabled: boolean; lastResult: BuildingOperationResult | null }
export interface ConstructionOrder { tileId?: number; id: string; cityId: string; buildingId: string; ruleVersion: 1; startedRound: number; paid: Partial<Resources>; workRequired: number; workDone: number }
export interface ConstructionCompletion { tileId?: number; orderId: string; cityId: string; buildingId: string; startedRound: number; completedRound: number; paid: Partial<Resources>; workRequired: number; eventId: string }
export interface CityConstruction { active: ConstructionOrder | null; lastCompleted: ConstructionCompletion | null }
export interface ResearchCompletion { technologyId: string; completedRound: number; eventId: string }
export type DecisionBlocker = CapabilityBlocker | { kind: 'no-available-choice' } | { kind: 'zero-work' } | { kind: 'active-commitment'; targetId: string };
export interface DecisionObligation { kind: 'research' | 'construction'; cityId: string | null; status: 'required' | 'active' | 'blocked'; targetId: string | null; progress: { done: number; required: number } | null; availableIds: string[]; blockers: Array<{ capabilityId: string | null; reason: DecisionBlocker }> }
export interface DecisionObligations { research: DecisionObligation; construction: DecisionObligation[] }
export interface CoastalFoundingQuote { mode: 'coast'; ruleVersion: 1; tileIds: number[]; edges: number }
export interface CoastalFoundingReceipt { ruleVersion: 1; sourceCityId: string; sourceTileId: number; destinationTileId: number; pathTileIds: number[]; population: number; paid: Partial<Resources>; foundedRound: number; eventId: string }
export interface City { districtSites?: Record<string, number>; coastalFounding?: CoastalFoundingReceipt; id: string; name: string; civId: number; tileId: number; population: number; wellbeing: number; infrastructure: number; focus: Focus; damage: number; buildings: string[]; buildingOperations?: Record<string, BuildingOperation>; construction?: CityConstruction }
export interface Civilization { id: number; name: string; color: string; adjective: string; objective: string; era: number; resources: Resources; technologies: string[]; researchTarget: string; researchProgress: number; lastResearchCompletion?: ResearchCompletion; influence: number; legitimacy: number; marsProgress: number; marsPopulation: number; marsSupplyStreak: number; federationStreak: number; score: number }
export interface Route { id: string; from: string; to: string; owner: number; partner: number; active: boolean; damage: number; volume: number; agreement?: TradeAgreement }
export interface LandTransportQuote { mode: 'land'; ruleVersion: 1; tileIds: number[]; edges: number }
export interface TradeTerms { transport?: LandTransportQuote; recipeId: string; recipeVersion: number; constructionCost: Partial<Resources>; proposerCargo: Partial<Resources>; recipientCargo: Partial<Resources>; proposerUpkeep: Partial<Resources>; recipientUpkeep: Partial<Resources>; proposerYield: Partial<Resources>; recipientYield: Partial<Resources>; cadenceRounds: number; damageDisableAt: number }
export interface TradeRecipe { id: string; version: number; name: string; description: string; requiredFeatures: readonly string[]; terms: TradeTerms }
export interface TradeAgreement { offerId: string; terms: TradeTerms; enabled: boolean; acceptedRound: number; nextDeliveryRound: number; lastAttemptRound: number | null; lastDeliveryRound: number | null; deliveryCount: number; blockedBy: number | null; blockedReason: string | null; closedRound: number | null }
export interface TradeOffer { id: string; proposer: number; recipient: number; from: string; to: string; createdRound: number; expiresRound: number; status: 'pending' | 'accepted' | 'declined' | 'withdrawn' | 'expired'; terms: TradeTerms; routeId: string | null }
export interface PublicProjectTerms { recipeId: string; recipeVersion: number; proposerContribution: Partial<Resources>; recipientContribution: Partial<Resources>; damageReduction: number; pendingLifetimeRounds: number; completionDelayRounds: number }
export interface PublicProjectRecipe { id: string; version: number; name: string; description: string; requiredFeatures: readonly string[]; requiredTechnology: string; requiredBuilding: string; terms: PublicProjectTerms }
export interface PublicProjectBase { id: string; routeId: string; agreementOfferId: string; proposer: number; recipient: number; terms: PublicProjectTerms; proposedRound: number }
export type PublicProject = PublicProjectBase & ({ status: 'pending'; expiresRound: number } | { status: 'committed'; acceptedRound: number; dueRound: number });
export interface PublicProjectResult { projectId: string; routeId: string; agreementOfferId: string; outcome: 'completed' | 'declined' | 'cancelled' | 'expired' | 'failed' | 'no-work-needed'; reason: string; proposer: number; recipient: number; proposerPaid: Partial<Resources>; recipientPaid: Partial<Resources>; damageBefore: number | null; damageAfter: number | null }
export interface Treaty { id: string; a: number; b: number; kind: 'trade' | 'federation' | 'peace'; since: number }
export interface GameEvent { id: string; round: number; type: string; title: string; detail: string; actor: number | null; target: number | null; tileId: number | null; cause: string; effects: string[]; importance: number; publicProjectResult?: PublicProjectResult; coastalFounding?: CoastalFoundingReceipt }
export interface Outcome { kind: VictoryKind; winners: number[]; round: number; reason: string }
export interface IndependentTurns { epoch: string; strategyTicks: number; lastActionWindow: number[]; actionsInWindow: number[] }
export interface TurnAdmission { mode: 'sequential' | 'independent'; nextActionAt: string | null; nextStrategyAt: string | null }
export interface WorldState { schemaVersion: number; gameVersion: string; releaseId: string; unlockedFeatures: string[]; calendarMilestones: string[]; seed: number; rng: number; revision: number; round: number; year: number; phase: number; width: number; height: number; tiles: HexTile[]; civilizations: Civilization[]; cities: City[]; routes: Route[]; treaties: Treaty[]; tradeOffers?: TradeOffer[]; publicProjects?: PublicProject[]; actionPlans?: Array<ActionPlan | null>; independentTurns?: IndependentTurns; events: GameEvent[]; eventCounts: Record<string, number>; directorIntervals: Record<string, string>; historyAdvances?: Record<string, HistoryAdvanceReceipt>; clockEpoch: string | null; clockTicks: number; outcome: Outcome | null; climate: number; directorCooldown: number }

export type GameAction =
  | { type: 'focus'; focus: Focus; cityId?: string }
  | { type: 'research'; technology: string }
  | { type: 'build'; project: string; cityId?: string; tileId?: number }
  | { type: 'set-building-operation'; cityId: string; buildingId: string; enabled: boolean }
  | { type: 'settle'; tileId: number; sourceCityId?: string }
  | { type: 'settle-coast'; tileId: number; sourceCityId: string }
  | { type: 'trade'; partner: number }
  | { type: 'propose-trade'; partner: number; recipeId: string; sourceCityId?: string; recipientCityId?: string }
  | { type: 'respond-trade'; offerId: string; accept: boolean }
  | { type: 'withdraw-trade'; offerId: string }
  | { type: 'stop-trade'; routeId: string }
  | { type: 'propose-public-project'; routeId: string; recipeId: string }
  | { type: 'respond-public-project'; projectId: string; accept: boolean }
  | { type: 'cancel-public-project'; projectId: string }
  | { type: 'federate'; partner: number }
  | { type: 'repair'; routeId: string }
  | { type: 'repair-city'; cityId: string }
  | { type: 'expedition' }
  | { type: 'event'; event: EventKind; target: number }
  | { type: 'wait' };
export interface Command { seat: number; expectedRevision: number; action: GameAction; timestamp?: string; plan?: ActionPlanItem[]; observedRevision?: number }
export interface ActionOption { coastalQuote?: CoastalFoundingQuote; action: GameAction; label: string; reason: string; tradeQuote?: { transport: LandTransportQuote; cadenceRounds: number } }
export interface Observation { residentCapacity?: ResidentCapacityObservation; gameVersion: string; revision: number; round: number; year: number; seat: number; activeSeat: number | null; admission?: TurnAdmission; decisions?: DecisionObligations; actionPlan?: ActionPlan | null; buildingRecipes?: Array<{ buildingId: string; inputs: Partial<Resources>; outputs: Partial<Resources> }>; civilization: Civilization | null; cities: City[]; rivals: Array<{ id: number; name: string; era: number; population: number; objective: string }>; routes: Route[]; treaties: Treaty[]; tradeOffers?: TradeOffer[]; publicProjects?: PublicProject[]; recentEvents: GameEvent[]; legalActions: ActionOption[]; outcome: Outcome | null }
export interface ActionOutcome { status: 'completed' | 'blocked' | 'failed'; code: string; reason: string }
export interface TransitionResult { ok: boolean; state: WorldState; events: GameEvent[]; error?: string; actionOutcome?: ActionOutcome }
export interface ReplayFrame { state: WorldState; events: GameEvent[] }
export interface CampaignReplay { schemaVersion: number; gameVersion: string; seed: number; source: 'builtin-policies' | 'development-agents' | 'contract-probes' | 'mixed'; title: string; initial: WorldState; frames: ReplayFrame[]; commands: Command[] }
export interface EraDefinition { id: EraId; name: string; year: number; technology: string; cost: number; capability: string }
export interface CivilizationDefinition { name: string; adjective: string; color: string; capital: string; objective: string; focus: Focus }
export interface DirectorEventDefinition { id: EventKind; name: string; description: string; consequence: string; requiredFeatures: readonly string[]; minEra: number; effects: EffectDefinition[]; releasedEffects?: { requiredFeatures: readonly string[]; effects: EffectDefinition[] }; cooldown: number }

export type EffectDefinition =
  | { kind: 'resource'; resource: Resource; amount: number }
  | { kind: 'city'; field: 'population' | 'wellbeing' | 'infrastructure' | 'damage'; amount: number }
  | { kind: 'civilization'; field: 'influence' | 'legitimacy'; amount: number }
  | { kind: 'route'; field: 'damage'; amount: number };
export interface TechnologyDefinition { id: string; name: string; requiredFeatures: readonly string[]; era: number; cost: number; requires: string[]; capability: string }
export type BuildingCapability = 'coastal-departure';
export interface DistrictDefinition { range: number; adjacency: { terrain: Terrain; resource: Resource; amount: number; maximum: number } }
export interface BuildingDefinition { district?: DistrictDefinition; requiresBuildings?: readonly string[]; capabilities?: readonly BuildingCapability[]; siteRequirement?: 'coastal'; id: string; name: string; requiredFeatures: readonly string[]; minEra: number; cost: Partial<Resources>; requires: string[]; effects: EffectDefinition[]; production: Partial<Resources>; operatingInputs?: Partial<Resources>; description: string }

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

export type HistoryCause = { kind: 'feature' | 'event'; id: string };
export interface HistoryAdvanceCommand { expectedRevision: number; cause: HistoryCause; reason: string; deltaYears: number; timestamp: string }
export interface HistoryAdvanceReceipt { cause: HistoryCause; reason: string; deltaYears: number; timestamp: string; revision: number; yearBefore: number; yearAfter: number; evidence: string[] }
export interface CompatibleReleaseDefinition extends ReleaseDefinition { schemaVersion: number; compatibleFrom: readonly string[] }
export interface ReleaseApplyCommand { expectedRevision: number; expectedFromReleaseId: string; targetReleaseId: string; timestamp?: string }

export interface StrategyCatchupResult extends TransitionResult { remainingTicks: number }
