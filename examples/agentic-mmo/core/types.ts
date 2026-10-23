import type { KnowledgeAction, KnowledgeCompact, KnowledgeResult, KnowledgeState, KnowledgeStudyEvent } from './knowledge-types.ts';
import type { FoodSupplyReceipt } from './food-security-content.ts';
import type { ReliefAction, ReliefResult, ReliefState } from './relief-types.ts';
import type { HistoricalEventReceipt, HistoricalEventSelection } from './historical-selection.ts';
import type { observedGovernment } from './simulation/government.ts';
import type { ActionPlan, ActionPlanItem } from './planning.ts';
import type { CapabilityBlocker } from './simulation/capabilities.ts';
export const SCHEMA_VERSION = 1;
export const GAME_VERSION = '0.1.0';
export const CIV_COUNT = 5;
export const DIRECTOR_SEAT = 5;

export type Resource = 'food' | 'materials' | 'energy' | 'credits' | 'science' | 'culture';
export type Resources = Record<Resource, number>;
export type PlaceNamingVersion = 'cultural-toponyms-v1';
export type StrategicTemperamentVersion = 'strategic-temperaments-v1';
export interface GeneratedWorldOrigin { namingVersion?: PlaceNamingVersion; temperamentVersion?: StrategicTemperamentVersion; kind: 'generated'; generatorVersion: 'coherent-geography-v1'; seed: number; clockEpoch: string; initialReleaseId?: 'settlement-living-partnerships-1' | 'settlement-relief-charters-1' | 'settlement-regional-targets-1' | 'settlement-food-budget-1' | 'settlement-knowledge-compacts-1' }
export type MarsMissionKind = 'settle' | 'resupply';
export interface MarsMissionQuote { ruleVersion: 1; civId: number; mission: MarsMissionKind; sourceCityId: string; departureRound: number; arrivalRound: number; settlers: number; launchCost: Partial<Resources>; cargo: Partial<Resources>; totalCost: Partial<Resources>; sourcePopulationBefore: number; sourcePopulationAfter: number }
export interface MarsMission extends MarsMissionQuote { id: string; eventId: string; paid: Partial<Resources> }
export interface MarsColony { establishedRound: number; stock: Resources; shortageRounds: number }
export interface MarsArrivalReceipt { ruleVersion: 1; missionId: string; civId: number; sourceCityId: string; round: number; eventId: string; settlers: number; cargo: Partial<Resources>; populationBefore: number; populationAfter: number; stockBefore: Resources; stockAfter: Resources }
export interface MarsUpkeepReceipt { ruleVersion: 1; civId: number; round: number; eventId: string; status: 'supplied' | 'shortage' | 'uninhabited'; required: Partial<Resources>; paid: Partial<Resources>; missing: Partial<Resources>; stockBefore: Resources; stockAfter: Resources; populationBefore: number; populationAfter: number; habitableBefore: boolean; supplyStreakBefore: number; supplyStreakAfter: number; shortageRoundsBefore: number; shortageRoundsAfter: number }
export interface MarsHabitatReceipt { ruleVersion: 1; civId: number; round: number; eventId: string; paid: Partial<Resources>; progressBefore: number; progressAfter: number }
export interface MarsCivilizationState { missionsLaunched: number; activeMission: MarsMission | null; colony: MarsColony | null; lastDeparture: MarsMission | null; lastArrival: MarsArrivalReceipt | null; lastUpkeep: MarsUpkeepReceipt | null; lastHabitatWork: MarsHabitatReceipt | null }
export interface SpaceflightState { ruleVersion: 1; civilizations: MarsCivilizationState[] }
export interface EarnedMilestoneProof { ruleVersion: 1; milestoneId: string; round: number; revision: number; eventId: string; year: number; targetYear: number; era: number }
export type StrategicResource = 'iron' | 'coal';
export type StrategicResources = Partial<Record<StrategicResource, number>>;
export interface StrategicDeposit { tileId: number; resource: StrategicResource; initialReserve: number; remaining: number }
export interface PastoralSite { tileId: number; resource: 'horses' }
export interface PastoralSiteLayer { ruleVersion: 1; placementId: 'pastoral-sites-1'; seed: number; tileIds: number[]; sites: Record<string, PastoralSite> }
export interface StrategicDepositLayer { ruleVersion: 1; placementId: 'iron-placement-1' | 'coal-placement-1'; seed: number; tileIds: number[]; deposits: Record<string, StrategicDeposit> }
export interface StrategicExtractionResult { ruleVersion: 1; tileId: number; round: number; resource: StrategicResource; quantity: number; reserveBefore: number; reserveAfter: number; stockBefore: number; stockAfter: number; capacity: number; status: 'extracted' | 'unrevealed' | 'exhausted' | 'storage-full' }
export interface StrategicShipmentResult { ruleVersion: 1; routeId: string; offerId: string; proposer: number; recipient: number; proposerSent: StrategicResources; recipientSent: StrategicResources }
export type Focus = 'growth' | 'industry' | 'research' | 'culture' | 'diplomacy';
export type Terrain = 'ocean' | 'grassland' | 'forest' | 'desert' | 'mountain' | 'tundra';
export type EraId = 'settlement' | 'states' | 'connected' | 'industrial' | 'planetary' | 'interplanetary';
export type EventKind = 'drought' | 'earthquake' | 'resource-boom' | 'crypto-boom' | 'ufo-contact' | 'calm' | 'cultivated-harvest' | 'forest-fire' | 'coastal-storm' | 'trade-fair' | 'industrial-accident' | 'internal-migration';
export type VictoryKind = 'mars' | 'federation' | 'cultural' | 'economic' | 'military';

