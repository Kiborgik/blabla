import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ProtocolError } from '../../../adapters/typescript/blabla_adapter.ts';
import { GameProtocol } from './protocol.ts';
import { atomicWrite, GameStore, isRecord } from './store.ts';

function flags(values: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!name?.startsWith('--') || value === undefined || value.startsWith('--') || result.has(name)) throw new ProtocolError('options require unique --name value pairs');
    result.set(name, value);
  }
  return result;
}

function numberOption(options: Map<string, string>, name: string): number | undefined {
  const value = options.get(name);
  if (value === undefined) return undefined;
  if (!/^-?\d+$/u.test(value) || !Number.isSafeInteger(Number(value))) throw new ProtocolError(`${name} must be a safe integer`);
  return Number(value);
}

export function main(argv = process.argv.slice(2)): void {
  try {
    const operation = argv[0];
    if (operation === undefined || operation === 'serve') {
      if (argv.length > 1) throw new ProtocolError('serve takes no options; state is stored in the current directory');
      new GameProtocol().serve();
      return;
    }
    const options = flags(argv.slice(1));
    const allowed: Record<string, string[]> = {
      init: ['--seed', '--clock-epoch', '--state'], observe: ['--seat', '--at', '--state', '--observation-format'], action: ['--seat', '--revision', '--choice', '--action', '--plan', '--at', '--model', '--id', '--state'], replay: ['--out', '--state'],
      tick: ['--revision', '--kind', '--interval', '--at', '--event', '--target', '--model', '--state'],
      catchup: ['--revision', '--at', '--id', '--model', '--state'],
      'strategy-catchup': ['--revision', '--at', '--id', '--model', '--state'],
      'history-advance': ['--revision', '--cause-kind', '--cause-id', '--reason', '--years', '--at', '--id', '--model', '--state'],
      'release-apply': ['--revision', '--from', '--to', '--at', '--id', '--model', '--state'],
    };
    if (!allowed[operation]) throw new ProtocolError('commands: init, observe, action, tick, catchup, strategy-catchup, history-advance, release-apply, replay, serve');
    for (const name of options.keys()) if (!allowed[operation]?.includes(name)) throw new ProtocolError(`unknown option ${name}`);
    const store = new GameStore(options.get('--state'));
    const request: Record<string, unknown> = { op: operation };
    if (operation === 'init') {
      request.seed = numberOption(options, '--seed') ?? 17;
      request.clockEpoch = options.get('--clock-epoch');
    }
    if (operation === 'observe') { request.seat = numberOption(options, '--seat'); request.timestamp = options.get('--at'); request.observationFormat = options.get('--observation-format'); }
    if (operation === 'action') {
      request.seat = numberOption(options, '--seat');
      request.expectedRevision = numberOption(options, '--revision');
      request.choice = numberOption(options, '--choice');
      request.model = options.get('--model');
      request.commandId = options.get('--id');
      request.timestamp = options.get('--at');
      const plan = options.get('--plan');
      if (plan !== undefined) {
        let value: unknown;
        try { value = JSON.parse(plan); } catch { throw new ProtocolError('--plan must be valid JSON'); }
        request.plan = value;
      }
      const action = options.get('--action');
      if (action !== undefined) {
        let value: unknown;
        try { value = JSON.parse(action); } catch { throw new ProtocolError('--action must be valid JSON'); }
        if (!isRecord(value)) throw new ProtocolError('--action must be a JSON object');
        request.action = value;
      }
    }
    if (operation === 'tick' || operation === 'catchup' || operation === 'strategy-catchup') {
      request.expectedRevision = numberOption(options, '--revision');
      request.timestamp = options.get('--at');
      request.model = options.get('--model');
      request.commandId = options.get('--id');
      if (operation === 'tick') {
        request.kind = options.get('--kind');
        request.intervalId = options.get('--interval');
        request.event = options.get('--event') ?? 'calm';
        request.target = numberOption(options, '--target') ?? 0;
      }
    }
    if (operation === 'history-advance' || operation === 'release-apply') {
      request.expectedRevision = numberOption(options, '--revision');
      request.model = options.get('--model');
      request.commandId = options.get('--id');
      if (operation === 'history-advance') {
        request.cause = { kind: options.get('--cause-kind'), id: options.get('--cause-id') };
        request.reason = options.get('--reason');
        request.deltaYears = numberOption(options, '--years');
        request.timestamp = options.get('--at');
      } else {
        request.timestamp = options.get('--at');
        request.expectedFromReleaseId = options.get('--from');
        request.targetReleaseId = options.get('--to');
      }
    }
    const result = new GameProtocol(store).handle(request);
    const output = options.get('--out');
    if (operation === 'replay' && output !== undefined && !(isRecord(result) && result.ok === false)) {
      if (resolve(process.cwd(), output) === store.path) throw new ProtocolError('replay output must differ from the durable state path');
      atomicWrite(resolve(process.cwd(), output), result);
      process.stdout.write(`${JSON.stringify({ ok: true, path: resolve(process.cwd(), output) })}\n`);
    } else process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (failure) {
    const message = failure instanceof Error ? failure.message : String(failure);
    process.stdout.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
