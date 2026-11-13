// Run with:  node --test tests-js/engine.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { Engine, EngineError, normalise, parseTs, parseCsv } = require('../frontend/engine.js');

const METER = '12345678';
const SITES = 'siteCode;name;address;Breddegrad;Længdegrad;status\nS01;Site 1;Strada 1;55,676100;12,568300;ACTIVE\nS02;Site 2;Strada 2;55,690000;12,590000;ACTIVE\n';
const CONC = 'serialNumber;siteCode\n70000001;S01\n70000002;S01\n70000003;S02\n';

function make({ registry = true, live = null, settings = {} } = {}) {
  const clock = { now: Date.UTC(2026, 10, 12, 9, 0, 0), tick(s) { this.now += s * 1000; } };
  const mem = {};
  const eng = new Engine({
    storage: { get: (k) => (mem[k] ? JSON.parse(mem[k]) : null), set: (k, v) => { mem[k] = JSON.stringify(v); } },
    fetchJson: async (url) => live(url), clock: () => clock.now, settings: { simSpeed: 1, coarseSteps: 6, ...settings }, simSeed: 7,
  });
  if (registry) { eng.importSites(SITES); eng.importConcentrators(CONC); }
  if (!live) eng.setDemo(true);
  return { eng, clock, mem };
}
const start = (eng, gps = { lat: 55.677, lon: 12.567, accuracyM: 8 }) => eng.createSession(METER, 'Ana', gps).session.id;
async function waitMeasured(eng, clock, sid, limit = 150) {
  for (let w = 0; w <= limit; w += 5) {
    clock.tick(5);
    const r = await eng.poll(sid);
    if (r.summary.session.state === 'MEASURED') return r;
  }
  throw new Error('no fresh observation');
}
async function fullSweep(eng, clock, sid) {
  await eng.callConfirmed(sid, 'initial');
  await waitMeasured(eng, clock, sid);
  for (let step = 2; step <= 6; step++) { await eng.positionMarked(sid, 'coarse', step); await waitMeasured(eng, clock, sid); }
  return eng.summary(sid);
}

test('HTTP 200 is not a measurement: the pre-CALL snapshot is baseline only', async () => {
  const { eng, clock } = make();
  const sid = start(eng);
  await eng.callConfirmed(sid, 'initial');
  clock.tick(5);
  const r = await eng.poll(sid);
  assert.ok(r.snapshotCount > 0);
  assert.deepEqual(r.fresh, []);
  assert.equal(r.summary.session.state, 'WAIT_RF');
  assert.deepEqual([...new Set(eng.db.sessions[sid].obs.map((o) => o.kind))], ['baseline']);
});

test('the 5 s limit per meter holds however often the UI polls', async () => {
  const { eng, clock } = make();
  const sid = start(eng);
  await eng.callConfirmed(sid, 'initial');
  const before = eng.upstreamCalls;
  for (let i = 0; i < 10; i++) { clock.tick(0.1); await eng.poll(sid); }
  assert.equal(eng.upstreamCalls, before);
  clock.tick(5); await eng.poll(sid);
  assert.equal(eng.upstreamCalls, before + 1);
});

test('six-sector sweep: winner, primary, weak receivers kept, external logged only', async () => {
  const { eng, clock } = make();
  const sid = start(eng);
  const s = await fullSweep(eng, clock, sid);
  assert.deepEqual(s.coarse.map((c) => c.step), [1, 2, 3, 4, 5, 6]);
  assert.ok(s.coarse.every((c) => c.measured));
  assert.equal(s.coarseWinner.step, 4);            // simulator: strongest receiver peaks at 200 deg
  assert.equal(s.primary.serial, '70000001');
  const serials = s.receivers.map((r) => r.serial);
  for (const x of ['70000001', '70000002', '70000003']) assert.ok(serials.includes(x));
  assert.ok(!serials.includes('70000099'));
  assert.ok(eng.db.sessions[sid].obs.some((o) => o.serial === '70000099' && !o.owned));
  const rel = Object.fromEntries(s.receivers.map((r) => [r.serial, r.relation]));
  assert.equal(rel['70000002'], 'SAME_SITE');
  assert.equal(rel['70000003'], 'DISTINCT_SITE');
  assert.equal(s.backup.serial, '70000003');       // another site beats a stronger same-site receiver
  assert.equal(s.backup.positionRecommendable, false);
});

