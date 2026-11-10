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
  // Model catalog for the candidate dropdowns (optional: the section still edits without it).
  ctx.inject(['remote', 'remote.session'], (sub) => {
    catalog.setLoader(() => sub.remote.session.modelCatalog());
    // Same refresh triggers as DSH's model picker; listeners go away with `sub`.
    for (const event of ['llm/adapters-updated', 'llm/models-updated']) sub.remote.$on(event, () => catalog.refresh());
    sub.effect(() => () => catalog.setLoader(undefined), 'model-failure-retry: model catalog');
  });
  ctx.effect(
    () => ctx.configForms.whileServed([ENTRY_ID], () => ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section',
      id: ENTRY_ID,
      order: 60,
      label: () => t('title'),
      locale: NS,
      inject: () => ({ controller, policyController, rulesController, chainsController }),
    }, Section))),
    'model-failure-retry: settings section',
  );
}
