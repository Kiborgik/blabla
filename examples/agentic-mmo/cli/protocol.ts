import { Adapter, ProtocolError } from '../../../adapters/typescript/blabla_adapter.ts';
import { GameStore } from './store.ts';

export class GameProtocol extends Adapter {
  private readonly store: GameStore;

  constructor(store = new GameStore()) {
    super(() => { throw new ProtocolError('use init to create a world'); }, () => store.observation());
    this.store = store;
  }

  override handle(request: Record<string, unknown>): unknown {
    try {
      if (request.observationFormat !== undefined && request.op !== 'observe') throw new ProtocolError('observationFormat is supported only for observe');
      switch (request.op) {
        case 'init': {
          const seed = request.seed ?? 17;
          if (typeof seed !== 'number' || !Number.isSafeInteger(seed)) throw new ProtocolError('seed must be a safe integer');
          if (request.clockEpoch !== undefined && typeof request.clockEpoch !== 'string') throw new ProtocolError('clockEpoch must be an explicit UTC timestamp');
          return this.store.initialize(seed, false, request.clockEpoch);
        }
        case 'observe': return this.store.observation(request.seat, request.timestamp, request.observationFormat);
        case 'action': return this.store.submit(request);
        case 'tick': return this.store.directorTick(request);
        case 'strategy-catchup': return this.store.strategyCatchUp(request);
        case 'catchup': return this.store.catchUp(request);
        case 'history-advance': return this.store.authoredTransition(request, 'history-advance');
        case 'release-apply': return this.store.authoredTransition(request, 'release-apply');
        case 'replay': return this.store.replay();
        default: throw new ProtocolError(`unknown op: ${String(request.op)}`);
      }
    } catch (failure) {
      if (!(failure instanceof ProtocolError)) throw failure;
      return { ok: false, error: failure.message };
    }
  }
}