test('fine tune, final CALL, complete; session survives a reload', async () => {
  const { eng, clock, mem } = make();
  const sid = start(eng);
  await fullSweep(eng, clock, sid);
  for (let step = 1; step <= 5; step++) { await eng.positionMarked(sid, 'fine', step); await waitMeasured(eng, clock, sid); }
  let s = eng.summary(sid);
  assert.equal(s.fine.length, 5);
  assert.ok(s.best.rssi >= s.coarseWinner.rssi);
  const again = new Engine({ storage: { get: (k) => JSON.parse(mem[k]), set: () => {} }, fetchJson: null, clock: () => clock.now });
  assert.deepEqual(again.summary(sid).best, s.best);
  await eng.callConfirmed(sid, 'final');
  await waitMeasured(eng, clock, sid);
  s = eng.summary(sid);
  assert.ok(s.finalCheck.ok);
  assert.equal(s.suggestedOutcome, 'OPTIMAL_CONFIRMED');
  assert.equal(eng.complete(sid).session.status, 'COMPLETED');
  await assert.rejects(eng.poll(sid), EngineError);
});

test('a late reading counts for the position it was taken at', async () => {
  const { eng, clock } = make();
  const sid = start(eng);
  await eng.callConfirmed(sid, 'initial');
  await waitMeasured(eng, clock, sid);
  const before = eng.summary(sid).coarse[0].nObs;
  clock.tick(31); eng.sim.fetch(METER); eng.sim.silence(METER); eng.cache = {};
  clock.tick(10);
  eng._newSample(eng.db.sessions[sid], 'coarse', 2, null);   // moved before the readings were fetched
  clock.tick(5);
  const r = await eng.poll(sid);
  assert.deepEqual(r.fresh, []);
  assert.equal(r.summary.session.state, 'WAIT_RF');
  assert.ok(r.summary.coarse[0].nObs > before);
  assert.equal(r.summary.coarse[1].nObs, 0);
});

test('a weak receiver alone does not complete a position', async () => {
  const { eng, clock } = make();
  const sid = start(eng);
  await eng.callConfirmed(sid, 'initial');
  await waitMeasured(eng, clock, sid);
  await eng.positionMarked(sid, 'coarse', 2);
  eng.sim.rnd = () => 0;
  eng.sim._meter(METER).next = { 70000003: clock.now + 3000 };
  clock.tick(5);
  let r = await eng.poll(sid);
  assert.deepEqual(r.fresh.map((o) => o.concentratorSerial), ['70000003']);
  assert.equal(r.summary.session.state, 'WAIT_RF');
  clock.tick(36);
  r = await eng.poll(sid);
  assert.equal(r.summary.session.state, 'MEASURED');
});

test('slow RF warns, does not fail, and can be skipped', async () => {
  const { eng, clock } = make();
  const sid = start(eng);
  await eng.callConfirmed(sid, 'initial');
  eng.sim.silence(METER);
  clock.tick(61);
  const r = await eng.poll(sid);
  assert.equal(r.warning, 'SLOW_RF');
  assert.equal(eng.skip(sid).session.state, 'MEASURED');
});

test('works without GPS and without a registry', async () => {
  const { eng, clock } = make({ registry: false });
  const sid = start(eng, null);
  const s = await fullSweep(eng, clock, sid);
  assert.equal(s.coarseWinner.step, 4);
  assert.ok(s.warnings.includes('NO_GPS') && s.warnings.includes('REGISTRY_EMPTY'));
  assert.ok(s.receivers.some((r) => r.serial === '70000099'));   // empty registry: everything is owned
});

test('live mode calls Kamstrup directly and parses the real response shape', async () => {
  const urls = [];
  let t = '2026-11-12T08:00:00Z', rssi = -123;
  const live = (url) => { urls.push(url); return { SerialNumber: METER, Class: 'Meter', Links: [
    { SerialNumber: '70000001', Manufacturer: 'KAM', Class: 'Concentrator', TimestampUtcToDevice: t, RssiToDevice: rssi,
      TimestampUtcFromDevice: null, RssiFromDevice: 0, LQI: 0 }] }; };
  const { eng, clock } = make({ live });
  const sid = start(eng);
  await eng.callConfirmed(sid, 'initial');
  assert.equal(urls[0], 'https://check.kamstrup.com/DeviceMonitorService/rest/devicedata/12345678');
  clock.tick(5);
  assert.deepEqual((await eng.poll(sid)).fresh, []);
  clock.tick(30); t = new Date(clock.now - 2000).toISOString(); rssi = -91;
  const r = await eng.poll(sid);
  assert.equal(r.fresh[0].rssiDbm, -91);
  clock.tick(40);
  assert.equal((await eng.poll(sid)).summary.session.state, 'MEASURED');
});

test('upstream failure is a warning, not a crash', async () => {
  const { eng, clock } = make({ live: () => { throw new Error('offline'); } });
  const sid = start(eng);
  await eng.callConfirmed(sid, 'initial');
  clock.tick(6);
  const r = await eng.poll(sid);
  assert.match(r.warning, /^UPSTREAM_ERROR/);
  assert.equal(r.summary.session.status, 'ACTIVE');
});