export interface TileAcquisitionQuote { ruleVersion: 1; cityId: string; civId: number; cityTileId: number; tileId: number; pathTileIds: number[]; distance: number; priorCivilizationPurchases: number; paid: { credits: number } }
export interface TileAcquisitionReceipt extends TileAcquisitionQuote { id: string; acquiredRound: number; eventId: string }
export interface TerritoryObservation { purchases: TileAcquisitionReceipt[]; cities: Array<{ cityId: string; available: TileAcquisitionQuote[]; blocked: Array<{ tileId: number; reason: string }> }> }

export interface HexTile { id: number; q: number; r: number; terrain: Terrain; elevation: number; owner: number | null; resource: Resource | null }
export interface ResidentAllocationResult { ruleVersion: 1; openingPopulation: number; communityReserve: number; required: number; available: number; allocated: number }
export interface ResidentCapacityObservation { ruleVersion: 1; communityReserve: number; perPaidRecipe: number; cities: Array<{ cityId: string; capacity: number }> }
export interface BuildingOperationResult { localPower?: LocalPowerOperationFlow; emissionsProduced?: number; operationEventId?: string; strategicPaid?: StrategicResources; strategicShortages?: Array<{ resource: StrategicResource; required: number; available: number }>; residents?: ResidentAllocationResult; round: number; status: 'operated' | 'blocked' | 'paused'; paid: Partial<Resources>; produced: Partial<Resources>; shortages: Array<{ resource: Resource; required: number; available: number }> }
export interface BuildingOperation { enabled: boolean; lastResult: BuildingOperationResult | null }
export interface LocalPowerOperationFlow { ruleVersion: 1; required: number; availableBefore: number; consumed: number; generated: number; shortage: number }
export interface LocalPowerRecipeSnapshot { ruleVersion: 1; inputs: Partial<Resources>; strategicInputs: StrategicResources; baseOutputs: Partial<Resources>; residentsRequired: number; localPowerInput: number; localPowerOutput: number; emissionsPerOperation: number }
export interface LocalPowerOperationResult extends BuildingOperationResult { residents: ResidentAllocationResult; strategicPaid: StrategicResources; strategicShortages: Array<{ resource: StrategicResource; required: number; available: number }>; localPower: LocalPowerOperationFlow; emissionsProduced: number; operationEventId: string }
export interface LocalPowerOperationReceipt { buildingId: string; phase: 'generator' | 'consumer'; recipe: LocalPowerRecipeSnapshot; result: LocalPowerOperationResult }
export interface LocalPowerBeatReceipt { ruleVersion: 1; cityId: string; civId: number; round: number; eventId: string; openingPopulation: number; communityReserve: number; operations: LocalPowerOperationReceipt[]; generated: number; consumed: number; expired: number }
export interface CityLocalPower { ruleVersion: 1; lastBeat: LocalPowerBeatReceipt | null; lastProductiveBeat: LocalPowerBeatReceipt | null }

