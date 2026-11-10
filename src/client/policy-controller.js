/**
 * Retry policy part of the settings section: the global policy and the
 * per-model overrides, over the plugin's ConfigForm.
 *
 * Writes only `policy.<field>` and `overrides`. `overrides` is one volatile
 * array on the Host, so every list edit writes the whole list.
 */
import { DEFAULT_POLICY } from '../core/policy.js';

const fill = (policy) => ({ ...DEFAULT_POLICY, ...policy });

/**
 * @param {import('./types.js').ConfigFormLike} form
 */
export function createPolicyController(form) {
  let source;
  let view;

  function derive() {
    const snap = form.getSnapshot();
    if (snap === source) return view;
    source = snap;
    const value = snap.value ?? {};
    view = Object.freeze({
      writable: snap.status === 'ready' && snap.writable,
      policy: fill(value.policy),
      overrides: (value.overrides ?? []).map((o) => ({ match: o.match ?? '', policy: fill(o.policy) })),
    });
    return view;
  }

  const mutate = (path, value) => form.mutate([{ op: 'set', path, value }], form.getSnapshot().revision);
  /** @param {(list: { match: string, policy: object }[]) => { match: string, policy: object }[] | undefined} edit */
  const editOverrides = (edit) => {
    const next = edit(derive().overrides.map((o) => ({ match: o.match, policy: { ...o.policy } })));
    return next ? mutate(['overrides'], next) : Promise.resolve(true);
  };

  return {
    getSnapshot: derive,
    subscribe: (listener) => form.subscribe(() => {
      const before = view;
      if (derive() !== before) listener();
    }),
    setPolicyField: (key, value) => mutate(['policy', key], value),
    /** A new override starts as a copy of the global policy, with an empty pattern. */
    addOverride: () => editOverrides((list) => [...list, { match: '', policy: { ...derive().policy } }]),
    removeOverride: (index) => editOverrides((list) => list.filter((_, i) => i !== index)),
    moveOverride: (index, by) => editOverrides((list) => {
      const to = index + by;
      if (to < 0 || to >= list.length || index < 0 || index >= list.length) return undefined;
      const [item] = list.splice(index, 1);
      list.splice(to, 0, item);
      return list;
    }),
    setOverrideMatch: (index, match) => editOverrides((list) => {
      list[index].match = match;
      return list;
    }),
    setOverrideField: (index, key, value) => editOverrides((list) => {
      list[index].policy[key] = value;
      return list;
    }),
  };
}

/**
 * "5,10,30,60" (seconds; commas, full-width commas or spaces) → milliseconds.
 * @returns {number[] | undefined} undefined when empty or not all non-negative numbers.
 */
export function parseSequence(text) {
  const parts = String(text).split(/[\s,，]+/).filter(Boolean);
  if (parts.length === 0) return undefined;
  const ms = parts.map((p) => (/^\d+(\.\d+)?$/.test(p) ? Math.round(Number(p) * 1000) : NaN));
  return ms.every(Number.isFinite) ? ms : undefined;
}

/** @param {number[]} sequenceMs */
export function formatSequence(sequenceMs) {
  return sequenceMs.map((ms) => String(ms / 1000)).join(', ');
}
