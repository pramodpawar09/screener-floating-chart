import test from 'node:test';
import assert from 'node:assert/strict';
import { createCache } from '../src/services/cache-service.js';

const fakeStorage = () => {
  const m = new Map();
  return { m, get: async (k) => m.get(k), set: async (k, v) => void m.set(k, v), remove: async (k) => void m.delete(k) };
};

test('miss, hit, and TTL expiry', async () => {
  let t = 1000;
  const c = createCache({ now: () => t });
  assert.equal(await c.get('a', 100), null);
  await c.set('a', { x: 1 });
  assert.equal((await c.get('a', 100)).fresh, true);
  t += 150;
  const stale = await c.get('a', 100);
  assert.equal(stale.fresh, false);
  assert.deepEqual(stale.data, { x: 1 });
});
test('persists through the storage adapter and survives a new instance (service worker restart)', async () => {
  const s = fakeStorage();
  await createCache({ storage: s }).set('k', { y: 2 });
  const again = createCache({ storage: s });
  assert.deepEqual((await again.get('k', 1e9)).data, { y: 2 });
});
test('prunes oldest entries beyond maxEntries', async () => {
  const s = fakeStorage();
  const c = createCache({ storage: s, maxEntries: 2 });
  await c.set('1', 1); await c.set('2', 2); await c.set('3', 3);
  assert.equal(await c.get('1', 1e9), null);
  assert.ok(await c.get('3', 1e9));
  assert.equal(s.m.has('mdcache:1'), false);
});
test('storage failures do not break the in-memory layer', async () => {
  const bad = { get: async () => { throw new Error('x'); }, set: async () => { throw new Error('x'); }, remove: async () => {} };
  const c = createCache({ storage: bad });
  await c.set('k', 1);
  assert.equal((await c.get('k', 1e9)).data, 1);
});