export interface CampusHighGroundSite { campusTileId: number; sourceTileId: number }
export interface BuildingConstructionOrder { highGround?: CampusHighGroundSite; catchmentTileId?: number; tileId?: number; id: string; cityId: string; buildingId: string; ruleVersion: 1; startedRound: number; paid: Partial<Resources>; workRequired: number; workDone: number }
export interface ImprovementConstructionOrder { kind: 'improvement'; id: string; cityId: string; improvementId: string; tileId: number; ruleVersion: 1; startedRound: number; paid: Partial<Resources>; workRequired: number; workDone: number }
export interface WonderConstructionOrder { kind: 'wonder'; ruleVersion: 1; id: string; wonderId: string; cityId: string; tileId: number; startedRound: number; paid: Partial<Resources>; workRequired: number; workDone: number }
export interface WonderCompletion { kind: 'wonder'; ruleVersion: 1; wonderId: string; orderId: string; civId: number; cityId: string; tileId: number; startedRound: number; completedRound: number; paid: Partial<Resources>; workRequired: number; eventId: string }
export interface WonderLossReceipt { ruleVersion: 1; wonderId: string; orderId: string; civId: number; cityId: string; tileId: number; startedRound: number; paid: Partial<Resources>; workRequired: number; workDone: number; refund: Partial<Resources>; resolvedRound: number; winnerOrderId: string; eventId: string }
export interface ResearchBoostReceipt { ruleVersion: 1; wonderId: string; wonderCompletionEventId: string; civId: number; technologyId: string; basisReleaseId: string; percent: 20; costBasis: number; nominalAmount: number; progressBefore: number; amount: number; progressAfter: number; unusedAmount: number; round: number; eventId: string; researchCompletionEventId: string | null }
export interface CompletedWonderRecord { ruleVersion: 1; completion: WonderCompletion; losses: WonderLossReceipt[]; boostLimit: 2; boostPercent: 20; boosts: ResearchBoostReceipt[] }
export interface WonderBoostQuote { technologyId: string; costBasis: number; nominalAmount: number; progressBefore: number; amount: number; progressAfter: number; unusedAmount: number }
export interface WonderContenderObservation extends WonderConstructionOrder { civId: number }
export interface WonderObservation { wonderId: string; contenders: WonderContenderObservation[]; completed: CompletedWonderRecord | null; boost: { remaining: number; blocker: string | null; quote: WonderBoostQuote | null } }
export interface RailConstructionOrder { kind: 'rail'; ruleVersion: 1; id: string; cityId: string; edgeId: string; tileId: number; toTileId: number; startedRound: number; paid: Partial<Resources>; strategicPaid: StrategicResources; workRequired: number; workDone: number }
export interface RailCompletion { kind: 'rail'; ruleVersion: 1; orderId: string; cityId: string; civId: number; edgeId: string; tileId: number; toTileId: number; startedRound: number; completedRound: number; paid: Partial<Resources>; strategicPaid: StrategicResources; workRequired: number; eventId: string }
export interface RailObservation { cityId: string | null; active: RailConstructionOrder | null; completed: RailCompletion[]; available: Array<{ edgeId: string; tileId: number; toTileId: number; paid: Partial<Resources>; strategicPaid: StrategicResources; workRequired: number }>; blocker: string | null }
export type ConstructionOrder = BuildingConstructionOrder | ImprovementConstructionOrder | WonderConstructionOrder | RailConstructionOrder;
export interface BuildingConstructionCompletion { highGround?: CampusHighGroundSite; catchmentTileId?: number; tileId?: number; orderId: string; cityId: string; buildingId: string; startedRound: number; completedRound: number; paid: Partial<Resources>; workRequired: number; eventId: string }
export interface ImprovementConstructionCompletion { kind: 'improvement'; orderId: string; cityId: string; improvementId: string; tileId: number; startedRound: number; completedRound: number; paid: Partial<Resources>; workRequired: number; eventId: string }
export type ConstructionCompletion = BuildingConstructionCompletion | ImprovementConstructionCompletion | WonderCompletion | RailCompletion;
export interface ImprovementOperationResult { inputs?: Array<{ resource: Resource; required: number; available: number }>; shortages?: Array<{ resource: Resource; required: number; available: number }>; extraction?: StrategicExtractionResult; round: number; status: 'operated' | 'blocked' | 'paused'; paid: Partial<Resources>; produced: Partial<Resources>; residents: ResidentAllocationResult; blockedReason: 'resident-shortage' | 'site-ineligible' | 'input-shortage' | null }
export interface CityImprovement { improvementId: string; tileId: number; completion: ImprovementConstructionCompletion; operation: { enabled: boolean; lastResult: ImprovementOperationResult | null } }
export interface CityConstruction { active: ConstructionOrder | null; lastCompleted: ConstructionCompletion | null }
export type PolicySlotType = 'military' | 'economic' | 'diplomatic' | 'wildcard';
export interface PolicyAssignment { slotType: PolicySlotType; slotIndex: number; policyId: string }
export interface CivicCompletion { civicId: string; completedRound: number; eventId: string }
export interface CivicState { ruleVersion: 1; completedCivicIds: string[]; active: { civicId: string; startedRound: number; progress: number; requiredCulture: number } | null; lastCompleted: CivicCompletion | null; reformEntitlement: { civicId: string; completedRound: number; completionEventId: string } | null }
export interface GovernmentState { ruleVersion: 1; lastSpentReformCompletionEventId: string | null; active: { governmentId: string; assignments: PolicyAssignment[]; effectiveRound: number; governmentLockUntilRound: number; policyLockUntilRound: number } | null; pending: { targetGovernmentId: string; targetAssignments: PolicyAssignment[]; acceptedRound: number; completionRound: number; paidCredits: number; spentCompletionEventId: string | null } | null }
export interface CivicDefinition { id: string; name: string; requiredFeatures: readonly string[]; requires: string[]; cost: number; capability: string }
export interface GovernmentDefinition { id: string; name: string; requiredFeatures: readonly string[]; requires: string[]; slots: Record<PolicySlotType, number>; baseProduction: Partial<Resources>; capitalConstructionWorkPercent?: number }
export interface PolicyDefinition { id: string; name: string; requiredFeatures: readonly string[]; requires: string[]; slotType: Exclude<PolicySlotType, 'wildcard'>; constructionWork: number }
export interface ResearchCompletion { technologyId: string; completedRound: number; eventId: string }
export type DecisionBlocker = CapabilityBlocker | { kind: 'civic-prerequisite'; civicId: string } | { kind: 'no-available-choice' } | { kind: 'zero-work' } | { kind: 'active-commitment'; targetId: string };
export interface DecisionObligation { kind: 'research' | 'construction' | 'civic'; cityId: string | null; status: 'required' | 'active' | 'blocked'; targetId: string | null; progress: { done: number; required: number } | null; availableIds: string[]; blockers: Array<{ capabilityId: string | null; reason: DecisionBlocker }> }
export interface DecisionObligations { civic?: DecisionObligation; research: DecisionObligation; construction: DecisionObligation[] }
export interface CoastalFoundingQuote { mode: 'coast'; ruleVersion: 1; tileIds: number[]; edges: number }
export interface CoastalFoundingReceipt { ruleVersion: 1; sourceCityId: string; sourceTileId: number; destinationTileId: number; pathTileIds: number[]; population: number; paid: Partial<Resources>; foundedRound: number; eventId: string }
export interface CityHousing { ruleVersion: 1; baseCapacity: number; establishedRound: number; origin: 'initial-capital' | 'founded' }
export interface CityGrowthFacts { cityId: string; ruleVersion: 1; population: number; baseCapacity: number; sources: Array<{ buildingId: string; capacity: number }>; capacity: number; nextGrowthFoodCost: number }
export interface PopulationGrowthReceipt { ruleVersion: 1; cityId: string; civId: number; round: number; eventId: string; populationBefore: number; populationAfter: number; capacity: number; foodPaid: number }
export interface City { lastFoodSupply?: FoodSupplyReceipt; localPower?: CityLocalPower; buildingHighGround?: Record<string, CampusHighGroundSite>; buildingCatchments?: Record<string, number>; housing?: CityHousing; improvements?: Record<string, CityImprovement>; districtSites?: Record<string, number>; coastalFounding?: CoastalFoundingReceipt; id: string; name: string; civId: number; tileId: number; population: number; wellbeing: number; infrastructure: number; focus: Focus; damage: number; buildings: string[]; buildingOperations?: Record<string, BuildingOperation>; construction?: CityConstruction }
export interface Civilization { civics?: CivicState; government?: GovernmentState; strategicResources?: StrategicResources; id: number; name: string; color: string; adjective: string; objective: string; era: number; resources: Resources; technologies: string[]; researchTarget: string; researchProgress: number; lastResearchCompletion?: ResearchCompletion; influence: number; legitimacy: number; marsProgress: number; marsPopulation: number; marsSupplyStreak: number; federationStreak: number; score: number }
export interface Route { id: string; from: string; to: string; owner: number; partner: number; active: boolean; damage: number; volume: number; agreement?: TradeAgreement }
export interface LandTransportQuote { mode: 'land'; ruleVersion: 1; tileIds: number[]; edges: number }
export interface SteamTransportQuote { mode: 'steam'; ruleVersion: 1; tileIds: number[]; edges: number; edgeWeights: number[]; railEdges: Array<{ edgeId: string; completionEventId: string }>; weightedDistance: number; baseCadence: number; unrailedEdges: number; unrailedCadence: number; proposerFuel: { coal: 1 } }
export type TransportQuote = LandTransportQuote | SteamTransportQuote;
export interface SteamDeliveryReceipt { ruleVersion: 1; routeId: string; offerId: string; proposer: number; recipient: number; acceptedRound: number; round: number; eventId: string; terms: TradeTerms; proposerPaid: Partial<Resources>; recipientPaid: Partial<Resources>; proposerStrategicPaid: StrategicResources; recipientStrategicPaid: StrategicResources }
export interface IndustrialFoundryReceipt { ruleVersion: 1; cityId: string; civId: number; round: number; eventId: string; paid: Partial<Resources>; strategicPaid: StrategicResources; produced: Partial<Resources>; residents: ResidentAllocationResult }
export interface IndustrialEvidence { ruleVersion: 1; foundryOperations: IndustrialFoundryReceipt[]; steamDelivery: SteamDeliveryReceipt | null }
export interface TradeTerms { strategicCargo?: { proposer: StrategicResources; recipient: StrategicResources }; transport?: TransportQuote; recipeId: string; recipeVersion: number; constructionCost: Partial<Resources>; proposerCargo: Partial<Resources>; recipientCargo: Partial<Resources>; proposerUpkeep: Partial<Resources>; recipientUpkeep: Partial<Resources>; proposerYield: Partial<Resources>; recipientYield: Partial<Resources>; cadenceRounds: number; damageDisableAt: number }
export interface TradeRecipe { requiredTechnology?: string; id: string; version: number; name: string; description: string; requiredFeatures: readonly string[]; terms: TradeTerms }
export interface TradeAgreement { lastSteamDelivery?: SteamDeliveryReceipt | null; offerId: string; terms: TradeTerms; enabled: boolean; acceptedRound: number; nextDeliveryRound: number; lastAttemptRound: number | null; lastDeliveryRound: number | null; deliveryCount: number; blockedBy: number | null; blockedReason: string | null; closedRound: number | null }
export interface TradeOffer { id: string; proposer: number; recipient: number; from: string; to: string; createdRound: number; expiresRound: number; status: 'pending' | 'accepted' | 'declined' | 'withdrawn' | 'expired'; terms: TradeTerms; routeId: string | null }
export interface PublicProjectTerms { recipeId: string; recipeVersion: number; proposerContribution: Partial<Resources>; recipientContribution: Partial<Resources>; damageReduction: number; pendingLifetimeRounds: number; completionDelayRounds: number }
export interface PublicProjectRecipe { id: string; version: number; name: string; description: string; requiredFeatures: readonly string[]; requiredTechnology: string; requiredBuilding: string; terms: PublicProjectTerms }
export interface PublicProjectBase { id: string; routeId: string; agreementOfferId: string; proposer: number; recipient: number; terms: PublicProjectTerms; proposedRound: number }
export type PublicProject = PublicProjectBase & ({ status: 'pending'; expiresRound: number } | { status: 'committed'; acceptedRound: number; dueRound: number });
export interface PublicProjectResult { projectId: string; routeId: string; agreementOfferId: string; outcome: 'completed' | 'declined' | 'cancelled' | 'expired' | 'failed' | 'no-work-needed'; reason: string; proposer: number; recipient: number; proposerPaid: Partial<Resources>; recipientPaid: Partial<Resources>; damageBefore: number | null; damageAfter: number | null }
export interface Treaty { id: string; a: number; b: number; kind: 'trade' | 'federation' | 'peace'; since: number }
export interface GameEvent { knowledgeCompact?: KnowledgeCompact; knowledgeStudy?: KnowledgeStudyEvent; knowledgeResult?: KnowledgeResult; reliefResult?: ReliefResult; regionalEvent?: HistoricalEventReceipt; marsDeparture?: MarsMission; marsArrival?: MarsArrivalReceipt; marsUpkeep?: MarsUpkeepReceipt; marsHabitat?: MarsHabitatReceipt; localPower?: LocalPowerBeatReceipt; steamDelivery?: SteamDeliveryReceipt; industrialFoundry?: IndustrialFoundryReceipt; railCompletion?: RailCompletion; territoryAcquisition?: TileAcquisitionReceipt; populationGrowth?: PopulationGrowthReceipt; wonderCompletion?: WonderCompletion; wonderLoss?: WonderLossReceipt; researchBoost?: ResearchBoostReceipt; strategicExtraction?: StrategicExtractionResult; strategicShipment?: StrategicShipmentResult; id: string; round: number; type: string; title: string; detail: string; actor: number | null; target: number | null; tileId: number | null; cause: string; effects: string[]; importance: number; publicProjectResult?: PublicProjectResult; coastalFounding?: CoastalFoundingReceipt }
export interface Outcome { kind: VictoryKind; winners: number[]; round: number; reason: string }
export interface IndependentTurns { epoch: string; strategyTicks: number; lastActionWindow: number[]; actionsInWindow: number[] }
export interface TurnAdmission { mode: 'sequential' | 'independent'; nextActionAt: string | null; nextStrategyAt: string | null }
export interface WorldState { knowledge?: KnowledgeState; relief?: ReliefState; origin?: GeneratedWorldOrigin; spaceflight?: SpaceflightState; milestoneProofs?: Record<string, EarnedMilestoneProof>; coalDeposits?: StrategicDepositLayer; railEdges?: Record<string, RailCompletion>; industrialEvidence?: IndustrialEvidence; tileAcquisitions?: Record<string, TileAcquisitionReceipt>; pastoralSites?: PastoralSiteLayer; wonders?: Record<string, CompletedWonderRecord>; strategicDeposits?: StrategicDepositLayer; schemaVersion: number; gameVersion: string; releaseId: string; unlockedFeatures: string[]; calendarMilestones: string[]; seed: number; rng: number; revision: number; round: number; year: number; phase: number; width: number; height: number; tiles: HexTile[]; civilizations: Civilization[]; cities: City[]; routes: Route[]; treaties: Treaty[]; tradeOffers?: TradeOffer[]; publicProjects?: PublicProject[]; actionPlans?: Array<ActionPlan | null>; independentTurns?: IndependentTurns; events: GameEvent[]; eventCounts: Record<string, number>; directorIntervals: Record<string, string>; historyAdvances?: Record<string, HistoryAdvanceReceipt>; clockEpoch: string | null; clockTicks: number; outcome: Outcome | null; climate: number; directorCooldown: number }

