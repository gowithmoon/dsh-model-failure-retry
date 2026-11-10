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

  /**
   * A minimal agent: its current model, a turn signal, and the follow-up
   * messages it was given. `selections` records every `model.select` call.
   */
  function createAgent({ provider = 'mock', model = 'm1', reasoningEffort } = {}) {
    const controller = new AbortController();
    let current = reasoningEffort ? { provider, model, reasoningEffort } : { provider, model };
    const events = [];
    const agent = {
      // The session log: `append` commits {type, seq, time, data} like dsh-session.
      session: {
        events,
        append(type, data) {
          const event = { type, seq: events.length, time: Date.now(), data: JSON.parse(JSON.stringify(data)) };
          events.push(event);
          return event;
        },
      },
      selections: [],
      followups: [],
      model: {
        current: () => current,
        select: (ref) => { current = ref; agent.selections.push(ref); },
      },
      followup: (message) => { agent.followups.push(message); },
      // DSH's stop: abort the active turn's signal with the cause.
      cancel: (cause) => { controller.abort(cause); },
      controller,
      get signal() { return controller.signal; },
    };
    return agent;
  }

  /** Emit `agent/status` the way dsh-agent does when a turn starts or ends. */
  function status(agent, value) {
    ctx.emit('agent/status', { agent, status: value });
  }

  /**
   * Provide a stand-in `llm` service knowing `models`: { [provider]: { [model]: info } },
   * where info may carry `reasoning: { efforts: [{ id }] }`.
   */
  function provideLlm(models) {
    ctx.provide('llm', {
      listProviders: () => Object.keys(models).map((id) => ({ id, name: id })),
      listModels: async (provider) => Object.keys(models[provider] ?? {}).map((id) => ({ provider, id, name: id })),
      resolveModelInfo: async (provider, model) => {
        const info = models[provider]?.[model];
        if (!info) throw new Error(`unknown model ${provider}/${model}`);
        return { provider, id: model, name: model, ...info };
      },
    });
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

  /**
   * A stand-in `sessionProjections` service: records registered definitions;
   * `projection(agent, key)` folds the agent's session log through one the
   * way dsh-session-projection does, and returns its wire view.
   */
  const projections = new Map();
  ctx.provide('sessionProjections', {
    register(def) {
      projections.set(def.key, def);
      const ready = Promise.resolve({ dispose: async () => { projections.delete(def.key); } });
      return Object.assign(() => { projections.delete(def.key); }, { then: (a, b) => ready.then(a, b), catch: (b) => ready.catch(b) });
    },
  });
  function projection(agent, key) {
    const def = projections.get(key);
    if (!def) return undefined;
    let state = def.stateSchema.parse(def.init({}, 0));
    for (const event of agent.session.events) state = def.apply(state, event);
    def.stateSchema.parse(state);
    return def.wire.viewSchema.parse(def.wire.view(state));
  }

  /** Append a session event for `agent` the way dsh-agent-loop does (step/start, turn/end, user/message). */
  function sessionEvent(agent, type, data) {
    return agent.session.append(type, data);
  }

  return { ctx, builtinRetry, createAgent, requestError, status, provideLlm, projection, projections, sessionEvent };
}
