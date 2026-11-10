/**
 * A fake Cordis host: a real Cordis Context with stand-ins for the DSH parts
 * the adapter touches. `requestError()` dispatches `agent/request-error` the
 * way dsh-agent-loop does, and the `builtinRetry` stand-in is registered like
 * dsh-llm-retry (a normal, non-prepend listener) so tests can see whether a
 * failure leaked through to it.
 */
import { Context } from '@deepseek-ai/cordis';

export function createFakeHost() {
  const ctx = new Context();
  const builtinRetry = { calls: [] };
  ctx.plugin({
    name: 'fake-builtin-llm-retry',
    apply(c) {
      c.on('agent/request-error', (payload) => {
        builtinRetry.calls.push(payload.failure.code);
        return Promise.resolve(undefined);
      });
    },
  });

  /** A minimal agent: its current model and a turn signal. */
  function createAgent({ provider = 'mock', model = 'm1' } = {}) {
    const controller = new AbortController();
    let current = { provider, model };
    return {
      session: {},
      model: { current: () => current, select: (ref) => { current = ref; } },
      controller,
      get signal() { return controller.signal; },
    };
  }

  /**
   * Dispatch one request failure. The innermost `next` is DSH's default: no recovery.
   * @returns {Promise<{kind:'retry'} | undefined>}
   */
  function requestError(agent, failure, { turn = 1, step = 1 } = {}) {
    const current = agent.model.current();
    return ctx.waterfall('agent/request-error', {
      agent,
      turn,
      step,
      provider: current.provider,
      failure: { message: failure.code, ...failure },
      retryPolicy: undefined,
      signal: agent.signal,
    }, () => Promise.resolve(undefined));
  }

  return { ctx, builtinRetry, createAgent, requestError };
}
