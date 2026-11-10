import { describe, expect, it } from 'vitest';
import { matchesModel } from '../../src/core/match.js';

const ref = (provider, model) => ({ provider, model });

describe('matchesModel (provider/model wildcard)', () => {
  it('matches an exact provider/model', () => {
    expect(matchesModel('deepseek/deepseek-chat', ref('deepseek', 'deepseek-chat'))).toBe(true);
    expect(matchesModel('deepseek/deepseek-chat', ref('deepseek', 'deepseek-reasoner'))).toBe(false);
  });

  it('matches a prefix pattern', () => {
    expect(matchesModel('relay/*', ref('relay', 'gpt-4o'))).toBe(true);
    expect(matchesModel('relay/*', ref('relay-2', 'gpt-4o'))).toBe(false);
    expect(matchesModel('openai/gpt-4*', ref('openai', 'gpt-4o-mini'))).toBe(true);
  });

  it('matches a contains pattern', () => {
    expect(matchesModel('*/*claude*', ref('openrouter', 'anthropic/claude-sonnet'))).toBe(true);
    expect(matchesModel('*/*claude*', ref('openrouter', 'gpt-4o'))).toBe(false);
  });

  it('matches everything with */*', () => {
    expect(matchesModel('*/*', ref('a', 'b'))).toBe(true);
    expect(matchesModel('*/*', ref('openrouter', 'x/y'))).toBe(true);
  });

  it('reads a pattern without "/" as any provider', () => {
    expect(matchesModel('gpt-4*', ref('openai', 'gpt-4o'))).toBe(true);
    expect(matchesModel('gpt-4*', ref('relay', 'gpt-4.1'))).toBe(true);
    expect(matchesModel('gpt-4*', ref('openai', 'o3'))).toBe(false);
  });

  it('is anchored and treats regex characters literally', () => {
    expect(matchesModel('openai/gpt-4', ref('openai', 'gpt-4o'))).toBe(false);
    expect(matchesModel('a/m.1', ref('a', 'mx1'))).toBe(false);
    expect(matchesModel('a/m.1', ref('a', 'm.1'))).toBe(true);
  });

  it('matches nothing when the target is unknown or the pattern is blank', () => {
    expect(matchesModel('*/*', undefined)).toBe(false);
    expect(matchesModel('', ref('a', 'b'))).toBe(false);
    expect(matchesModel('  ', ref('a', 'b'))).toBe(false);
  });
});
