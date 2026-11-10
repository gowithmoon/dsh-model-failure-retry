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
import { defaultRules, RULE_TARGETS } from '../core/rules.js';

const toggle = (value) => z.boolean().default(value).volatile();

const Category = z.object({ enabled: toggle(true) });

const KINDS = ['fixed', 'linear', 'exponential', 'custom'];

/**
 * Retry policy fields. `wrap` makes each field volatile for the global policy;
 * inside an override (already within the volatile `overrides` array) the
 * fields stay plain.
 */
const policyShape = (wrap) => ({
  kind: wrap(z.union(KINDS).default(DEFAULT_POLICY.kind)),
  initialDelayMs: wrap(z.natural().default(DEFAULT_POLICY.initialDelayMs)),
  multiplier: wrap(z.number().min(1).default(DEFAULT_POLICY.multiplier)),
  maxDelayMs: wrap(z.natural().default(DEFAULT_POLICY.maxDelayMs)),
  maxAttempts: wrap(z.natural().default(DEFAULT_POLICY.maxAttempts)),
  jitterRatio: wrap(z.number().min(0).max(1).default(DEFAULT_POLICY.jitterRatio)),
  honorRetryAfter: wrap(z.boolean().default(DEFAULT_POLICY.honorRetryAfter)),
  sequenceMs: wrap(z.array(z.natural()).default([...DEFAULT_POLICY.sequenceMs])),
});

export const Policy = z.object(policyShape((s) => s.volatile()));

const Override = z.object({
  match: z.string().default('*/*'),
  policy: z.object(policyShape((s) => s)),
});

/** One classification rule (src/core/rules.js). Status 0 / empty strings mean "any". */
export const Rule = z.object({
  status: z.natural().default(0),
  code: z.string().default(''),
  pattern: z.string().default(''),
  regex: z.boolean().default(false),
  category: z.union(RULE_TARGETS).required(),
});

export const Config = z.object({
  enabled: toggle(true),
  categories: z.object({
    'rate-limit': Category,
    transient: Category,
  }),
  policy: Policy,
  overrides: z.array(Override).default([]).volatile(),
  rules: z.array(Rule).default(defaultRules()).volatile(),
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
    overrides: config.overrides.get(),
    rules: config.rules.get(),
  };
}
