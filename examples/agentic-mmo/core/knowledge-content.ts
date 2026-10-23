export const KNOWLEDGE_TECHNOLOGY_IDS = Object.freeze(['engineering', 'education', 'printing', 'banking'] as const);
export const KNOWLEDGE_INSTITUTION_IDS = Object.freeze(['library', 'academy', 'university'] as const);
export const KNOWLEDGE_RULES = Object.freeze({
  featureId: 'knowledge-compacts',
  ruleVersion: 1,
  learnerContribution: Object.freeze({ materials: 3, credits: 4 }),
  teacherContribution: Object.freeze({ culture: 2 }),
  transferred: Object.freeze({ credits: 3 }),
  consumed: Object.freeze({ materials: 3, culture: 2, credits: 1 }),
  percent: 10,
  requiredStudies: 2,
  pendingLifetime: 8,
  studyCadences: 3,
  cooldownRounds: 4,
  maximumEdges: 12,
  maximumCadence: 6,
} as const);
