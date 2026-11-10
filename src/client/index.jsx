/**
 * Web client: registers the plugin's own `settings.section` while the Host
 * serves this plugin's config entry. Copy follows the DSH UI language (zh/en).
 */
import { ENTRY_ID } from '../entry.js';
import { en, zh } from './locales.js';
import { createPolicyController } from './policy-controller.js';
import { createSectionController } from './section-controller.js';
import { Section } from './Section.jsx';

const NS = 'dsh-model-failure-retry';

export const inject = ['slots', 'locale', 'configForms'];

export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'model-failure-retry: dictionaries');
  const t = ctx.locale.bind(NS);
  const form = ctx.configForms.get(ENTRY_ID);
  const controller = createSectionController(form);
  const policyController = createPolicyController(form);
  ctx.effect(
    () => ctx.configForms.whileServed([ENTRY_ID], () => ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section',
      id: ENTRY_ID,
      order: 60,
      label: () => t('title'),
      locale: NS,
      inject: () => ({ controller, policyController }),
    }, Section))),
    'model-failure-retry: settings section',
  );
}
