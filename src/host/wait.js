/**
 * Wait `ms`, resolving true when the time elapsed and false as soon as the
 * signal aborts (no timer left behind).
 * @param {number} ms
 * @param {AbortSignal} signal
 * @returns {Promise<boolean>}
 */
export function wait(ms, signal) {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
