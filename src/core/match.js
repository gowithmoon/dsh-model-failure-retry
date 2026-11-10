/**
 * `provider/model` wildcard matching, shared by policy overrides (#4) and
 * fallback chains (#6).
 *
 * Rules: `*` matches any run of characters (including '/'); everything else is
 * literal; the match is anchored and case-sensitive. A pattern without '/'
 * means any provider: 'gpt-4*' ≡ '*\/gpt-4*'. A blank pattern matches nothing.
 */

/**
 * @param {string} pattern
 * @param {import('./types.js').ModelRef | undefined} ref
 * @returns {boolean}
 */
export function matchesModel(pattern, ref) {
  if (!ref || typeof pattern !== 'string') return false;
  const trimmed = pattern.trim();
  if (!trimmed) return false;
  const full = trimmed.includes('/') ? trimmed : `*/${trimmed}`;
  return compile(full).test(`${ref.provider}/${ref.model}`);
}

/** @param {string} glob */
function compile(glob) {
  const body = glob.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\/]/g, '\\$&')).join('.*');
  return new RegExp(`^${body}$`, 's');
}
