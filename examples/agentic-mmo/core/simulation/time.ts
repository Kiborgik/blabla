export function parseUtcTimestamp(timestamp: string): number | null {
  if (
    typeof timestamp !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(timestamp)
  )
    return null;
  const value = Date.parse(timestamp);
  if (!Number.isFinite(value)) return null;
  const normalized = new Date(value).toISOString();
  return normalized === timestamp || normalized.replace('.000Z', 'Z') === timestamp ? value : null;
}