test('registry import: Danish headers, decimal comma, nothing guessed', () => {
  const { eng } = make({ registry: false });
  assert.deepEqual(eng.importSites(SITES + 'S03;Fara coordonate;x;;;ACTIVE\n'), { imported: 3, review: 1 });
  const r = eng.importConcentrators(CONC + '70000004;S99\n70000005;\n');
  assert.equal(r.review, 2);
  assert.equal(eng.db.concentrators['70000004'].status, 'REVIEW');
  assert.equal(eng.db.concentrators['70000005'].status, 'MISSING_LOCATION');
  assert.equal(eng.db.sites.S01.latitude, 55.6761);
  const near = eng.sites(55.677, 12.567);
  assert.equal(near[0].siteCode, 'S01');
  assert.ok(near[0].distanceM > 50 && near[0].distanceM < 300);
  assert.equal(parseCsv('a,b\n"x, y",2\n')[0].a, 'x, y');
});

test('parsing odd inputs', () => {
  const links = normalise({ Links: [
    { SerialNumber: 1, TimestampUtcToDevice: null, RssiToDevice: -70 },
    { SerialNumber: '2', TimestampUtcToDevice: 'undefined', RssiToDevice: '-80' },
    { SerialNumber: '3', TimestampUtcToDevice: '/Date(1794474000000)/', RssiToDevice: -90 },
    { SerialNumber: '4', RssiToDevice: null }, 'garbage'] });
  assert.deepEqual(links.map((l) => l.serial), ['1', '2', '3']);
  assert.equal(links[0].fingerprint, '1||-70');
  assert.equal(parseTs('2026-11-12T09:00:00'), parseTs('2026-11-12T09:00:00Z'));
  assert.throws(() => make().eng.createSession('../../etc', 'Ana'), EngineError);
});

test('live fine tune: reference readings arrive without marking positions', async () => {
  const { eng, clock } = make();
  const sid = start(eng);
  await fullSweep(eng, clock, sid);
  await eng.positionMarked(sid, 'live', 1);
  let s;
  for (let i = 0; i < 18; i++) { clock.tick(5); s = (await eng.poll(sid)).summary; }
  assert.equal(s.live.serial, '70000001');
  assert.ok(s.live.readings.length >= 3);
  assert.equal(s.live.lastRssi, s.live.readings.at(-1).rssi);
  assert.ok(s.live.bestRssi >= s.live.lastRssi);
  assert.ok(s.live.intervalS >= 20 && s.live.intervalS <= 30 && s.live.ageSeconds < 35);
  await eng.callConfirmed(sid, 'final');
  await waitMeasured(eng, clock, sid);
  assert.ok(eng.summary(sid).finalCheck.ok);
});

test('four quadrants by default', async () => {
  const { eng, clock } = make({ settings: { coarseSteps: undefined } });
  assert.equal((await eng.handle('/api/config')).coarseSteps, 4);
  const sid = start(eng);
  await eng.callConfirmed(sid, 'initial');
  await waitMeasured(eng, clock, sid);
  for (const step of [2, 3, 4]) { await eng.positionMarked(sid, 'coarse', step); await waitMeasured(eng, clock, sid); }
  assert.equal(eng.summary(sid).coarseWinner.step, 3);
  await assert.rejects(eng.positionMarked(sid, 'coarse', 5), EngineError);
});

test('status check without CALL: only our receivers, grouped relations, nothing stored', async () => {
  const now = Date.UTC(2026, 10, 12, 9, 0, 0);
  const at = (minAgo) => new Date(now - minAgo * 60000).toISOString();
  const live = () => ({ SerialNumber: METER, LastSeenTimestampUtc: at(3), HoursSinceLastSeen: 0, Links: [
    { SerialNumber: '70000002', TimestampUtcToDevice: at(5), RssiToDevice: -95 },
    { SerialNumber: '70000001', TimestampUtcToDevice: at(3), RssiToDevice: -70 },
    { SerialNumber: '70000003', TimestampUtcToDevice: at(60 * 40), RssiToDevice: -60 },     // strong but not heard for 40 h
    { SerialNumber: '79999999', TimestampUtcToDevice: at(1), RssiToDevice: -50 }] });        // not ours
  const { eng, mem } = make({ live });
  const s = await eng.handle('/api/check', 'POST', { meterSerial: METER, gps: { lat: 55.677, lon: 12.567 } });
  assert.equal(s.session.status, 'CHECK');
  assert.deepEqual(s.receivers.map((r) => r.serial), ['70000001', '70000002', '70000003']);
  assert.deepEqual(s.receivers.map((r) => r.relation), ['PRIMARY', 'SAME_SITE', 'DISTINCT_SITE']);
  assert.equal(s.receivers[2].stale, true);
  assert.equal(s.backup.serial, '70000002');                 // the stale one is not offered as backup
  assert.ok(s.receivers[0].distanceM > 50);
  assert.equal(s.check.linksTotal, 4);
  assert.equal(Object.keys(JSON.parse(mem.db).sessions).length, 0);
  await assert.rejects(eng.check('../x'), EngineError);
});
