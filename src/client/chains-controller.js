/**
 * Fallback chains sub-section (#6): view state and list edits over the
 * plugin's ConfigForm, plus the model catalog feeding the provider → model
 * dropdowns. Writes only the `chains` path, always as the whole list (one
 * volatile array field).
 *
 * The catalog comes from the Host's `remote.session.modelCatalog()` (the same
 * source DSH's own model picker uses; on the Host it is built from
 * `llm.listProviders` / `listModels`).
 */

const NEW_CHAIN = Object.freeze({ match: '*/*', candidates: [] });

/** Plain stored shape of one candidate. */
const ref = ({ provider, model }) => ({ provider: String(provider ?? ''), model: String(model ?? '') });
const plainChain = (chain) => ({ match: String(chain?.match ?? ''), candidates: (chain?.candidates ?? []).map(ref) });

/**
 * A tiny external store with the Host model catalog.
 * `setLoader(fn)` installs `() => Promise<{ ok, value?, error? }>` (the
 * remote call); `refresh()` (re)loads it.
 */
export function createModelCatalog() {
  const listeners = new Set();
  let loader;
  let generation = 0;
  let snapshot = view('unavailable', []);

  function view(status, groups, error) {
    const byId = new Map(groups.map((g) => [g.id, g]));
    return Object.freeze({
      status,
      error,
      providers: Object.freeze(groups.map(({ id, name }) => Object.freeze({ id, name: name || id }))),
      hasProvider: (id) => byId.has(id),
      modelsOf: (id) => (byId.get(id)?.models ?? []).map(({ id: m, name }) => ({ id: m, name: name || m })),
    });
  }
  function set(next) {
    snapshot = next;
    for (const l of listeners) l();
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setLoader(fn) { loader = fn; },
    refresh() {
      if (!loader) return;
      const mine = ++generation;
      const groups = snapshot.status === 'ready' ? snapshot.providers.map((p) => ({ ...p, models: snapshot.modelsOf(p.id) })) : [];
      set(view('loading', groups));
      Promise.resolve().then(loader).then((response) => {
        if (mine !== generation) return;
        if (!response?.ok) throw new Error(response?.error?.message ?? 'model catalog unavailable');
        set(view('ready', response.value.groups ?? []));
      }).catch((error) => {
        if (mine === generation) set(view('error', [], String(error?.message ?? error)));
      });
    },
  };
}

/**
 * @param {import('./types.js').ConfigFormLike} form
 * @param {ReturnType<typeof createModelCatalog>} catalog
 */
export function createChainsController(form, catalog) {
  let source;
  let catalogSource;
  let cached;

  function derive() {
    const snap = form.getSnapshot();
    const cat = catalog.getSnapshot();
    if (snap === source && cat === catalogSource) return cached;
    source = snap;
    catalogSource = cat;
    const chains = Array.isArray(snap.value?.chains) ? snap.value.chains : [];
    const known = cat.status === 'ready';
    const missing = (c) => {
      if (!known) return undefined;
      if (!cat.hasProvider(c.provider)) return 'provider';
      return cat.modelsOf(c.provider).some((m) => m.id === c.model) ? undefined : 'model';
    };
    cached = Object.freeze({
      status: snap.status,
      writable: snap.status === 'ready' && snap.writable === true,
      catalog: cat,
      chains: Object.freeze(chains.map((chain) => {
        const plain = plainChain(chain);
        return Object.freeze({
          ...plain,
          error: plain.match.trim() === '' ? 'empty-match' : undefined,
          candidates: Object.freeze(plain.candidates.map((c) => Object.freeze({ ...c, missing: missing(c) }))),
        });
      })),
    });
    return cached;
  }

  const current = () => (Array.isArray(form.getSnapshot().value?.chains) ? form.getSnapshot().value.chains : []).map(plainChain);
  const write = (chains) => form.mutate([{ op: 'set', path: ['chains'], value: chains }], form.getSnapshot().revision);
  const swap = (list, index, delta) => {
    const to = index + delta;
    if (index < 0 || to < 0 || to >= list.length) return false;
    [list[index], list[to]] = [list[to], list[index]];
    return true;
  };
  const editCandidates = (index, edit) => {
    const chains = current();
    if (!chains[index]) return Promise.resolve(true);
    const next = edit([...chains[index].candidates]);
    if (!next) return Promise.resolve(true);
    chains[index] = { ...chains[index], candidates: next.map(ref) };
    return write(chains);
  };

  return {
    getSnapshot: derive,
    subscribe(listener) {
      const notify = () => {
        const before = cached;
        if (derive() !== before) listener();
      };
      const offForm = form.subscribe(notify);
      const offCatalog = catalog.subscribe(notify);
      return () => { offForm(); offCatalog(); };
    },
    add: () => write([...current(), plainChain(NEW_CHAIN)]),
    remove: (index) => write(current().filter((_, i) => i !== index)),
    /** Move chain `index` by `delta` (-1 up, +1 down); a no-op at the ends. */
    move(index, delta) {
      const chains = current();
      return swap(chains, index, delta) ? write(chains) : Promise.resolve(true);
    },
    setMatch: (index, match) => write(current().map((c, i) => (i === index ? { ...c, match: String(match).trim() } : c))),
    addCandidate: (index, candidate) => editCandidates(index, (list) => [...list, candidate]),
    setCandidate: (index, at, candidate) => editCandidates(index, (list) => list.map((c, i) => (i === at ? candidate : c))),
    removeCandidate: (index, at) => editCandidates(index, (list) => list.filter((_, i) => i !== at)),
    moveCandidate: (index, at, delta) => editCandidates(index, (list) => (swap(list, at, delta) ? list : undefined)),
    /** Reload the provider/model lists (e.g. when the section opens). */
    refreshCatalog: () => catalog.refresh(),
  };
}