export type GameAction =
  | KnowledgeAction
  | ReliefAction
  | { type: 'choose-civic'; civicId: string }
  | { type: 'adopt-government'; governmentId: string; assignments: PolicyAssignment[] }
  | { type: 'acquire-tile'; cityId: string; tileId: number }
  | { type: 'focus'; focus: Focus; cityId?: string }
  | { type: 'research'; technology: string }
  | { type: 'build-rail'; cityId: string; fromTileId: number; toTileId: number }
  | { type: 'build-wonder'; wonderId: string; cityId: string; tileId: number }
  | { type: 'apply-research-boost'; wonderId: string; technology: string }
  | { type: 'build'; project: string; cityId?: string; tileId?: number }
  | { type: 'improve'; cityId: string; tileId: number; improvementId: string }
  | { type: 'set-improvement-operation'; cityId: string; tileId: number; improvementId: string; enabled: boolean }
  | { type: 'set-building-operation'; cityId: string; buildingId: string; enabled: boolean }
  | { type: 'settle'; tileId: number; sourceCityId?: string }
  | { type: 'settle-coast'; tileId: number; sourceCityId: string }
  | { type: 'trade'; partner: number }
  | { type: 'propose-trade'; transportMode?: 'steam'; partner: number; recipeId: string; sourceCityId?: string; recipientCityId?: string }
  | { type: 'respond-trade'; offerId: string; accept: boolean }
  | { type: 'withdraw-trade'; offerId: string }
  | { type: 'stop-trade'; routeId: string }
  | { type: 'propose-public-project'; routeId: string; recipeId: string }
  | { type: 'respond-public-project'; projectId: string; accept: boolean }
  | { type: 'cancel-public-project'; projectId: string }
  | { type: 'federate'; partner: number }
  | { type: 'repair'; routeId: string }
  | { type: 'repair-city'; cityId: string }
  | { type: 'expedition'; cityId: string; mission: MarsMissionKind }
  | { type: 'event'; event: EventKind; target: number; regional?: HistoricalEventSelection }
  | { type: 'wait' };
