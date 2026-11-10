import { describe, expect, it } from 'vitest';
import { candidateOrder, matchChain } from '../../src/core/chain.js';

const ref = (provider, model) => ({ provider, model });
const A = ref('p', 'a');
const B = ref('p', 'b');
const C = ref('q', 'c');

describe('matchChain', () => {
  it('uses the first matching chain and ignores later ones that also match', () => {
    const chains = [
      { match: 'x/*', candidates: [C] },
      { match: 'p/*', candidates: [B] },
      { match: 'p/a', candidates: [C] },
    ];
    expect(matchChain(A, chains)).toEqual({ index: 1, chain: chains[1] });
  });

  it('reaches the */* catch-all only when no earlier chain matches', () => {
    const chains = [{ match: 'p/*', candidates: [B] }, { match: '*/*', candidates: [C] }];
    expect(matchChain(A, chains).index).toBe(0);
    expect(matchChain(C, chains).index).toBe(1);
  });

  it('returns undefined without chains or without a match', () => {
    expect(matchChain(A, [])).toBeUndefined();
    expect(matchChain(A, undefined)).toBeUndefined();
    expect(matchChain(A, [{ match: 'q/*', candidates: [C] }])).toBeUndefined();
  });

  it('treats a pattern without "/" as any provider', () => {
    expect(matchChain(A, [{ match: 'a', candidates: [B] }])?.index).toBe(0);
  });
});

describe('candidateOrder', () => {
  const list = [A, B, C];

  it('starts after the current model, wraps around, and stops before reaching it again', () => {
    expect(candidateOrder(list, B)).toEqual([C, A]);
    expect(candidateOrder(list, C)).toEqual([A, B]);
  });

  it('tries the whole list in order when the current model is not in it', () => {
    expect(candidateOrder(list, ref('z', 'z'))).toEqual([A, B, C]);
  });

  it('compares provider and model only (reasoning effort does not matter)', () => {
    expect(candidateOrder(list, { ...A, reasoningEffort: 'high' })).toEqual([B, C]);
  });

  it('returns plain refs without extra fields', () => {
    expect(candidateOrder([{ provider: 'p', model: 'a', extra: 1 }], ref('z', 'z'))).toEqual([A]);
  });
});
