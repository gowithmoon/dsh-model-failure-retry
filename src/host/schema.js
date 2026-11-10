/**
 * Host Config schema (Schemastery). Every user-editable field is `.volatile()`
 * so the settings service exposes it in forms and edits apply without a
 * remount; the adapter re-reads a snapshot on every failure (hot update).
 *
 * Volatile rules: fixed object paths only, no volatile inside volatile. So a
 * list (rules #5, chains #6, overrides #4) must be ONE volatile array field,
 * e.g. `chains: z.array(Chain).default([]).volatile()`.
 *
 * Extension: add sibling keys to `Config` and read them in `snapshotConfig`.
 */
import z from '@deepseek-ai/schemastery';
import { DEFAULT_POLICY } from '../core/policy.js';

const toggle = (value) => z.boolean().default(value).volatile();

const Category = z.object({ enabled: toggle(true) });

export const Policy = z.object({
  kind: z.union(['exponential']).default(DEFAULT_POLICY.kind).volatile(),
  initialDelayMs: z.natural().default(DEFAULT_POLICY.initialDelayMs).volatile(),
  multiplier: z.number().min(1).default(DEFAULT_POLICY.multiplier).volatile(),
  maxDelayMs: z.natural().default(DEFAULT_POLICY.maxDelayMs).volatile(),
  maxAttempts: z.natural().default(DEFAULT_POLICY.maxAttempts).volatile(),
  jitterRatio: z.number().min(0).max(1).default(DEFAULT_POLICY.jitterRatio).volatile(),
  honorRetryAfter: toggle(DEFAULT_POLICY.honorRetryAfter),
});

export const Config = z.object({
  enabled: toggle(true),
  categories: z.object({
    'rate-limit': Category,
    transient: Category,
  }),
  policy: Policy,
});

/**
 * Read the live config into the plain object the decision core takes.
 * @returns {import('../core/config.js').CoreConfig}
 */
export function snapshotConfig(config) {
  const read = (group) => Object.fromEntries(Object.entries(group).map(([k, v]) => [k, v.get()]));
  return {
    enabled: config.enabled.get(),
    categories: {
      'rate-limit': read(config.categories['rate-limit']),
      transient: read(config.categories.transient),
    },
    policy: read(config.policy),
  };
}
