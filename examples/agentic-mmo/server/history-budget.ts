import { HISTORY_SNAPSHOT_LIMITS, HISTORY_SNAPSHOT_PREFIX } from './snapshot-codec.ts';
import { isRecord, RequestFailure } from './validation.ts';

export const HISTORY_PAGE_BYTES = 1024 * 1024;
export const HISTORY_PAGE_FRAMING_BYTES = new TextEncoder().encode(JSON.stringify({ entries: [], hasMore: false, nextRevision: Number.MAX_SAFE_INTEGER })).length;

function byteCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function selectHistoryRows(rows: unknown[], after: number, limit: number): { revisions: number[]; hasMore: boolean } {
  const revisions: number[] = [];
  let bytes = 0;
  let previous = after;
  for (const row of rows.slice(0, limit)) {
    if (!isRecord(row) || !byteCount(row.end_revision) || row.end_revision <= previous
      || !byteCount(row.snapshot_bytes) || !byteCount(row.detail_bytes) || row.encoded !== 0 && row.encoded !== 1) throw new RequestFailure(503, 'corrupt_history');
    const charge = (row.encoded === 1 ? Math.max(row.snapshot_bytes, HISTORY_SNAPSHOT_LIMITS.utf8Bytes) : row.snapshot_bytes) + row.detail_bytes;
    if (!Number.isSafeInteger(charge)) throw new RequestFailure(503, 'corrupt_history');
    if (revisions.length > 0 && bytes + charge > HISTORY_PAGE_BYTES) break;
    if (row.encoded === 1 && row.snapshot_bytes > HISTORY_SNAPSHOT_LIMITS.envelopeBytes + HISTORY_SNAPSHOT_PREFIX.length) throw new RequestFailure(503, 'history_snapshot_envelope_limit');
    revisions.push(row.end_revision);
    previous = row.end_revision;
    bytes += charge;
    if (bytes >= HISTORY_PAGE_BYTES) break;
  }
  return { revisions, hasMore: rows.length > revisions.length };
}

export class HistoryOutputBudget {
  private usedBytes = HISTORY_PAGE_FRAMING_BYTES;
  private count = 0;
  get bytes(): number { return this.usedBytes; }
  get full(): boolean { return this.usedBytes >= HISTORY_PAGE_BYTES; }
  accept(value: unknown): boolean {
    if (this.count > 0 && this.full) return false;
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new RequestFailure(503, 'corrupt_history');
    const bytes = new TextEncoder().encode(serialized).length + (this.count > 0 ? 1 : 0);
    if (this.count > 0 && this.usedBytes + bytes > HISTORY_PAGE_BYTES) return false;
    this.usedBytes += bytes;
    this.count += 1;
    return true;
  }
}
