/**
 * @typedef {object} ConfigFormLike  The subset of DSH ConfigForm the client uses.
 * @property {() => { status: 'loading'|'ready'|'unavailable', value: any, revision: number|undefined, writable: boolean }} getSnapshot
 * @property {(listener: () => void) => () => void} subscribe
 * @property {(ops: { op: 'set'|'unset', path: string[], value?: unknown }[], expectedRevision?: number) => Promise<boolean>} mutate
 */
export {};
