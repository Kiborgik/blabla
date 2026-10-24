export const FOOD_BUDGET_RULES = {
  featureId: 'food-budget',
  ruleVersion: 1,
  ruleId: 'food-budget-1',
  populationFoodUpkeep: 1.25,
} as const;

export type FoodRuleId = 'legacy-food-1' | typeof FOOD_BUDGET_RULES.ruleId;

export interface FoodSupplyReceipt {
  ruleVersion: 1;
  foodRule: typeof FOOD_BUDGET_RULES.ruleId;
  round: number;
  population: number;
  produced: number;
  required: number;
  paid: number;
  growthPaid: number;
  supplied: boolean;
  foodBefore: number;
  foodAfter: number;
}
