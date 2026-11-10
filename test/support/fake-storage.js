/**
 * In-memory stand-in for DSH's `storageDomain` service. `data` survives
 * reopening (a plugin restart), so persistence can be tested without disk.
 */
export function createFakeStorage() {
  /** @type {Map<string, Map<string, Map<string, unknown>>>} domain → table → key → value */
  const data = new Map();
  const opened = [];
  const service = {
    async open(spec) {
      if (!/^[a-z][a-z0-9_]*$/.test(spec.name)) throw new Error(`bad domain name ${spec.name}`);
      const tables = data.get(spec.name) ?? new Map();
      data.set(spec.name, tables);
      let closed = false;
      const domain = {
        table(name) {
          const tableSpec = spec.tables[name];
          if (!tableSpec) throw new Error(`no table ${name}`);
          const rows = tables.get(name) ?? new Map();
          tables.set(name, rows);
          const live = () => { if (closed) throw new Error('domain closed'); };
          return {
            get: (k) => rows.get(k),
            entries: () => rows.entries(),
            keys: () => rows.keys(),
            get size() { return rows.size; },
            async put(k, v) {
              live();
              if (!/^[a-zA-Z0-9_-]+$/.test(k)) throw new Error(`key ${k} not path-safe`);
              rows.set(k, tableSpec.valueSchema.parse(JSON.parse(JSON.stringify(v))));
            },
            async delete(k) { live(); return rows.delete(k); },
            async deleteMany(keys) { live(); let n = 0; for (const k of keys) if (rows.delete(k)) n++; return n; },
          };
        },
        async close() { closed = true; },
        get closed() { return closed; },
      };
      opened.push(domain);
      return domain;
    },
  };
  return { service, data, opened };
}
