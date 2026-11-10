/**
 * Web client: registers the plugin's own `settings.section` while the Host
 * serves this plugin's config entry. Copy follows the DSH UI language (zh/en).
 */
import { ENTRY_ID } from '../entry.js';
import { en, zh } from './locales.js';
import { createPolicyController } from './policy-controller.js';
import { createSectionController } from './section-controller.js';
import { createRulesController } from './rules-controller.js';
import { createChainsController, createModelCatalog } from './chains-controller.js';
import { createSwitchBackController } from './switch-back-controller.js';
import { createStatsController } from './stats-controller.js';
import { STATS_CONTRIBUTION, STATS_SERVICE } from '../stats-remote.js';
import { Section } from './Section.jsx';

const NS = 'dsh-model-failure-retry';

export const inject = ['slots', 'locale', 'configForms'];

export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'model-failure-retry: dictionaries');
  const t = ctx.locale.bind(NS);
  const form = ctx.configForms.get(ENTRY_ID);
  const controller = createSectionController(form);
  const policyController = createPolicyController(form);
  const rulesController = createRulesController(form);
  const catalog = createModelCatalog();
  const chainsController = createChainsController(form, catalog);
  const switchBackController = createSwitchBackController(form);
  const statsController = createStatsController(form);
  // Model catalog for the candidate dropdowns (optional: the section still edits without it).
  ctx.inject(['remote', 'remote.session'], (sub) => {
    catalog.setLoader(() => sub.remote.session.modelCatalog());
    // Same refresh triggers as DSH's model picker; listeners go away with `sub`.
    for (const event of ['llm/adapters-updated', 'llm/models-updated']) sub.remote.$on(event, () => catalog.refresh());
    sub.effect(() => () => catalog.setLoader(undefined), 'model-failure-retry: model catalog');
  });
  // Stats (#8): mount the Host stats Remote; without it the stats part shows "unavailable".
  ctx.inject(['remote'], async (sub) => {
    const unmount = await sub.remote.$mount(STATS_CONTRIBUTION);
    sub.effect(() => () => unmount(), 'model-failure-retry: stats remote');
    sub.inject([`remote.${STATS_SERVICE}`], (inner) => {
      statsController.setLoader(async (query) => {
        const r = await inner.remote[STATS_SERVICE].query(query);
        if (!r?.ok) throw new Error(r?.error?.message ?? 'stats unavailable');
        return r.value;
      });
      inner.effect(() => () => statsController.setLoader(undefined), 'model-failure-retry: stats loader');
    });
  });
  ctx.effect(
    () => ctx.configForms.whileServed([ENTRY_ID], () => ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section',
      id: ENTRY_ID,
      order: 60,
      label: () => t('title'),
      locale: NS,
      inject: () => ({ controller, policyController, rulesController, chainsController, switchBackController, statsController }),
    }, Section))),
    'model-failure-retry: settings section',
  );
}
