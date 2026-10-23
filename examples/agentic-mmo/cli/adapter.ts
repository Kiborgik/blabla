import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Adapter } from '../../../adapters/typescript/blabla_adapter.ts';
import { legalActions } from '../core/engine.ts';
import { GameStore } from './store.ts';
import { FeatureProbes } from './feature-probes.ts';
import { OperationsProbes } from './operations-probes.ts';
import { SpectatorPolicyProbes } from './spectator-probes.ts';
import { RecoveryProbes } from './recovery-probes.ts';
import { LandTransportProbes } from './land-transport-probes.ts';
import { PublicProjectProbes } from './public-project-probes.ts';

export function createCampaignAdapter(
  store = new GameStore(resolve(process.cwd(), '.blabla/contract-world.json')),
): Adapter {
  store.ensure();
  const features = new FeatureProbes();
  const operations = new OperationsProbes();
  const spectator = new SpectatorPolicyProbes();
  const recovery = new RecoveryProbes();
  const projects = new PublicProjectProbes();
  const land = new LandTransportProbes();
  return new Adapter(
    () => {
      store.initialize(17, true);
      features.reset();
      operations.reset();
      spectator.reset();
      recovery.reset();
      projects.reset();
      land.reset();
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
        ...features.observe(),
        ...operations.observe(),
        ...spectator.observe(),
        ...recovery.observe(),
        ...projects.observe(),
        ...land.observe(),
      };
    },
  )
    .action('land_transport_fixture', 1, (args) => { land.prepare(args.integer(0)); })
    .action('eligible_land_consent_fixture', 0, () => { land.prepare(1); })
    .action('funded_due_land_fixture', 0, () => { land.prepare(2); })
    .action('quote_land_exchange', 0, () => { land.quote(); })
    .action('consent_land_exchange', 0, () => { land.consent(); })
    .action('resolve_land_exchange', 0, () => { land.resolve(); })
    .action('restart_consented_exchange', 0, () => { land.restartConsented(); })
    .action('project_fixture', 1, (args) => { projects.prepare(args.integer(0)); })
    .action('project_consent', 0, () => { projects.consent(); })
    .action('project_cancel', 0, () => { projects.cancel(); })
    .action('project_due_beat', 0, () => { projects.dueBeat(); })
    .action('repair_fixture', 1, (args) => { recovery.prepare(args.integer(0)); })
    .action('repair_case', 0, () => { recovery.repair(); })
    .action('deployment_offer', 1, (args) => { spectator.deploymentOffer(args.integer(0)); })
    .action('deployment_newer', 0, () => { spectator.deploymentOffer(4); })
    .action('deployment_poll', 0, () => { spectator.deploymentPoll(); })
    .action('cue_poll', 0, () => { spectator.cuePoll(); })
    .action('cue_append', 1, (args) => { spectator.cueAppend(args.integer(0)); })
    .action('cue_flood', 0, () => { spectator.cueFlood(); })
    .action('cue_new_run', 0, () => { spectator.cueNewRun(); })
    .action('operate', 0, () => { operations.operate(); })
    .action('pause', 0, () => { operations.pause(); })
    .action('production_beat', 0, () => { operations.productionBeat(); })
    .action('consent', 0, () => { operations.consent(); })
    .action('strategic_beat', 0, () => { operations.strategicBeat(); })
    .action('peer_action', 0, () => { features.peerAction(); })
    .action('invalid_action', 0, () => { features.invalidAction(); })
    .action('update_plan', 1, (args) => { features.updatePlan(args.integer(0)); })
    .action('feature_window', 0, () => { features.featureWindow(); })
    .action('found', 0, () => { features.found(); })
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
    .action('legacy_cycle', 0, () => {
      for (let index = 0; index < 6; index++) {
        const state = store.snapshot().state;
        const choice = legalActions(state, state.phase).findIndex(
          (option) => option.action.type === 'wait',
        );
        const result = store.probe(state.phase, choice);
        if (!result.ok) throw new Error(`Legacy cycle wait failed: ${result.error}`);
      }
    })
    .action('restart', 0, () => {
      store.snapshot();
    });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url)
  createCampaignAdapter().serve();
