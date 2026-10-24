export type NumberMeaning = 'stock' | 'change' | 'rate';

export function exactNumber(value: number): string {
  if (!Number.isFinite(value)) return 'Unavailable';
  return (Object.is(value, -0) ? 0 : value).toLocaleString('en-US', { maximumFractionDigits: 20 }).replace('-', '−');
}

export function numberPresentation(value: number, meaning: NumberMeaning = 'stock'): { short: string; exact: string } {
  if (!Number.isFinite(value)) return { short: 'Unavailable', exact: 'Unavailable' };
  const normalized = Object.is(value, -0) ? 0 : value;
  const magnitude = Math.abs(normalized);
  const short = magnitude >= 1000
    ? normalized.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 })
    : normalized.toLocaleString('en-US', { maximumFractionDigits: magnitude > 0 && magnitude < .1 ? 6 : 2 });
  const prefix = meaning !== 'stock' && normalized > 0 ? '+' : '';
  const suffix = meaning === 'rate' ? ' / season' : '';
  return { short: `${prefix}${Number(short) === 0 && magnitude > 0 ? exactNumber(normalized) : short.replace('-', '−')}${suffix}`, exact: `${prefix}${exactNumber(normalized)}${suffix}` };
}

export function numberElement(value: number, meaning: NumberMeaning = 'stock'): HTMLSpanElement {
  const formatted = numberPresentation(value, meaning);
  const span = document.createElement('span');
  span.className = 'number-value';
  span.textContent = formatted.short;
  span.setAttribute('aria-label', formatted.exact);
  span.title = formatted.exact;
  return span;
}
