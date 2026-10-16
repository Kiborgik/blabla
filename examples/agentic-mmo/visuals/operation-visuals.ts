import { RESOURCE_IDS } from '../core/content.ts';
import type { BuildingOperation, BuildingOperationResult, Resource, Resources } from '../core/types.ts';
import { METRIC_LABELS } from './visual-language.ts';

export interface ResourceAmount { resource: Resource; label: string; amount: number }
export interface OperationVisual {
  current: 'On' | 'Paused' | 'Unknown';
  summary: string;
  tone: 'positive' | 'negative' | 'neutral';
  last: {
    round: number;
    status: BuildingOperationResult['status'];
    label: string;
    paid: ResourceAmount[];
    produced: ResourceAmount[];
    shortages: BuildingOperationResult['shortages'];
  } | null;
}

function resourceAmounts(values: Partial<Resources>): ResourceAmount[] {
  return RESOURCE_IDS.flatMap((resource) => {
    const amount = values[resource];
    return amount === undefined ? [] : [{ resource, label: METRIC_LABELS[resource], amount }];
  });
}

export function operationVisual(operation: BuildingOperation | undefined): OperationVisual {
  if (!operation) return { current: 'Unknown', summary: 'No operating record', tone: 'neutral', last: null };
  const result = operation.lastResult;
  const produced = resourceAmounts(result?.produced ?? {});
  const positiveOutput = produced.some((entry) => entry.amount > 0);
  const last = result ? {
    round: result.round, status: result.status,
    label: result.status === 'blocked' ? 'Short of inputs' : result.status === 'paused' ? 'Paused' : positiveOutput ? 'Supplies made' : 'No output',
    paid: resourceAmounts(result.paid), produced, shortages: result.shortages.map((shortage) => ({ ...shortage })),
  } : null;
  return {
    current: operation.enabled ? 'On' : 'Paused',
    summary: !operation.enabled ? 'Paused now' : !last || last.status === 'paused' ? 'Ready for next season' : `Last season: ${last.label.toLowerCase()}`,
    tone: !operation.enabled || !last || last.status === 'paused' ? 'neutral' : last.status === 'blocked' ? 'negative' : positiveOutput ? 'positive' : 'neutral',
    last,
  };
}
