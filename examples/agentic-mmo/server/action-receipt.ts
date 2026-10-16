import type { D1Database } from './repository.ts';
import { isRecord, parseJson, RequestFailure, safeInteger, text } from './validation.ts';

interface ActionReceiptView { ok: true; operation: 'action'; commandId: string; observedRevision: number }
export type ActionReceiptRead = ActionReceiptView & ({ status: 'accepted'; acceptedRevision: number } | { status: 'not_found' });

export async function readActionReceipt(database: D1Database, worldId: string, input: Record<string, unknown>, actorUserId: string): Promise<ActionReceiptRead> {
  if (Object.keys(input).some((key) => key !== 'commandId')) throw new RequestFailure(400, 'invalid_receipt_input');
  const commandId = text(input.commandId, 'command_id');
  const key = `action:${commandId}`;
  const result = await database.prepare('SELECT w.revision, r.receipt_key, r.request_json, r.response_json FROM world_state AS w LEFT JOIN world_receipts AS r ON r.world_id = w.world_id AND r.receipt_key = ? WHERE w.world_id = ?').bind(key, worldId).all();
  if (result.results.length > 1) throw new RequestFailure(503, 'corrupt_receipt');
  const row = result.results[0];
  if (row === undefined) throw new RequestFailure(503, 'world_not_initialized');
  if (!isRecord(row) || !safeInteger(row.revision) || row.revision < 0) throw new RequestFailure(503, 'corrupt_world_revision');
  const view: ActionReceiptView = { ok: true, operation: 'action', commandId, observedRevision: row.revision };
  if (row.receipt_key === null && row.request_json === null && row.response_json === null) return { ...view, status: 'not_found' };
  if (row.receipt_key !== key || typeof row.request_json !== 'string') throw new RequestFailure(503, 'corrupt_receipt');
  const request = parseJson(row.request_json);
  if (!isRecord(request) || typeof request.actorUserId !== 'string' || request.actorUserId.trim().length === 0) throw new RequestFailure(503, 'corrupt_receipt');
  if (request.actorUserId !== actorUserId) return { ...view, status: 'not_found' };
  if (request.operation !== 'action' || !isRecord(request.input) || request.input.commandId !== commandId || typeof row.response_json !== 'string') throw new RequestFailure(503, 'corrupt_receipt');
  const reply = parseJson(row.response_json);
  if (!isRecord(reply) || reply.ok !== true || !safeInteger(reply.acceptedRevision) || reply.acceptedRevision < 0
    || reply.revision !== reply.acceptedRevision || reply.acceptedRevision > row.revision) throw new RequestFailure(503, 'corrupt_receipt');
  return { ...view, status: 'accepted', acceptedRevision: reply.acceptedRevision };
}
