import { describe, expect, it } from 'vitest';
import { en, zh } from '../../src/client/locales.js';

describe('section copy', () => {
  it('has the same keys in Chinese and English, none empty', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
    for (const dict of [zh, en]) for (const v of Object.values(dict)) expect(v).toMatch(/\S/);
  });
});
