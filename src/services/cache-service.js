// Two-layer cache: in-memory Map (always) + optional persistent storage adapter
// ({ get, set, remove } -> promises). The caller supplies the TTL on read, so one entry
// can be "fresh" for one caller and "stale" for another. Entries expire logically, and
// the persistent layer is capped (oldest entries pruned first).
export function createCache({ storage = null, prefix = 'mdcache:', maxEntries = 80, now = () => Date.now() } = {}) {
  const mem = new Map();
  let index = null;

  const remember = (key, entry) => {
    mem.delete(key);
    mem.set(key, entry);
    while (mem.size > maxEntries) mem.delete(mem.keys().next().value);
  };
  const loadIndex = async () => (index ??= (await storage.get(prefix + 'index')) || []);

  return {
    async get(key, ttlMs) {
      let entry = mem.get(key);
      if (!entry && storage) {
        try {
          entry = await storage.get(prefix + key);
        } catch {
          entry = undefined;
        }
        if (entry) remember(key, entry);
      }
      if (!entry) return null;
      return { data: entry.data, fetchedAt: entry.fetchedAt, fresh: now() - entry.fetchedAt < ttlMs };
    },

    async set(key, data) {
      const entry = { data, fetchedAt: now() };
      remember(key, entry);
      if (!storage) return;
      try {
        await storage.set(prefix + key, entry);
        const idx = await loadIndex();
        const at = idx.indexOf(key);
        if (at >= 0) idx.splice(at, 1);
        idx.push(key);
        while (idx.length > maxEntries) await storage.remove(prefix + idx.shift());
        await storage.set(prefix + 'index', idx);
      } catch {
        /* storage full or unavailable: memory layer still works */
      }
    },

    async clear() {
      mem.clear();
      if (!storage) return;
      try {
        for (const k of await loadIndex()) await storage.remove(prefix + k);
        index = [];
        await storage.set(prefix + 'index', []);
      } catch {
        /* ignore */
      }
    },
    size: () => mem.size,
  };
}