export interface Command { seat: number; expectedRevision: number; action: GameAction; timestamp?: string; plan?: ActionPlanItem[]; observedRevision?: number }
export interface ActionOption { highGround?: CampusHighGroundSite; territoryQuote?: TileAcquisitionQuote; catchmentTileId?: number; coastalQuote?: CoastalFoundingQuote; action: GameAction; label: string; reason: string; tradeQuote?: { transport: TransportQuote; cadenceRounds: number } }
export interface Observation { knowledge?: KnowledgeState; relief?: ReliefState; rail?: RailObservation; industrialEvidence?: IndustrialEvidence; strategicCapacities?: Record<StrategicResource, number>; governance?: ReturnType<typeof observedGovernment>; territory?: TerritoryObservation; revealedPastoralSites?: PastoralSite[]; growth?: CityGrowthFacts[]; wonders?: WonderObservation[]; strategicResources?: StrategicResources; strategicCapacity?: number; revealedDeposits?: StrategicDeposit[]; residentCapacity?: ResidentCapacityObservation; gameVersion: string; revision: number; round: number; year: number; seat: number; activeSeat: number | null; admission?: TurnAdmission; decisions?: DecisionObligations; actionPlan?: ActionPlan | null; buildingRecipes?: Array<{ localPowerInput?: number; localPowerOutput?: number; emissionsPerOperation?: number; buildingId: string; inputs: Partial<Resources>; strategicInputs?: StrategicResources; outputs: Partial<Resources> }>; civilization: Civilization | null; cities: City[]; rivals: Array<{ id: number; name: string; era: number; population: number; objective: string }>; routes: Route[]; treaties: Treaty[]; tradeOffers?: TradeOffer[]; publicProjects?: PublicProject[]; recentEvents: GameEvent[]; legalActions: ActionOption[]; outcome: Outcome | null }
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
export type DistrictAdjacency = ({ terrain: Terrain; improvement?: never; wonder?: never } | { improvement: string; terrain?: never; wonder?: never } | { wonder: true; terrain?: never; improvement?: never }) & { resource: Resource; amount: number; maximum: number };
export interface DistrictDefinition { range: number; adjacency?: DistrictAdjacency }
export interface ImprovementDefinition { id: string; name: string; description: string; requiredFeatures: readonly string[]; requires: string[]; minEra: number; cost: Partial<Resources>; requiredWork: number; siteRange: number; siteRequirement: 'hill' | 'revealed-horse-site' | 'forest' | 'coastal-land'; residentsRequired: number; operatingInputs?: Partial<Resources>; production: Partial<Resources> }
export interface WonderDefinition { id: string; name: string; description: string; requiredFeatures: readonly string[]; requires: string[]; minEra: number; cost: Partial<Resources>; requiredWork: number; siteRange: number; production: Partial<Resources> }
export interface BuildingDefinition { localPowerInput?: number; localPowerOutput?: number; emissionsPerOperation?: number; housing?: number; district?: DistrictDefinition; requiresBuildings?: readonly string[]; capabilities?: readonly BuildingCapability[]; siteRequirement?: 'coastal' | 'mountain-catchment' | 'campus-high-ground'; id: string; name: string; requiredFeatures: readonly string[]; minEra: number; cost: Partial<Resources>; requires: string[]; effects: EffectDefinition[]; production: Partial<Resources>; operatingInputs?: Partial<Resources>; strategicInputs?: StrategicResources; description: string }

