export const RELIEF_RULES = Object.freeze({
  featureId: 'consented-relief',
  ruleVersion: 1,
  minimumFood: 6,
  maximumFood: 36,
  energyCost: 1,
  pendingLifetime: 4,
  cooldownRounds: 8,
  maximumEdges: 12,
  edgesPerRound: 2,
  minimumTravelRounds: 2,
} as const);
