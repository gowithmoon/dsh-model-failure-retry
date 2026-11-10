/**
 * Host plugin: the DSH adapter around the decision core.
 *
 * Listens on `agent/request-error` with prepend (ADR 0001): for categories it
 * owns it never calls `next()`, so the builtin llm-retry cannot retry the same
 * failure again; only a `pass` decision calls `next()`.
 */
import { decide } from '../core/decide.js';
import { createRequestStates } from './request-state.js';
import { Config, snapshotConfig } from './schema.js';
import { wait } from './wait.js';

export const name = 'dsh-model-failure-retry';
export { Config };

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {ReturnType<typeof Config>} config
 */
export function apply(ctx, config) {
  // Own settings page instead of the auto-generated form; optional service.
  ctx.inject(['settings'], (sub) => {
    sub.effect(() => sub.settings.configure({ auto: false }, ctx.fiber), 'model-failure-retry: settings policy');
  });

  const lifetime = new AbortController();
  ctx.effect(() => () => lifetime.abort(new Error('model-failure-retry disposed')), 'model-failure-retry: lifetime');

  const requests = createRequestStates();

  ctx.on('agent/request-error', async (payload, next) => {
    const { agent, turn, step, provider, failure, signal } = payload;
    if (lifetime.signal.aborted) return next();
    const model = agent.model?.current?.() ?? { provider, model: '' };
    const state = requests.get(agent, { turn, step, model });
    const decision = decide(failure, { attempts: state.attempts, model }, snapshotConfig(config));

    switch (decision.kind) {
      case 'pass':
        return next();
      case 'retry': {
        ctx.logger?.info?.(
          `retry ${decision.attempt}/${decision.maxAttempts} in ${decision.delayMs}ms after ${failure.code} on ${model.provider}/${model.model}`,
        );
        const elapsed = await wait(decision.delayMs, AbortSignal.any([signal, lifetime.signal]));
        if (!elapsed) return undefined;
        state.attempts = decision.attempt;
        return { kind: 'retry' };
      }
      default:
        // give-up (and, until #6, nothing else): fail the request here.
        ctx.logger?.info?.(`give up (${decision.reason}) after ${failure.code} on ${model.provider}/${model.model}`);
        return undefined;
    }
  }, { prepend: true });
}
