/* LinkIQ engine - the whole measurement workflow running on the device.
 *
 * Same rules and the same JSON as the optional Python server (backend/app/service.py),
 * so the user interface does not care which one answers:
 *   - HTTP 200 is not a measurement; a reading is new only if its fingerprint
 *     (serial|timestamp|rssi) was never processed in this session;
 *   - a baseline is captured when CALL is confirmed;
 *   - a reading belongs to the antenna position that was stable when it was taken;
 *   - a position is measured when the reference (strongest) receiver has reported
 *     there, or after one full reporting cycle;
 *   - every owned receiver is kept, weak ones included.
 *
 * Works in the browser (window.LinkIQEngine) and in Node (tests).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LinkIQEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULTS = {
    kamstrupBaseUrl: 'https://check.kamstrup.com/DeviceMonitorService/rest/devicedata',
    serialFields: ['SerialNumber', 'ConcentratorSerial', 'ConcentratorSerialNumber', 'ReceiverSerial', 'Serial'],
    pollMinIntervalS: 5,
    warnAfterS: 60,
    measureWindowS: 35,       // one full receiver reporting cycle (live test 2026-11-12)
    tsSkewToleranceS: 5,
    coarseSteps: 4,           // installer feedback: the antenna lobe is wide, four quadrants are enough
    fineSteps: 5,
    // PROVISIONAL thresholds (dBm): tune with field data before trusting them.
    rssiQuickConfirmDbm: -80,
    rssiGoodDbm: -95,
    rssiMarginalDbm: -110,
    primaryDegradationMaxDb: 6,
    simSpeed: 4,
    keepSessions: 200,
  };
  const OUTCOMES = ['OPTIMAL_CONFIRMED', 'GOOD_WITH_SITE_REDUNDANCY', 'GOOD_WITH_EQUIPMENT_REDUNDANCY',
    'GOOD_PRIMARY_ONLY', 'MARGINAL', 'NO_RELIABLE_LINK', 'INCONCLUSIVE', 'ABORTED'];
  const FINE_OFFSETS_DEG = [-24, -12, 0, 12, 24];
  const METER_RE = /^[0-9A-Za-z]{4,20}$/;
  const COMPASS_RO = ['N', 'NE', 'E', 'SE', 'S', 'SV', 'V', 'NV'];

  // Installation details recorded by the installer (nothing is guessed or defaulted).
  const LEVEL_KINDS = ['basement', 'ground', 'floor'];
  const PLACE_KINDS = ['meter', 'basement', 'ground', 'floor', 'facade', 'roof'];
  function cleanLevel(l, kinds) {
    if (!l || !kinds.includes(l.kind)) return null;
    const needsN = l.kind === 'basement' || l.kind === 'floor';
    const n = needsN ? Math.round(Number(l.n)) : null;
    if (needsN && !(n >= 1 && n <= 60)) return null;
    return { kind: l.kind, n };
  }
  function cleanInstall(i) {
    if (!i || typeof i !== 'object') return null;
    const out = { meterLevel: cleanLevel(i.meterLevel, LEVEL_KINDS),
      antennaType: ['internal', 'external'].includes(i.antennaType) ? i.antennaType : null,
      antennaPlace: cleanLevel(i.antennaPlace, PLACE_KINDS) };
    return out.meterLevel || out.antennaType || out.antennaPlace ? out : null;
  }
  const levelCode = (l) => (l ? l.kind + (l.n ? (l.kind === 'basement' ? '-' : '') + l.n : '') : '');

  class EngineError extends Error {
    constructor(status, code, message) { super(message); this.status = status; this.code = code; }
  }

  const iso = (ms) => (ms === null || ms === undefined ? null : new Date(ms).toISOString());
  const round1 = (x) => Math.round(x * 10) / 10;
  const rad = (d) => d * Math.PI / 180;

  // ------------------------------------------------------------------ geometry
  function distanceM(lat1, lon1, lat2, lon2) {
    const dp = rad(lat2 - lat1), dl = rad(lon2 - lon1);
    const a = Math.sin(dp / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dl / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.sqrt(a));
  }
  function bearingDeg(lat1, lon1, lat2, lon2) {
    const p1 = rad(lat1), p2 = rad(lat2), dl = rad(lon2 - lon1);
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }
  const compassRo = (b) => COMPASS_RO[Math.floor(((b + 22.5) % 360) / 45)];

  // ------------------------------------------------------------------ Kamstrup response
  function parseTs(value) {
    if (value === null || value === undefined || typeof value === 'number') return null;
    const text = String(value).trim();
    if (!text || ['null', 'undefined', 'none'].includes(text.toLowerCase())) return null;
    const m = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(text);
    if (m) return Number(m[1]);
    // The field name says UTC: a timestamp without a zone is read as UTC.
    const ms = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? text : text + 'Z');
    return Number.isNaN(ms) ? null : ms;
  }

  function normalise(payload, serialFields = DEFAULTS.serialFields) {
    if (!payload || typeof payload !== 'object') return [];
    const raw = payload.Links || payload.links || [];
    const links = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const key = serialFields.find((k) => item[k] !== null && item[k] !== undefined && item[k] !== '');
      const rssi = Number(item.RssiToDevice);
      if (!key || item.RssiToDevice === null || item.RssiToDevice === undefined || Number.isNaN(rssi)) continue;
      const ts = item.TimestampUtcToDevice;
      const lqi = item.LQI !== undefined ? item.LQI : item.Lqi;
      const serial = String(item[key]).trim(), tsRaw = ts === null || ts === undefined ? '' : String(ts);
      links.push({
        serial, tsRaw, observedMs: parseTs(ts), rssi: Math.round(rssi),
        lqi: lqi === null || lqi === undefined || Number.isNaN(Number(lqi)) ? null : Number(lqi),
        fingerprint: `${serial}|${tsRaw}|${Math.round(rssi)}`,   // EventKey from the handoff
      });
    }
    return links;
  }

  // ------------------------------------------------------------------ registry CSV
  const ALIASES = {
    siteCode: ['sitecode', 'site_code', 'site', 'sitenr', 'site nr', 'siteid'],
    name: ['name', 'sitename', 'navn'],
    address: ['address', 'adresse'],
    latitude: ['latitude', 'lat', 'breddegrad'],
    longitude: ['longitude', 'lon', 'lng', 'længdegrad', 'laengdegrad'],
    status: ['status'],
    serial: ['serialnumber', 'serial', 'serienummer', 'concentratorserial'],
    deviceType: ['devicetype', 'type'],
    firmware: ['firmware', 'fw'],
    active: ['active', 'aktiv'],
  };

  function parseCsv(text) {
    text = String(text).replace(/^﻿/, '');
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    const delim = [';', '\t', ','].map((d) => [d, firstLine.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = [];
    let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        if (row.some((c) => c.trim() !== '')) rows.push(row);
        row = [];
      } else cell += ch;
    }
    row.push(cell);
    if (row.some((c) => c.trim() !== '')) rows.push(row);
    if (!rows.length) return [];
    const head = rows[0].map((h) => h.trim().toLowerCase());
    return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
  }
  const pick = (row, field) => { const a = ALIASES[field].find((k) => row[k]); return a ? row[a] : ''; };
  const num = (t) => { const v = Number(String(t).replace(',', '.')); return t === '' || Number.isNaN(v) ? null : v; };

  // ------------------------------------------------------------------ simulator
  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  /** Rolling-snapshot simulator: after CALL each receiver reports on its own 20-30 s cycle. */
  class Simulator {
    constructor(clock, speed = 1, seed = null) {
      this.clock = clock; this.speed = Math.max(speed, 0.01);
      this.rnd = seed === null ? Math.random : mulberry32(seed);
      this.meters = {};
      //                serial      best bearing  peak dBm  off-axis loss  hear probability   (all invented)
      this.receivers = [['70000001', 200, -66, 22, 1.0], ['70000002', 215, -92, 14, 0.9],
        ['70000003', 40, -101, 18, 0.8], ['70000099', 300, -118, 8, 0.6]];
    }
    _uniform(a, b) { return a + (b - a) * this.rnd(); }
    _link(serial, bearing, peak, loss, orientation, whenMs) {
      const off = (1 - Math.cos(rad(orientation - bearing))) / 2;
      return { SerialNumber: serial, Manufacturer: 'KAM', Class: 'Concentrator',
        TimestampUtcToDevice: new Date(Math.floor(whenMs / 1000) * 1000).toISOString().replace('.000Z', 'Z'),
        RssiToDevice: Math.round(peak - loss * off + this._uniform(-1.5, 1.5)),
        TimestampUtcFromDevice: null, RssiFromDevice: 0, LQI: 0 };
    }
    _meter(serial) {
      if (!this.meters[serial]) {
        const old = this.clock() - 3600e3, links = {};
        for (const [s, b, p, l] of this.receivers.slice(0, 2)) links[s] = this._link(s, b, p, l, 0, old);
        this.meters[serial] = { orientation: 0, next: {}, links };
      }
      return this.meters[serial];
    }
    notifyCall(meter) {
      const m = this._meter(meter), now = this.clock();
      for (const [s] of this.receivers) m.next[s] = now + this._uniform(20, 40) * 1000 / this.speed;
    }
    silence(meter) { this._meter(meter).next = {}; }
    notifyOrientation(meter, deg) { this._advance(meter); this._meter(meter).orientation = ((deg % 360) + 360) % 360; }
    _advance(meter) {
      const m = this._meter(meter), now = this.clock();
      for (const [s, b, p, l, prob] of this.receivers) {
        while (m.next[s] !== undefined && m.next[s] <= now) {
          const when = m.next[s];
          if (this.rnd() <= prob) m.links[s] = this._link(s, b, p, l, m.orientation, when);
          m.next[s] = when + this._uniform(20, 30) * 1000 / this.speed;
        }
      }
    }
    fetch(meter) {
      this._advance(meter);
      return { SerialNumber: meter, Manufacturer: 'KAM', Class: 'Meter', Links: Object.values(this._meter(meter).links).map((l) => ({ ...l })) };
    }
  }

  // ------------------------------------------------------------------ engine
  class Engine {
    /**
     * storage:   {get(key), set(key, value)}   persistent JSON store
     * fetchJson: async (url) => parsed JSON    (live Kamstrup access)
     * clock:     () => epoch milliseconds
     */
    constructor({ storage, fetchJson, clock = () => Date.now(), settings = {}, simSeed = null }) {
      this.storage = storage; this.fetchJson = fetchJson; this.clock = clock;
      this.cfg = { ...DEFAULTS, ...Object.fromEntries(Object.entries(settings).filter(([, v]) => v !== undefined && v !== null)) };
      this.db = storage.get('db') || {};
      this.db.sites = this.db.sites || {};
      this.db.concentrators = this.db.concentrators || {};
      this.db.sessions = this.db.sessions || {};
      this.db.positions = this.db.positions || {};   // meter serial -> last known position (coordinates only)
      this.db.demo = !!this.db.demo;
      this.sim = new Simulator(clock, this.cfg.simSpeed, simSeed);
      this.cache = {};            // meter -> {links, atMs}: the 5 s limit per meter
      this.upstreamCalls = 0;
    }

    save() {
      const ids = Object.keys(this.db.sessions).sort((a, b) => this.db.sessions[a].startedMs - this.db.sessions[b].startedMs);
      while (ids.length > this.cfg.keepSessions) delete this.db.sessions[ids.shift()];
      this.storage.set('db', this.db);
    }

    get demo() { return this.db.demo; }
    setDemo(on) { this.db.demo = !!on; this.save(); }

    // ---------------------------------------------------------------- registry
    registryInfo() {
      const conc = Object.values(this.db.concentrators);
      return { sites: Object.keys(this.db.sites).length, concentrators: conc.length,
        review: conc.filter((c) => c.status === 'REVIEW' || c.status === 'MISSING_LOCATION').length };
    }
    clearRegistry() { this.db.sites = {}; this.db.concentrators = {}; this.db.registrySource = null; this.save(); }
    /** Replace the whole registry (built-in file, app folder). Nothing changes unless both lists hold rows. */
    replaceRegistry(sitesCsv, concentratorsCsv, source) {
      const probe = new Engine({ storage: { get: () => null, set: () => {} }, fetchJson: null, clock: this.clock });
      const a = probe.importSites(sitesCsv), b = probe.importConcentrators(concentratorsCsv);
      if (!a.imported || !b.imported) return null;
      this.db.sites = probe.db.sites; this.db.concentrators = probe.db.concentrators;
      this.db.registrySource = source || null;
      this.save();
      return this.registryInfo();
    }
    /** Put back a registry kept in a second place (used when the main store came back empty). */
    restoreRegistry(copy) {
      if (!copy || !copy.concentrators || !Object.keys(copy.concentrators).length) return false;
      this.db.sites = copy.sites || {}; this.db.concentrators = copy.concentrators; this.db.registrySource = copy.source || null;
      this.save();
      return true;
    }
    registryCopy() { return { sites: this.db.sites, concentrators: this.db.concentrators, source: this.db.registrySource || null }; }

    importSites(csvText) {
      let n = 0, bad = 0;
      for (const row of parseCsv(csvText)) {
        const code = pick(row, 'siteCode');
        if (!code) continue;
        let lat = num(pick(row, 'latitude')), lon = num(pick(row, 'longitude'));
        let status = pick(row, 'status') || 'ACTIVE';
        const ok = lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
        if (!ok) { lat = lon = null; status = 'MISSING_LOCATION'; bad++; }
        this.db.sites[code] = { siteCode: code, name: pick(row, 'name'), address: pick(row, 'address'),
          latitude: lat, longitude: lon, status, rankingEligible: ok };
        n++;
      }
      this._remapConcentrators();
      this.save();
      return { imported: n, review: bad };
    }

    importConcentrators(csvText) {
      let n = 0;
      for (const row of parseCsv(csvText)) {
        const serial = pick(row, 'serial');
        if (!serial) continue;
        this.db.concentrators[serial] = { serial, siteCode: pick(row, 'siteCode') || null,
          declaredSite: pick(row, 'siteCode') || null, deviceType: pick(row, 'deviceType'),
          firmware: pick(row, 'firmware'), declaredStatus: pick(row, 'status') || 'ACTIVE',
          active: !['0', 'false', 'nej', 'no'].includes(pick(row, 'active').toLowerCase()) };
        n++;
      }
      const review = this._remapConcentrators();
      this.save();
      return { imported: n, review };
    }

    /** Never guess a mapping: unknown or missing site codes are flagged, not dropped. */
    _remapConcentrators() {
      let review = 0;
      for (const c of Object.values(this.db.concentrators)) {
        if (!c.declaredSite) { c.siteCode = null; c.status = 'MISSING_LOCATION'; }
        else if (!this.db.sites[c.declaredSite]) { c.siteCode = null; c.status = 'REVIEW'; }
        else { c.siteCode = c.declaredSite; c.status = c.declaredStatus; }
        if (c.status === 'REVIEW' || c.status === 'MISSING_LOCATION') review++;
      }
      return review;
    }

    sites(lat = null, lon = null) {
      const bySite = {};
      for (const c of Object.values(this.db.concentrators)) if (c.active) (bySite[c.siteCode] = bySite[c.siteCode] || []).push(c.serial);
      const out = Object.values(this.db.sites).map((s) => {
        const d = { ...s, concentrators: bySite[s.siteCode] || [], distanceM: null, bearingDeg: null, compass: null };
        if (lat !== null && lon !== null && s.latitude !== null && s.longitude !== null) {
          d.distanceM = Math.round(distanceM(lat, lon, s.latitude, s.longitude));
          const b = bearingDeg(lat, lon, s.latitude, s.longitude);
          d.bearingDeg = Math.round(b); d.compass = compassRo(b);
        }
        return d;
      });
      out.sort((a, b) => (a.distanceM === null) - (b.distanceM === null) || (a.distanceM || 0) - (b.distanceM || 0) || a.siteCode.localeCompare(b.siteCode));
      return out;
    }

    // ---------------------------------------------------------------- meter positions
    /** A given position is remembered for the meter; without one, the remembered position is used. */
    _position(meterSerial, gps) {
      if (gps && gps.lat !== null && gps.lat !== undefined) {
        const pos = { lat: gps.lat, lon: gps.lon, accuracyM: gps.accuracyM !== undefined ? gps.accuracyM : null };
        if (!this.db.demo) { this.db.positions[meterSerial] = { ...pos, atMs: this.clock() }; this.save(); }
        return pos;
      }
      const saved = this.db.demo ? null : this.db.positions[meterSerial];
      if (saved) return { lat: saved.lat, lon: saved.lon, accuracyM: saved.accuracyM, source: 'saved', savedUtc: iso(saved.atMs) };
      return { lat: null, lon: null, accuracyM: null };
    }
    /** Set or correct the position of a session's meter, also after the session is closed. */
    setPosition(sid, gps) {
      const s = this._session(sid, false);
      if (!gps || gps.lat === null || gps.lat === undefined) throw new EngineError(422, 'BAD_POSITION', 'Poziție necunoscută');
      s.gps = this._position(s.meterSerial, gps);
      this.save();
      return this.summary(sid);
    }
    savedPosition(meterSerial) {
      const p = this.db.demo ? null : this.db.positions[String(meterSerial || '').trim()];
      return p ? { lat: p.lat, lon: p.lon, savedUtc: iso(p.atMs) } : null;
    }

    // ---------------------------------------------------------------- sessions
    _session(sid, active = true) {
      const s = this.db.sessions[sid];
      if (!s) throw new EngineError(404, 'UNKNOWN_SESSION', 'Sesiunea nu a fost găsită');
      if (active && s.status !== 'ACTIVE') throw new EngineError(409, 'SESSION_CLOSED', 'Sesiunea este deja închisă');
      return s;
    }

    createSession(meterSerial, technician, gps = null) {
      meterSerial = String(meterSerial || '').trim();
      technician = String(technician || '').trim() || 'necunoscut';
      if (!METER_RE.test(meterSerial)) throw new EngineError(422, 'BAD_METER_SERIAL', 'Seria contorului trebuie să aibă 4–20 litere sau cifre');
      const now = this.clock();
      let s = Object.values(this.db.sessions).find((x) => x.status === 'ACTIVE' && x.meterSerial === meterSerial && x.demo === this.db.demo);
      if (!s) {
        const id = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('') + now.toString(16);
        s = this.db.sessions[id] = { id, meterSerial, technician, demo: this.db.demo,
          gps: this._position(meterSerial, gps),
          startedMs: now, finishedMs: null, status: 'ACTIVE', state: 'READY', initialCallMs: null, finalCallMs: null,
          outcome: null, note: null, decision: null, samples: [], obs: [], nextSampleId: 1 };
        this.save();
      }
      return this.summary(s.id);
    }

    async callConfirmed(sid, phase = 'initial') {
      if (phase !== 'initial' && phase !== 'final') throw new EngineError(422, 'BAD_PHASE', 'phase must be initial or final');
      const s = this._session(sid);
      if (phase === 'initial') {
        if (s.state !== 'READY') throw new EngineError(409, 'BAD_STATE', 'CALL-ul inițial a fost deja confirmat');
        await this._ingest(s, true);              // baseline: nothing seen so far may be reused
        if (s.demo) this.sim.notifyCall(s.meterSerial);
        this._newSample(s, 'coarse', 1, null, 'initialCallMs');
      } else {
        if (s.state === 'READY') throw new EngineError(409, 'BAD_STATE', 'Confirmă întâi CALL-ul inițial');
        await this._ingest(s);                    // anything pending belongs to the previous position
        if (s.demo) this.sim.notifyCall(s.meterSerial);
        this._newSample(s, 'final', 1, null, 'finalCallMs');
      }
      return this.summary(sid);
    }

    async positionMarked(sid, phase, step, heading = null) {
      const limit = { coarse: this.cfg.coarseSteps, fine: this.cfg.fineSteps, live: 1 }[phase];
      if (!limit || !(step >= 1 && step <= limit)) throw new EngineError(422, 'BAD_POSITION', 'Poziție necunoscută');
      const s = this._session(sid);
      if (s.state !== 'MEASURED') throw new EngineError(409, 'BAD_STATE', 'Așteaptă măsurătoarea (sau sari peste) înainte de a muta antena');
      await this._ingest(s);
      this._newSample(s, phase, step, heading);
      return this.summary(sid);
    }

    skip(sid) {
      const s = this._session(sid);
      if (s.state !== 'WAIT_RF') throw new EngineError(409, 'BAD_STATE', 'Nu este nimic de sărit');
      s.samples[s.samples.length - 1].skipped = true;
      s.state = 'MEASURED';
      this.save();
      return this.summary(sid);
    }

    _newSample(s, phase, step, heading, callField = null) {
      const now = this.clock();
      s.samples.push({ id: s.nextSampleId++, phase, step, headingDeg: heading, movedMs: now, skipped: false });
      s.state = 'WAIT_RF';
      if (callField) s[callField] = now;
      this.save();
      if (s.demo) this.sim.notifyOrientation(s.meterSerial, this._simDegrees(s, phase, step));
    }

    _simDegrees(s, phase, step) {
      const sector = 360 / this.cfg.coarseSteps;
      if (phase === 'coarse') return (step - 1) * sector;
      const summ = this.summary(s.id), cw = summ.coarseWinner;
      const base = cw ? (cw.step - 1) * sector : 0;
      if (phase === 'fine') return base + FINE_OFFSETS_DEG[step - 1];
      return summ.best && summ.best.phase === 'fine' ? base + FINE_OFFSETS_DEG[summ.best.step - 1] : base;
    }

    // ---------------------------------------------------------------- polling
    async _snapshot(s) {
      const now = this.clock(), key = (s.demo ? 'sim:' : '') + s.meterSerial, hit = this.cache[key];
      if (hit && now - hit.atMs < this.cfg.pollMinIntervalS * 1000) return hit.links;
      this.upstreamCalls++;
      const payload = s.demo ? this.sim.fetch(s.meterSerial)
        : await this.fetchJson(`${this.cfg.kamstrupBaseUrl}/${encodeURIComponent(s.meterSerial)}`);
      const links = normalise(payload, this.cfg.serialFields);
      this.cache[key] = { links, atMs: now };
      return links;
    }

    async _ingest(s, asBaseline = false) {
      let links;
      try { links = await this._snapshot(s); } catch (e) { return { fresh: [], count: 0, warning: 'UPSTREAM_ERROR: ' + e.message }; }
      const now = this.clock(), tol = this.cfg.tsSkewToleranceS * 1000;
      const seen = new Set(s.obs.map((o) => o.fp));
      const registryEmpty = Object.keys(this.db.concentrators).length === 0;
      const sample = s.samples[s.samples.length - 1] || null;
      const fresh = [];
      for (const link of links) {
        if (seen.has(link.fingerprint)) continue;
        seen.add(link.fingerprint);
        const reg = this.db.concentrators[link.serial];
        const owned = registryEmpty || !!reg;
        let kind, sampleId = null;
        if (asBaseline || !sample) kind = 'baseline';
        else if (link.observedMs === null) { kind = 'fresh'; sampleId = sample.id; }   // no source time: trust arrival order
        else {
          // The reading belongs to the position that was stable when it was taken,
          // which is not always the current one (receivers report with a delay).
          const home = [...s.samples].reverse().find((x) => link.observedMs >= x.movedMs - tol);
          if (home) { kind = 'fresh'; sampleId = home.id; } else kind = 'stale';
        }
        s.obs.push({ sampleId, serial: link.serial, siteCode: reg ? reg.siteCode : null, observedMs: link.observedMs,
          receivedMs: now, rssi: link.rssi, lqi: link.lqi, fp: link.fingerprint, owned, kind });
        if (kind === 'fresh' && sampleId === sample.id) {
          fresh.push({ concentratorSerial: link.serial, observedAtUtc: iso(link.observedMs), rssiDbm: link.rssi,
            lqi: link.lqi, fingerprint: link.fingerprint, owned, siteId: reg ? reg.siteCode : null });
        }
      }
      if (s.state === 'WAIT_RF' && sample && this._positionMeasured(s, sample, now)) s.state = 'MEASURED';
      this.save();
      return { fresh, count: links.length, warning: null };
    }

    /** Measured = the reference receiver reported here, or one full cycle passed since the first report. */
    _positionMeasured(s, sample, now) {
      const here = s.obs.filter((o) => o.sampleId === sample.id && o.kind === 'fresh' && o.owned);
      if (!here.length) return false;
      const groups = {};
      for (const o of s.obs) {
        if (o.kind !== 'fresh' || !o.owned || o.sampleId === null || o.sampleId >= sample.id) continue;
        const k = o.sampleId + '|' + o.serial;
        (groups[k] = groups[k] || { serial: o.serial, sum: 0, n: 0 });
        groups[k].sum += o.rssi; groups[k].n++;
      }
      const ref = Object.values(groups).sort((a, b) => b.sum / b.n - a.sum / a.n)[0];
      if (ref && here.some((o) => o.serial === ref.serial)) return true;
      const windowMs = this.cfg.measureWindowS * 1000 / (s.demo ? this.sim.speed : 1);   // the demo runs faster
      return now - Math.min(...here.map((o) => o.receivedMs)) >= windowMs;
    }

    async poll(sid) {
      const s = this._session(sid);
      if (s.state === 'READY') throw new EngineError(409, 'BAD_STATE', 'Confirmă CALL înainte de interogare');
      const cur = s.samples[s.samples.length - 1];
      if (s.demo && cur && cur.phase === 'live') {
        // Demonstration only: pretend the installer is slowly sweeping the antenna.
        const base = this._simDegrees(s, 'live', 1);
        this.sim.notifyOrientation(s.meterSerial, base + 45 * Math.sin(this.clock() * this.sim.speed / 20000));
      }
      const r = await this._ingest(s);
      const summ = this.summary(sid);
      const wait = summ.current ? summ.current.waitSeconds : 0;
      let warning = r.warning;
      if (!warning && summ.session.state === 'WAIT_RF' && wait >= this.cfg.warnAfterS) warning = 'SLOW_RF';
      return { meterSerial: s.meterSerial, receivedAtUtc: iso(this.clock()), fresh: r.fresh,
        snapshotCount: r.count, waitSeconds: wait, warning, summary: summ };
    }

    complete(sid, outcome = null, note = null, install = null) {
      const summ = this.summary(sid), s = this._session(sid);
      outcome = outcome || summ.suggestedOutcome;
      if (!OUTCOMES.includes(outcome)) throw new EngineError(422, 'BAD_OUTCOME', 'Rezultat necunoscut');
      s.status = outcome === 'ABORTED' ? 'ABORTED' : 'COMPLETED';
      s.state = 'COMPLETE'; s.outcome = outcome; s.note = note; s.finishedMs = this.clock();
      s.install = cleanInstall(install);
      s.decision = { best: summ.best, primary: summ.primary, backup: summ.backup, finalCheck: summ.finalCheck, suggestedOutcome: summ.suggestedOutcome };
      this.save();
      return this.summary(sid);
    }

    /**
     * Status of a meter without a session and without CALL: one read of the
     * Kamstrup snapshot, showing which of our receivers hear it and when.
     * Nothing is stored on the device.
     */
    async check(meterSerial, gps = null, technician = '') {
      meterSerial = String(meterSerial || '').trim();
      if (!METER_RE.test(meterSerial)) throw new EngineError(422, 'BAD_METER_SERIAL', 'Seria contorului trebuie să aibă 4–20 litere sau cifre');
      const now = this.clock(), key = (this.db.demo ? 'sim:' : '') + 'check:' + meterSerial;
      let hit = this.cache[key];
      if (!hit || now - hit.atMs >= this.cfg.pollMinIntervalS * 1000) {
        this.upstreamCalls++;
        let payload;
        try {
          payload = this.db.demo ? this.sim.fetch(meterSerial) : await this.fetchJson(`${this.cfg.kamstrupBaseUrl}/${encodeURIComponent(meterSerial)}`);
        } catch (e) { throw new EngineError(502, 'UPSTREAM_ERROR', 'Serviciul Kamstrup nu răspunde. Încearcă din nou.'); }
        hit = this.cache[key] = { payload, atMs: now };
      }
      const payload = hit.payload || {}, links = normalise(payload, this.cfg.serialFields);
      const registryEmpty = Object.keys(this.db.concentrators).length === 0;
      const g = this._position(meterSerial, gps);
      const rows = links.filter((l) => registryEmpty || this.db.concentrators[l.serial]).map((l) => {
        const c = this.db.concentrators[l.serial], site = c ? this.db.sites[c.siteCode] : null;
        const d = { serial: l.serial, siteCode: c ? c.siteCode : null, siteName: site ? site.name || null : null,
          address: site ? site.address || null : null, latitude: site ? site.latitude : null, longitude: site ? site.longitude : null,
          registryStatus: c ? c.status : null, bestRssi: l.rssi, lastRssi: l.rssi, bestPhase: 'check', bestStep: null, sectors: [],
          observedUtc: iso(l.observedMs), stale: l.observedMs !== null && now - l.observedMs > 26 * 3600e3,   // not heard for over a day
          relation: 'UNKNOWN_SITE', distanceM: null, bearingDeg: null, compass: null };
        if (g.lat !== null && d.latitude !== null && d.latitude !== undefined) {
          d.distanceM = Math.round(distanceM(g.lat, g.lon, d.latitude, d.longitude));
          const b = bearingDeg(g.lat, g.lon, d.latitude, d.longitude);
          d.bearingDeg = Math.round(b); d.compass = compassRo(b);
        }
        if (d.latitude === undefined) d.latitude = d.longitude = null;
        return d;
      }).sort((a, b) => (a.stale - b.stale) || b.bestRssi - a.bestRssi);
      const p1 = rows[0] || null;
      rows.forEach((r, i) => {
        r.relation = i === 0 ? 'PRIMARY' : (r.siteCode === null || p1.siteCode === null) ? 'UNKNOWN_SITE' : r.siteCode === p1.siteCode ? 'SAME_SITE' : 'DISTINCT_SITE';
      });
      const others = rows.slice(1).filter((r) => !r.stale);
      const pick = others.find((r) => r.relation === 'DISTINCT_SITE') || others[0] || null;
      const lastSeenMs = parseTs(payload.LastSeenTimestampUtc);
      const warnings = [];
      if (registryEmpty) warnings.push('REGISTRY_EMPTY');
      if (g.lat === null) warnings.push('NO_GPS');
      return {
        session: { id: null, meterSerial, technician: String(technician || '').trim(), gps: g, status: 'CHECK', state: 'CHECK',
          startedUtc: iso(now), finishedUtc: iso(now), initialCallUtc: null, finalCallUtc: null, outcome: null, note: null, demo: this.db.demo },
        current: null, coarse: [], fine: [], final: null, coarseWinner: null, fineWinner: null,
        best: p1 ? { phase: 'check', step: null, rssi: p1.bestRssi, serial: p1.serial } : null,
        primary: p1 ? { serial: p1.serial, siteCode: p1.siteCode, siteName: p1.siteName, address: p1.address, rssi: p1.bestRssi } : null,
        backup: pick ? { serial: pick.serial, siteCode: pick.siteCode, siteName: pick.siteName, redundancy: pick.relation, bestRssi: pick.bestRssi,
          bestPhase: 'check', bestStep: null, usable: pick.bestRssi >= this.cfg.rssiMarginalDbm, primaryRssiThere: null,
          primaryDegradationDb: null, positionRecommendable: false } : null,
        receivers: rows, finalCheck: null, live: null, quickConfirmEligible: false,
        check: { lastSeenUtc: iso(lastSeenMs), hoursSinceLastSeen: typeof payload.HoursSinceLastSeen === 'number' ? payload.HoursSinceLastSeen : null,
          linksTotal: links.length, linksOwned: rows.length, fetchedUtc: iso(hit.atMs) },
        suggestedOutcome: 'INCONCLUSIVE', outcomes: OUTCOMES, warnings,
      };
    }

    /** Flat rows for Network Intelligence / coverage analysis. */
    exportCsv() {
      const cols = ['session_id', 'meter_serial', 'technician', 'gps_lat', 'gps_lon', 'outcome', 'meter_level', 'antenna_type', 'antenna_place', 'phase', 'step',
        'heading_deg', 'kind', 'concentrator_serial', 'site_code', 'owned', 'rssi_dbm', 'lqi', 'observed_utc', 'received_utc'];
      const lines = [cols.join(';')];
      for (const s of Object.values(this.db.sessions)) {
        if (s.demo) continue;
        const byId = Object.fromEntries(s.samples.map((x) => [x.id, x]));
        for (const o of s.obs) {
          const p = byId[o.sampleId] || {};
          const ins = s.install || {};
          lines.push([s.id, s.meterSerial, s.technician, s.gps.lat, s.gps.lon, s.outcome, levelCode(ins.meterLevel), ins.antennaType, levelCode(ins.antennaPlace), p.phase, p.step, p.headingDeg,
            o.kind, o.serial, o.siteCode, o.owned ? 1 : 0, o.rssi, o.lqi, iso(o.observedMs), iso(o.receivedMs)]
            .map((v) => (v === null || v === undefined ? '' : String(v).replace(/[;\r\n]/g, ' '))).join(';'));
        }
      }
      return lines.join('\r\n');
    }
    sessionCount() { return Object.values(this.db.sessions).filter((s) => !s.demo).length; }

    // ---------------------------------------------------------------- summary
    summary(sid) {
      const cfg = this.cfg, s = this._session(sid, false), now = this.clock();
      const regOf = (serial) => {
        const c = this.db.concentrators[serial];
        if (!c) return null;
        const site = this.db.sites[c.siteCode] || {};
        return { siteCode: c.siteCode, status: c.status, name: site.name || null, address: site.address || null,
          latitude: site.latitude === undefined ? null : site.latitude, longitude: site.longitude === undefined ? null : site.longitude };
      };

      const per = {};
      let missingTs = false;
      for (const o of s.obs) {
        if (o.kind !== 'fresh' || !o.owned) continue;
        ((per[o.sampleId] = per[o.sampleId] || {})[o.serial] = per[o.sampleId][o.serial] || []).push(o.rssi);
        if (o.observedMs === null) missingTs = true;
      }
      const stats = (smp) => {
        const recv = {};
        let n = 0;
        for (const [k, v] of Object.entries(per[smp.id] || {})) { recv[k] = round1(v.reduce((a, b) => a + b, 0) / v.length); n += v.length; }
        const ranked = Object.entries(recv).sort((a, b) => b[1] - a[1]);
        return { sampleId: smp.id, phase: smp.phase, step: smp.step, headingDeg: smp.headingDeg,
          measured: ranked.length > 0, skipped: !!smp.skipped,
          bestRssi: ranked.length ? ranked[0][1] : null, bestSerial: ranked.length ? ranked[0][0] : null,
          secondRssi: ranked.length > 1 ? ranked[1][1] : null, nObs: n, receivers: recv };
      };
      const latest = {};
      for (const smp of s.samples) latest[smp.phase + '|' + smp.step] = stats(smp);   // a repeat replaces the earlier attempt
      const group = (phase) => Object.values(latest).filter((x) => x.phase === phase).sort((a, b) => a.step - b.step);
      const coarse = group('coarse'), fine = group('fine'), final = latest['final|1'] || null;
      const winner = (g) => {
        const m = g.filter((x) => x.measured);
        if (!m.length) return null;
        const w = m.reduce((a, b) => (b.bestRssi > a.bestRssi ? b : a));
        return { phase: w.phase, step: w.step, rssi: w.bestRssi, serial: w.bestSerial };
      };
      const coarseWinner = winner(coarse), fineWinner = winner(fine), best = winner(coarse.concat(fine));

      let current = null;
      if (s.samples.length) {
        const last = s.samples[s.samples.length - 1];
        const wait = s.state === 'WAIT_RF' ? Math.floor((now - last.movedMs) / 1000) : 0;
        current = { ...stats(last), waitSeconds: Math.max(wait, 0) };
      }

      // Live fine tune: every reading of the reference receiver while the installer
      // nudges the antenna inside the winning sector. No positions are marked.
      let live = null;
      const liveSmp = [...s.samples].reverse().find((x) => x.phase === 'live');
      if (liveSmp && coarseWinner) {
        const mine = s.obs.filter((o) => o.kind === 'fresh' && o.serial === coarseWinner.serial);
        const when = (o) => (o.observedMs !== null ? o.observedMs : o.receivedMs);
        const here = mine.filter((o) => o.sampleId === liveSmp.id).sort((a, b) => when(a) - when(b));
        const times = mine.map(when).sort((a, b) => a - b);
        const gaps = times.slice(1).map((t, i) => (t - times[i]) / 1000).filter((g) => g >= 5 && g <= 90).sort((a, b) => a - b);
        const last = here[here.length - 1] || null;
        live = { serial: coarseWinner.serial, referenceRssi: coarseWinner.rssi,
          readings: here.slice(-24).map((o) => ({ atUtc: iso(when(o)), rssi: o.rssi })),
          lastRssi: last ? last.rssi : null, previousRssi: here.length > 1 ? here[here.length - 2].rssi : null,
          bestRssi: here.length ? Math.max(...here.map((o) => o.rssi)) : null,
          ageSeconds: last ? Math.max(0, Math.floor((now - last.receivedMs) / 1000)) : null,
          intervalS: gaps.length ? Math.round(gaps[Math.floor(gaps.length / 2)]) : 30 };   // how often this receiver reports
      }

      const primarySerial = best ? best.serial : null;
      const pReg = primarySerial ? regOf(primarySerial) : null;
      const primarySite = pReg ? pReg.siteCode : null;
      const agg = {};
      for (const st of coarse.concat(fine, final ? [final] : [])) {
        for (const [serial, rssi] of Object.entries(st.receivers)) {
          const a = agg[serial] = agg[serial] || { best: rssi, bestPos: st, sectors: new Set(), last: rssi };
          if (rssi > a.best) { a.best = rssi; a.bestPos = st; }
          a.last = rssi;
          if (st.phase === 'coarse') a.sectors.add(st.step);
        }
      }
      const receivers = Object.entries(agg).map(([serial, a]) => {
        const r = regOf(serial), site = r ? r.siteCode : null;
        const relation = serial === primarySerial ? 'PRIMARY' : (site === null || primarySite === null) ? 'UNKNOWN_SITE'
          : site === primarySite ? 'SAME_SITE' : 'DISTINCT_SITE';
        const d = { serial, siteCode: site, siteName: r ? r.name : null, address: r ? r.address : null,
          latitude: r ? r.latitude : null, longitude: r ? r.longitude : null, registryStatus: r ? r.status : null,
          bestRssi: a.best, lastRssi: a.last, bestPhase: a.bestPos.phase, bestStep: a.bestPos.step,
          sectors: [...a.sectors].sort((x, y) => x - y), relation, distanceM: null, bearingDeg: null, compass: null };
        if (r && s.gps.lat !== null && s.gps.lon !== null && r.latitude !== null && r.longitude !== null) {
          d.distanceM = Math.round(distanceM(s.gps.lat, s.gps.lon, r.latitude, r.longitude));
          const b = bearingDeg(s.gps.lat, s.gps.lon, r.latitude, r.longitude);
          d.bearingDeg = Math.round(b); d.compass = compassRo(b);
        }
        return d;
      }).sort((a, b) => b.bestRssi - a.bestRssi);

      // Redundancy: best non-primary receiver, a distinct site preferred.
      let backup = null;
      const others = receivers.filter((r) => r.relation !== 'PRIMARY');
      if (others.length) {
        const pickB = others.find((r) => r.relation === 'DISTINCT_SITE') || others[0];
        const pos = agg[pickB.serial].bestPos;
        const there = pos.receivers[primarySerial];
        const degradation = there !== undefined ? round1(best.rssi - there) : null;
        backup = { serial: pickB.serial, siteCode: pickB.siteCode, siteName: pickB.siteName, redundancy: pickB.relation,
          bestRssi: pickB.bestRssi, bestPhase: pos.phase, bestStep: pos.step, usable: pickB.bestRssi >= cfg.rssiMarginalDbm,
          primaryRssiThere: there === undefined ? null : there, primaryDegradationDb: degradation,
          // Never recommend a backup position that costs the primary link too much.
          positionRecommendable: degradation !== null && degradation <= cfg.primaryDegradationMaxDb };
      }

      let finalCheck = null;
      if (final && final.measured && best) {
        const rssi = final.receivers[primarySerial] === undefined ? null : final.receivers[primarySerial];   // same receiver, or no verdict
        const delta = rssi !== null ? round1(rssi - best.rssi) : null;
        finalCheck = { rssi, winnerRssi: best.rssi, deltaDb: delta, ok: delta !== null && delta >= -cfg.primaryDegradationMaxDb };
      }

      // Suggested outcome: PROVISIONAL thresholds, the installer can override.
      const ref = finalCheck ? (finalCheck.rssi !== null ? finalCheck.rssi : -Infinity) : (best ? best.rssi : null);
      let outcome;
      if (ref === null) outcome = 'INCONCLUSIVE';
      else if (ref < cfg.rssiMarginalDbm) outcome = 'NO_RELIABLE_LINK';
      else if (ref < cfg.rssiGoodDbm) outcome = 'MARGINAL';
      else if (finalCheck && finalCheck.ok && ref >= cfg.rssiQuickConfirmDbm) outcome = 'OPTIMAL_CONFIRMED';
      else if (backup && backup.usable && backup.redundancy === 'DISTINCT_SITE') outcome = 'GOOD_WITH_SITE_REDUNDANCY';
      else if (backup && backup.usable && backup.redundancy === 'SAME_SITE') outcome = 'GOOD_WITH_EQUIPMENT_REDUNDANCY';
      else outcome = 'GOOD_PRIMARY_ONLY';

      const warnings = [];
      if (!Object.keys(this.db.concentrators).length) warnings.push('REGISTRY_EMPTY');
      if (missingTs) warnings.push('MISSING_SOURCE_TIMESTAMP');
      if (s.gps.lat === null) warnings.push('NO_GPS');
      const quick = s.samples.length === 1 && coarse.length && coarse[0].measured && coarse[0].bestRssi >= cfg.rssiQuickConfirmDbm;

      return {
        session: { id: s.id, meterSerial: s.meterSerial, technician: s.technician, gps: { ...s.gps }, status: s.status,
          state: s.state, startedUtc: iso(s.startedMs), finishedUtc: iso(s.finishedMs), initialCallUtc: iso(s.initialCallMs),
          finalCallUtc: iso(s.finalCallMs), outcome: s.outcome, note: s.note, demo: s.demo, install: s.install || null },
        current, coarse, fine, final, coarseWinner, fineWinner, best,
        primary: best ? { serial: primarySerial, siteCode: primarySite, siteName: pReg ? pReg.name : null,
          address: pReg ? pReg.address : null, rssi: best.rssi } : null,
        backup, receivers, finalCheck, live, quickConfirmEligible: !!quick,
        suggestedOutcome: outcome, outcomes: OUTCOMES, warnings,
      };
    }

    // ---------------------------------------------------------------- same routes as the server
    async handle(path, method = 'GET', body = {}) {
      const [route, query = ''] = path.split('?');
      const q = Object.fromEntries(new URLSearchParams(query));
      const m = /^\/api\/sessions\/([^/]+)(?:\/(.+))?$/.exec(route);
      if (route === '/api/config') {
        return { authMode: 'none', kamstrupMode: this.db.demo ? 'sim' : 'live', standalone: true,
          pollIntervalS: this.cfg.pollMinIntervalS, warnAfterS: this.cfg.warnAfterS,
          coarseSteps: this.cfg.coarseSteps, fineSteps: this.cfg.fineSteps,
          thresholds: { quickConfirmDbm: this.cfg.rssiQuickConfirmDbm, goodDbm: this.cfg.rssiGoodDbm, marginalDbm: this.cfg.rssiMarginalDbm, provisional: true } };
      }
      if (route === '/api/me') return { technician: null };
      if (route === '/api/sites') return this.sites(q.lat !== undefined ? Number(q.lat) : null, q.lon !== undefined ? Number(q.lon) : null);
      if (route === '/api/check' && method === 'POST') return this.check(body.meterSerial, body.gps || null, body.technician || '');
      if (route === '/api/sessions' && method === 'POST') return this.createSession(body.meterSerial, body.technician, body.gps || null);
      if (m && !m[2]) return this.summary(m[1]);
      if (m && m[2] === 'call-confirmed') return this.callConfirmed(m[1], body.phase || 'initial');
      if (m && m[2] === 'position-marked') return this.positionMarked(m[1], body.phase, body.step, body.headingDeg === undefined ? null : body.headingDeg);
      if (m && m[2] === 'skip') return this.skip(m[1]);
      if (m && m[2] === 'poll') return this.poll(m[1]);
      if (m && m[2] === 'complete') return this.complete(m[1], body.outcome || null, body.note || null, body.install || null);
      if (m && m[2] === 'position') return this.setPosition(m[1], body.gps || null);
      throw new EngineError(404, 'NOT_FOUND', 'Rută necunoscută: ' + route);
    }
  }

  return { Engine, EngineError, Simulator, normalise, parseTs, parseCsv, distanceM, bearingDeg, DEFAULTS, OUTCOMES };
});
