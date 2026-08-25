import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/index.js';
import { applyOverrides, detectRecurring } from '../lib/recurring.js';

// Every test uses a throwaway data directory. NEVER point a test at ./data —
// that is the user's real ledger. See CLAUDE.md.
async function withServer(run) {
  const dataDir = await mkdtemp(join(tmpdir(), 'spendexplore-recurring-'));
  const app = await startServer({ dataDir, port: 0 });
  const base = `http://127.0.0.1:${app.port}`;
  try {
    await run({ base, dataDir });
  } finally {
    await app.close();
  }
}

const t = (over) => ({
  id: 'x', date: '2026-08-15', amount: -16.99, rawDescription: 'R', merchant: 'Netflix',
  accountId: 'a', cardSuffix: null, categoryId: 'subscriptions', categorySource: 'rule',
  excluded: false, importId: 'i', note: null, ...over
});

const NETFLIX = ['2026-06', '2026-07', '2026-08'].map((m, i) =>
  t({ id: `n${i}`, date: `${m}-15` }));

const SNAPSHOT = {
  transactions: NETFLIX,
  categories: { groups: [], categories: [] },
  accounts: []
};

test('an "ignored" override removes the series and its cost', () => {
  const detected = detectRecurring(SNAPSHOT, { today: '2026-08-24' });
  assert.equal(detected.series.length, 1);

  const result = applyOverrides(detected, [{ merchant: 'Netflix', decision: 'ignored' }], SNAPSHOT, { today: '2026-08-24' });
  assert.equal(result.series.length, 0);
  assert.equal(result.committedMonthly, 0);
});

test('a "recurring" override forces a two-occurrence series into the list', () => {
  const thin = {
    ...SNAPSHOT,
    transactions: [t({ id: 'a', merchant: 'Newsletter', date: '2026-07-15', amount: -5 }),
                   t({ id: 'b', merchant: 'Newsletter', date: '2026-08-15', amount: -5 })]
  };
  assert.equal(detectRecurring(thin, { today: '2026-08-24' }).series.length, 0);

  const result = applyOverrides(
    detectRecurring(thin, { today: '2026-08-24' }),
    [{ merchant: 'Newsletter', decision: 'recurring' }],
    thin,
    { today: '2026-08-24' }
  );
  assert.equal(result.series.length, 1);
  assert.equal(result.series[0].merchant, 'Newsletter');
  assert.equal(result.series[0].forced, true);
  assert.equal(result.series[0].confidence, 'medium');
});

test('an override for a merchant with no usable history changes nothing', () => {
  const result = applyOverrides(
    detectRecurring(SNAPSHOT, { today: '2026-08-24' }),
    [{ merchant: 'Nowhere', decision: 'recurring' }],
    SNAPSHOT,
    { today: '2026-08-24' }
  );
  assert.equal(result.series.length, 1);
  assert.equal(result.series[0].merchant, 'Netflix');
});

test('POST /api/recurring/override persists a decision and returns the list', async () => {
  await withServer(async ({ base, dataDir }) => {
    const res = await fetch(`${base}/api/recurring/override`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ merchant: 'Netflix', decision: 'ignored' })
    });
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).recurring, [{ merchant: 'Netflix', decision: 'ignored' }]);

    const onDisk = JSON.parse(await readFile(join(dataDir, 'recurring.json'), 'utf8'));
    assert.deepEqual(onDisk, [{ merchant: 'Netflix', decision: 'ignored' }]);
  });
});

test('a second decision for the same merchant replaces the first, never duplicates it', async () => {
  await withServer(async ({ base }) => {
    const post = (body) => fetch(`${base}/api/recurring/override`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    });
    await post({ merchant: 'Netflix', decision: 'ignored' });
    const res = await post({ merchant: 'Netflix', decision: 'recurring' });
    assert.deepEqual((await res.json()).recurring, [{ merchant: 'Netflix', decision: 'recurring' }]);
  });
});

test('"auto" clears an override', async () => {
  await withServer(async ({ base }) => {
    const post = (body) => fetch(`${base}/api/recurring/override`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    });
    await post({ merchant: 'Netflix', decision: 'ignored' });
    const res = await post({ merchant: 'Netflix', decision: 'auto' });
    assert.deepEqual((await res.json()).recurring, []);
  });
});

test('the override route rejects a bad body', async () => {
  await withServer(async ({ base }) => {
    const post = (body) => fetch(`${base}/api/recurring/override`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    });
    assert.equal((await post({ merchant: '', decision: 'ignored' })).status, 400);
    assert.equal((await post({ merchant: 'Netflix', decision: 'nope' })).status, 400);
    assert.equal((await post({ merchant: 'x'.repeat(201), decision: 'ignored' })).status, 400);
    assert.equal((await post(['array']).catch(() => ({ status: 400 }))).status, 400);
  });
});

test('GET /api/snapshot includes the recurring overrides', async () => {
  await withServer(async ({ base }) => {
    const snapshot = await (await fetch(`${base}/api/snapshot`)).json();
    assert.deepEqual(snapshot.recurring, []);
  });
});
