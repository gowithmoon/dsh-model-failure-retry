import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, resolvePolicy } from '../../src/core/policy.js';

const ref = (provider, model) => ({ provider, model });
const globalPolicy = { ...DEFAULT_POLICY, initialDelayMs: 2000 };

describe('resolvePolicy', () => {
  it('uses the global policy when no override matches', () => {
    const config = { policy: globalPolicy, overrides: [{ match: 'relay/*', policy: { kind: 'fixed', initialDelayMs: 30000 } }] };
    expect(resolvePolicy(ref('deepseek', 'deepseek-chat'), config)).toEqual(globalPolicy);
  });

  it('uses the policy of a matching override, filling unset fields from the defaults', () => {
    const config = { policy: globalPolicy, overrides: [{ match: 'relay/*', policy: { kind: 'fixed', initialDelayMs: 30000 } }] };
    expect(resolvePolicy(ref('relay', 'gpt-4o'), config)).toEqual({ ...DEFAULT_POLICY, kind: 'fixed', initialDelayMs: 30000 });
  });

  it('takes the first matching override in order', () => {
    const config = {
      policy: globalPolicy,
      overrides: [
        { match: '*/gpt-4*', policy: { maxAttempts: 2 } },
        { match: 'relay/*', policy: { maxAttempts: 9 } },
        { match: '*/*', policy: { maxAttempts: 1 } },
      ],
    };
    expect(resolvePolicy(ref('relay', 'gpt-4o'), config).maxAttempts).toBe(2);
    expect(resolvePolicy(ref('relay', 'claude'), config).maxAttempts).toBe(9);
    expect(resolvePolicy(ref('deepseek', 'chat'), config).maxAttempts).toBe(1);
  });

  it('works without overrides or an unknown target', () => {
    expect(resolvePolicy(ref('a', 'b'), { policy: globalPolicy })).toEqual(globalPolicy);
    expect(resolvePolicy(undefined, { policy: globalPolicy, overrides: [{ match: '*/*', policy: { maxAttempts: 1 } }] })).toEqual(globalPolicy);
  });
});