export interface FeatureDefinition { id: string; name: string; description: string }
export interface ReleaseDefinition { id: string; gameVersion: string; featureIds: readonly string[] }
export type MilestoneCondition =
  | { kind: 'industrial-evidence' }
  | { kind: 'city-count'; minimum: number }
  | { kind: 'building-count'; building: string; minimum: number }
  | { kind: 'recorded-event-count'; eventType: string; minimum: number }
  | { kind: 'total-population'; minimum: number }
  | { kind: 'active-routes'; minimum: number }
  | { kind: 'event'; eventType: string }
  | { kind: 'technology'; technology: string; civilizations: number };
export interface HistoricalMilestone { id: string; name: string; requiredFeatures: readonly string[]; requiresMilestones: readonly string[]; conditions: readonly MilestoneCondition[]; year: number; era: number; explanation: string }

export interface DirectorTickCommand { expectedRevision: number; kind: 'event' | 'review' | 'clock'; intervalId: string; timestamp: string; event: EventKind; target: number; regional?: HistoricalEventSelection }

export type HistoryCause = { kind: 'feature' | 'event' | 'milestone'; id: string };
export interface HistoryAdvanceCommand { expectedRevision: number; cause: HistoryCause; reason: string; deltaYears: number; timestamp: string }
export interface HistoryAdvanceReceipt { cause: HistoryCause; reason: string; deltaYears: number; timestamp: string; revision: number; yearBefore: number; yearAfter: number; evidence: string[] }
export interface RegisteredRulesDefinition extends ReleaseDefinition { schemaVersion: number }

export interface StrategyCatchupResult extends TransitionResult { remainingTicks: number }
