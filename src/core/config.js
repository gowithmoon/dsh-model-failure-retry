/**
 * The plain-data configuration the decision core reads (a snapshot; no
 * Schemastery, no volatile refs). The Host schema in src/host/schema.js
 * produces this shape via `snapshotConfig`.
 *
 * Extension points — add sibling keys, never restructure existing ones:
 *   policy     (#4) global policy
 *   overrides  (#4) per-model policies `[{ match, policy }]`, first match wins
 *   rules      (#5) classification rules
 *   chains     (#6) fallback chains
 *   switchBack (#9) switch-back settings
 *   stats      (#8) retention etc.
 *
 * @typedef {object} CoreConfig
 * @property {boolean} enabled  Master switch.
 * @property {Record<'rate-limit' | 'transient', { enabled: boolean }>} categories
 * @property {Partial<import('./types.js').RetryPolicy>} [policy]
 * @property {import('./types.js').PolicyOverride[]} [overrides]
 * @property {import('./rules.js').ClassificationRule[]} [rules]  (#5) ordered; first hit wins
 * @property {import('./chain.js').FallbackChain[]} [chains]  (#6) ordered; first match wins
 * @property {import('./switch-back.js').SwitchBackSettings} [switchBack]  (#9)
 */

import { DEFAULT_POLICY } from './policy.js';
import { defaultRules } from './rules.js';
import { DEFAULT_SWITCH_BACK } from './switch-back.js';

/** @returns {CoreConfig} a fresh, mutable default config. */
export function defaultConfig() {
  return {
    enabled: true,
    categories: {
      'rate-limit': { enabled: true },
      transient: { enabled: true },
    },
    policy: { ...DEFAULT_POLICY },
    overrides: [],
    rules: defaultRules(),
    chains: [],
    switchBack: { ...DEFAULT_SWITCH_BACK },
  };
}
