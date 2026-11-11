/**
 * Bridges the plugin's ConfigForm (ctx.configForms.get(entryId)) onto the
 * section's view state and writes.
 *
 * Extension: later tickets add their own controllers (policy #4, chains #6,
 * rules #5, ...) over the same form rather than growing this one; each writes
 * only its own config paths with `form.mutate`.
 */
const CATEGORY_KEYS = ['rate-limit', 'transient'];

/**
 * @param {import('./types.js').ConfigFormLike} form
 */
export function createSectionController(form) {
  let source;
  let view;

  function derive() {
    const snap = form.getSnapshot();
    if (snap === source) return view;
    source = snap;
    const value = snap.value ?? {};
    view = Object.freeze({
      status: snap.status,
      writable: snap.status === 'ready' && snap.writable,
      enabled: value.enabled ?? true,
      categories: Object.freeze(Object.fromEntries(
        CATEGORY_KEYS.map((key) => [key, value.categories?.[key]?.enabled ?? true]),
      )),
    });
    return view;
  }

  const set = (path, value) => form.mutate([{ op: 'set', path, value }], form.getSnapshot().revision);

  return {
    getSnapshot: derive,
    subscribe: (listener) => form.subscribe(() => {
      const before = view;
      if (derive() !== before) listener();
    }),
    setEnabled: (on) => set(['enabled'], on),
    setCategory: (key, on) => set(['categories', key, 'enabled'], on),
  };
}
