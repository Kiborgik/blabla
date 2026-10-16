import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Adapter } from '../../../adapters/typescript/blabla_adapter.ts';
import { legalActions } from '../core/engine.ts';
import { GameStore } from './store.ts';

export function createCampaignAdapter(
  store = new GameStore(resolve(process.cwd(), '.blabla/contract-world.json')),
): Adapter {
  store.ensure();
  return new Adapter(
    () => {
      store.initialize(17, true);
    },
    () => {
      const campaign = store.snapshot();
      const state = campaign.state;
      return {
        revision: state.revision,
        round: state.round,
        year: state.year,
        phase: state.phase,
        civilizations: state.civilizations.length,
        maximum_era: Math.max(0, ...state.civilizations.map((civilization) => civilization.era)),
        population: state.cities.reduce((total, city) => total + city.population, 0),
        routes: state.routes.length,
        active_routes: state.routes.filter((route) => route.active).length,
        treaties: state.treaties.length,
        mars_population: state.civilizations.reduce(
          (total, civilization) => total + civilization.marsPopulation,
          0,
        ),
        finished: state.outcome !== null,
        outcome: state.outcome?.kind ?? '',
        last_valid: campaign.lastValid,
      };
    },
  )
    .action('play', 2, (args) => {
      store.probe(args.integer(0), args.integer(1));
    })
    .action('hold', 0, () => {
      const state = store.snapshot().state;
      const choice = legalActions(state, state.phase).findIndex(
        (option) => option.action.type === 'wait',
      );
      store.probe(state.phase, choice);
    })
    .action('restart', 0, () => {
      store.snapshot();
    });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url)
  createCampaignAdapter().serve();
