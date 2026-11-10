// Loads the built client.js the way the DSH web shell does and checks what it registers.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function loadBundle() {
  const code = readFileSync(new URL('../../client.js', import.meta.url), 'utf8');
  let loaded;
  const window = { __ModuleLoader__: { load: (m) => { loaded = m; } } };
  new Function('window', code)(window);
  const modules = { react: {}, 'react/jsx-runtime': {}, '@deepseek-ai/dsh-client-ui-primitives': {} };
  return { id: loaded.id, exports: loaded.factory((name) => modules[name]) };
}

function fakeClientCtx() {
  const effects = [];
  const registered = [];
  const locales = {};
  let served;
  const ctx = {
    effect: (fn) => effects.push(fn()),
    locale: { register: (ns, dicts) => { locales[ns] = dicts; return () => {}; }, bind: (ns) => (key) => locales[ns]?.en?.[key] ?? key },
    configForms: {
      get: () => ({ getSnapshot: () => ({ status: 'loading' }), subscribe: () => () => {}, mutate: async () => true }),
      whileServed: (ns, register) => { served = { ns, register }; return () => {}; },
    },
    slots: {
      inject: (slot, fn) => { registered.push({ slot, ...fn() }); return () => {}; },
      register: (options, component) => ({ options, component }),
    },
  };
  return { ctx, registered, locales, serve: () => served.register(new Set(served.ns)), get served() { return served; } };
}

describe('client bundle', () => {
  it('loads under the package name and declares its services', () => {
    const { id, exports } = loadBundle();
    expect(id).toBe('dsh-model-failure-retry');
    expect(exports.inject).toEqual(['slots', 'locale', 'configForms']);
  });

  it('registers zh/en copy and a settings.section once the entry is served', () => {
    const { exports } = loadBundle();
    const host = fakeClientCtx();
    exports.apply(host.ctx);
    expect(Object.keys(Object.values(host.locales)[0]).sort()).toEqual(['en', 'zh']);
    expect(host.served.ns).toEqual(['model-failure-retry']);
    expect(host.registered).toEqual([]);
    host.serve();
    expect(host.registered).toHaveLength(1);
    const [{ slot, options }] = host.registered;
    expect(slot).toBe('settings.section');
    expect(options).toMatchObject({ name: 'settings.section', id: 'model-failure-retry' });
    expect(options.label()).toBe('Model failure retry');
  });
});
