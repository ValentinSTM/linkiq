/* LinkIQ Field Assistant - PWA client. Plain JavaScript, no build step, no framework.
   The server owns the session; this file only renders the summary it returns and
   decides which single instruction to show next. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const VERSION = '0.8';
  const FINE = ['marginea stângă', 'jumătatea stângă', 'centru', 'jumătatea dreaptă', 'marginea dreaptă'];
  const FINE_MOVE = ['Mută la marginea stângă', 'Mută la jumătatea stângă', 'Mută în centru', 'Mută la jumătatea dreaptă', 'Mută la marginea dreaptă'];
  const FINE_SHORT = ['◀◀', '◀', '●', '▶', '▶▶'];
  const OUTCOME_RO = {
    OPTIMAL_CONFIRMED: 'Optim, confirmat',
    GOOD_WITH_SITE_REDUNDANCY: 'Bun, cu rezervă pe alt site',
    GOOD_WITH_EQUIPMENT_REDUNDANCY: 'Bun, cu rezervă pe același site',
    GOOD_PRIMARY_ONLY: 'Bun, fără rezervă',
    MARGINAL: 'La limită',
    NO_RELIABLE_LINK: 'Fără legătură sigură',
    INCONCLUSIVE: 'Neconcludent',
    ABORTED: 'Abandonat',
  };
  const RELATION_RO = { PRIMARY: 'principal', SAME_SITE: 'același site', DISTINCT_SITE: 'alt site', UNKNOWN_SITE: 'site necunoscut' };

  const store = {
    get: (k, d = null) => { try { const v = localStorage.getItem('linkiq.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem('linkiq.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
    del: (k) => { try { localStorage.removeItem('linkiq.' + k); } catch { /* ignore */ } },
  };

  // ---------------------------------------------------------------- language
  // Source strings are Romanian (gettext style); i18n.js holds the Danish for each.
  let lang = store.get('lang') || ((navigator.language || '').toLowerCase().startsWith('ro') ? 'ro' : 'da');
  function T(key, ...args) {
    const tpl = lang === 'da' && window.LINKIQ_DA && window.LINKIQ_DA[key] !== undefined ? window.LINKIQ_DA[key] : key;
    return args.length ? String(tpl).replace(/\{(\d+)\}/g, (m, i) => (args[i] === undefined ? m : args[i])) : tpl;
  }
  const outcomeLabel = (o) => T(OUTCOME_RO[o] || o);
  function ago(utc) {
    const sec = Math.max(0, Math.round((Date.now() - new Date(utc).getTime()) / 1000));
    if (sec < 90) return T('acum {0} s', sec);
    if (sec < 5400) return T('acum {0} min', Math.round(sec / 60));
    if (sec < 172800) return T('acum {0} ore', Math.round(sec / 3600));
    return T('acum {0} zile', Math.round(sec / 86400));
  }
  /** Translate the text that is written in index.html (labels, buttons, placeholders). */
  function translatePage() {
    document.documentElement.lang = lang;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.parentNode.closest('script, style, #map')) continue;
      if (n.__src === undefined) n.__src = n.nodeValue;
      const key = n.__src.trim();
      if (key) n.nodeValue = n.__src.replace(key, T(key));
    }
    document.querySelectorAll('[placeholder]').forEach((el) => {
      if (!el.dataset.ph) el.dataset.ph = el.placeholder;
      el.placeholder = T(el.dataset.ph);
    });
    $('lang-btn').textContent = lang === 'da' ? 'RO' : 'DA';   // the language you can switch to
  }

  let cfg = { pollIntervalS: 5, warnAfterS: 60, coarseSteps: 6, fineSteps: 5, authMode: 'none' };
  let S = null;                 // latest session summary from the server
  let ui = {};                  // client-only choices for this session (quick confirm, fine tune...)
  let gps = null;
  let heading = null;
  let pollTimer = null, tickTimer = null, lastSummaryAt = 0, busy = false, armedRestart = false;
  let map = null, mapLayer = null, selectedSerial = null, wakeLock = null;
  let engine = null;            // set when there is no LinkIQ server: everything runs on this device

  // ---------------------------------------------------------------- API
  async function api(path, method = 'GET', body) {
    if (engine) {
      $('net').hidden = true;
      return engine.handle(path, method, body || {});   // EngineError carries status/code like an HTTP error
    }
    const headers = { Accept: 'application/json' };
    const token = store.get('token');
    if (token) headers.Authorization = 'Bearer ' + token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) {
      $('net').hidden = false;
      throw new Error(T('Nu pot ajunge la serverul LinkIQ. Verifică dacă este pornit și dacă ai conexiune.'));
    }
    $('net').hidden = true;
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && cfg.authMode === 'token' && path !== '/api/me') {
      store.del('token');          // code revoked or never valid: back to pairing
      if (S) leaveSession();
      showView('pair');
    }
    if (!res.ok) {
      const err = new Error(data.message || T('Eroare {0}', res.status));
      err.code = data.code; err.status = res.status;
      throw err;
    }
    return data;
  }

  const dbm = (v) => (v === null || v === undefined ? '–' : Math.round(v) + ' dBm');
  const dist = (m) => (m === null || m === undefined ? '' : m >= 1000 ? (m / 1000).toFixed(1) + ' km' : m + ' m');

  // ---------------------------------------------------------------- next instruction
  function nextAction(s) {
    if (s.session.status === 'CHECK') return { kind: 'check' };
    if (s.session.status !== 'ACTIVE') return { kind: 'done' };
    const st = s.session.state, cur = s.current;
    if (st === 'READY') return { kind: 'initialCall' };
    if (cur.phase === 'live') return ui.goFinal ? { kind: 'finalCall' } : { kind: 'live' };
    if (st === 'WAIT_RF') return { kind: 'wait' };
    if (cur.phase === 'final') return { kind: 'finish' };
    if (ui.goFinal) return { kind: 'finalCall' };
    if (cur.phase === 'coarse') {
      if (cur.step === 1 && s.quickConfirmEligible && !ui.fullSweep) return { kind: 'quickChoice' };
      if (cur.step < cfg.coarseSteps) return { kind: 'move', phase: 'coarse', step: cur.step + 1 };
      if (!s.coarseWinner) return { kind: 'finish' };
      return { kind: 'coarseDone' };
    }
    return { kind: 'finalCall' };   // a session from an older version, left in the 5-position fine tune
  }

  function bestLabel(s) {
    if (!s.best) return '';
    const sector = s.coarseWinner ? T('felia {0}', s.coarseWinner.step) : '';
    return s.best.phase === 'fine' ? `${sector}, ${FINE[s.best.step - 1]}` : sector;
  }

  // ---------------------------------------------------------------- rendering
  function setInstruction(color, title, text) {
    $('instruction').className = 'instruction ' + color;
    $('ins-title').textContent = title;
    $('ins-text').textContent = text;
  }

  function setButtons(main, alt) {
    const m = $('main-btn'), a = $('alt-btn');
    m.textContent = main.label;
    m.className = 'primary big ' + (main.cls || '');
    m.disabled = !!main.disabled;
    m.onclick = main.run ? guarded(main.run) : null;
    a.hidden = !alt;
    if (alt) { a.textContent = alt.label; a.onclick = guarded(alt.run); }
  }

  function guarded(fn) {
    return async () => {
      if (busy) return;
      busy = true;
      $('align-error').hidden = true;
      try { await fn(); } catch (e) { showError('align-error', e.message); } finally { busy = false; }
      render();
    };
  }

  function showError(id, msg) { const el = $(id); el.textContent = T(msg); el.hidden = false; }

  function waitSeconds() {
    if (!S || !S.current || S.session.state !== 'WAIT_RF') return 0;
    return S.current.waitSeconds + Math.floor((Date.now() - lastSummaryAt) / 1000);
  }

  function render() {
    if (!S) return;
    const s = S, a = nextAction(s), cur = s.current;
    const act = (path, body) => async () => { apply(await api(`/api/sessions/${s.session.id}/${path}`, 'POST', body)); };
    const choose = (patch) => async () => { ui = { ...ui, ...patch }; store.set('ui', ui); };
    $('finish-box').hidden = true;
    $('report-box').hidden = a.kind !== 'done' && a.kind !== 'check';
    $('photo-label').hidden = a.kind === 'check';

    switch (a.kind) {
      case 'initialCall':
        setInstruction('blue', T('Apasă CALL pe contor'),
          T('Pune antena în poziția de start (felia 1). Confirmă abia când CALL apare pe afișajul contorului.'));
        setButtons({ label: T('CALL este pe afișaj'), run: act('call-confirmed', { phase: 'initial' }) });
        break;
      case 'wait': {
        const w = waitSeconds(), slow = w >= cfg.warnAfterS;
        setInstruction(slow ? 'red' : 'yellow', T('AȘTEAPTĂ – nu mișca antena'),
          slow ? T('Durează mai mult decât de obicei. Ține antena nemișcată sau sari peste această poziție.')
               : (S.current.nObs > 0 ? T('Am primit primele citiri. Mai aștept receptorul principal.')
                                     : T('Măsurătoarea vine de obicei în 20–40 de secunde.')));
        setButtons({ label: T('Aștept măsurătoarea… {0} s', w), cls: 'wait', disabled: true },
          slow ? { label: T('Sari peste această poziție'), run: act('skip') } : null);
        break;
      }
      case 'quickChoice':
        setInstruction('green', T('Semnal puternic: {0}', dbm(cur.bestRssi)),
          T('Poți confirma direct această poziție sau poți face rotația completă.'));
        setButtons({ label: T('Confirmă fără rotație'), cls: 'go', run: choose({ goFinal: true }) },
          { label: T('Fă rotația completă'), run: choose({ fullSweep: true }) });
        break;
      case 'move':
        if (a.phase === 'coarse') {
          const turn = cfg.coarseSteps === 4 ? T('un sfert de cerc') : cfg.coarseSteps === 6 ? T('o șesime de cerc') : T('1/{0} de cerc', cfg.coarseSteps);
          setInstruction('blue', T('Rotește la felia {0}', a.step),
            T('În sensul acelor de ceasornic, cam {0}. Apasă când antena stă nemișcată.', turn));
          setButtons({ label: T('Antena e pe felia {0}', a.step), run: act('position-marked', { phase: 'coarse', step: a.step, headingDeg: heading }) });
        } else {
          setInstruction('blue', FINE_MOVE[a.step - 1],
            `Mișcare mică, în interiorul feliei verzi (felia ${s.coarseWinner.step}). Apasă când antena stă nemișcată.`);
          setButtons({ label: 'Antena e în poziție', run: act('position-marked', { phase: 'fine', step: a.step, headingDeg: heading }) });
        }
        break;
      case 'coarseDone':
        setInstruction('green', T('REVINO LA FELIA VERDE'), T('Felia {0} · {1}', s.coarseWinner.step, dbm(s.coarseWinner.rssi)));
        setButtons({ label: T('Sunt pe felia verde – reglaj fin'), cls: 'go', run: act('position-marked', { phase: 'live', step: 1, headingDeg: heading }) },
          { label: T('Fără reglaj fin'), run: choose({ goFinal: true }) });
        break;
      case 'live':
        setInstruction('blue', T('Mișcă încet, câte puțin'),
          T('Rămâi în felia verde. După fiecare mișcare ține antena pe loc până vine citirea următoare (cam la {0} s). Dacă e mai slabă, întoarce-te.', s.live ? s.live.intervalS : 30));
        setButtons({ label: T('Am terminat – fixez antena aici'), cls: 'go', run: choose({ goFinal: true }) });
        break;
      case 'finalCall':
        setInstruction('green', T('Fixează antena pe poziția cea mai bună'),
          (s.live && s.live.bestRssi !== null
            ? T('Lasă antena acolo unde citirea a fost cea mai bună ({0}).', dbm(s.live.bestRssi))
            : T('{0} · {1}.', bestLabel(s) || T('Poziția curentă'), dbm(s.best && s.best.rssi))) +
          T(' Apoi apasă CALL pe contor și confirmă când apare pe afișaj.'));
        setButtons({ label: T('Antena e fixată, CALL e pe afișaj'), cls: 'go', run: act('call-confirmed', { phase: 'final' }) });
        break;
      case 'finish': {
        const f = s.finalCheck;
        if (f && f.rssi === null) {
          setInstruction('red', T('Receptorul principal nu a răspuns'),
            T('La confirmarea finală nu a mai fost auzit de {0}. Verifică dacă antena s-a mișcat la fixare.', s.primary.serial));
        } else if (f) {
          setInstruction(f.ok ? 'green' : 'red', T('Confirmare finală: {0}', dbm(f.rssi)),
            T('{0}{1} dB față de cea mai bună măsurătoare ({2}).', f.deltaDb >= 0 ? '+' : '', f.deltaDb, dbm(f.winnerRssi)) +
            (f.ok ? '' : T(' Verifică dacă antena s-a mișcat la fixare.')));
        } else {
          setInstruction('red', s.best ? T('Fără confirmare finală') : T('Nicio măsurătoare'),
            s.best ? T('Cea mai bună măsurătoare: {0} · {1}.', bestLabel(s), dbm(s.best.rssi)) : T('Contorul nu a fost auzit de niciun receptor propriu.'));
        }
        $('finish-box').hidden = false;
        const sel = $('outcome');
        if (!sel.options.length) {
          s.outcomes.filter((o) => o !== 'ABORTED').forEach((o) => sel.add(new Option(outcomeLabel(o), o)));
        }
        if (!sel.dataset.touched) sel.value = s.suggestedOutcome;
        setButtons({ label: T('Salvează rezultatul'), cls: 'go', run: async () => {   // values read at tap time
          apply(await api(`/api/sessions/${s.session.id}/complete`, 'POST', { outcome: sel.value, note: $('note').value || null }));
        } });
        break;
      }
      case 'check': {
        // Status without CALL: who hears this meter right now.
        const c = s.check, n = s.receivers.length, top = s.receivers[0];
        const seen = c.lastSeenUtc ? T('Auzit ultima dată {0} ({1}).', fmtTime(c.lastSeenUtc), ago(c.lastSeenUtc)) : T('Nu se știe când a fost auzit ultima dată.');
        const who = s.warnings.includes('REGISTRY_EMPTY') ? T('{0} receptoare îl aud; registrul nu este încărcat, deci nu se știe care sunt ale noastre.', n)
          : n === 1 ? T('1 receptor de-al nostru îl aude.') : T('{0} receptoare de-ale noastre îl aud.', n);
        setInstruction(!n ? 'red' : top.stale ? 'yellow' : 'green', T('Contor {0}', s.session.meterSerial), seen + ' ' + who);
        setButtons({ label: T('Actualizează'), run: async () => {
          apply(await api('/api/check', 'POST', { meterSerial: s.session.meterSerial, technician: s.session.technician, gps: s.session.gps.lat !== null ? s.session.gps : null }));
        } }, { label: T('Înapoi'), run: async () => { leaveSession(); } });
        break;
      }
      case 'done':
        setInstruction(s.session.outcome === 'ABORTED' ? 'red' : 'green', T('Sesiune salvată'),
          T('Contor {0}: {1}.', s.session.meterSerial, outcomeLabel(s.session.outcome)));
        setButtons({ label: T('Contor nou'), run: async () => { leaveSession(); } });
        break;
    }

    $('st-now').textContent = a.kind === 'live' && s.live && s.live.lastRssi !== null ? dbm(s.live.lastRssi)
      : cur && cur.measured ? dbm(cur.bestRssi) : '–';
    $('st-best').textContent = s.best ? dbm(s.best.rssi) : '–';
    if (a.kind === 'check' && s.best) $('st-now').textContent = dbm(s.best.rssi);
    $('st-recv').textContent = s.primary ? s.primary.serial : '–';
    $('restart-btn').hidden = a.kind === 'done' || a.kind === 'check';
    drawPizza(s, a);
    drawFine(s, a);
    drawLive(s, a);
    if (a.kind === 'check') document.querySelector('.pizza-wrap').hidden = true;
    drawReceivers(s);
    if (!$('view-map').hidden) drawMap();
    syncTimers();
  }

  function drawPizza(s, a) {
    const svg = $('pizza'), n = cfg.coarseSteps, ns = 'http://www.w3.org/2000/svg';
    svg.replaceChildren();
    const pt = (deg, r) => [r * Math.sin(deg * Math.PI / 180), -r * Math.cos(deg * Math.PI / 180)];
    const byStep = Object.fromEntries(s.coarse.map((c) => [c.step, c]));
    const cur = s.current;
    const target = a.kind === 'move' && a.phase === 'coarse' ? a.step : null;
    for (let k = 1; k <= n; k++) {
      const mid = (k - 1) * 360 / n, half = 180 / n;
      const [x0, y0] = pt(mid - half, 100), [x1, y1] = pt(mid + half, 100);
      const c = byStep[k];
      let cls = 'untested';
      if (c && c.measured) cls = 'measured';
      else if (c && c.skipped) cls = 'skipped';
      if (s.coarseWinner && s.coarseWinner.step === k) cls = 'best';
      const isCur = cur && cur.phase === 'coarse' && cur.step === k;
      if (isCur && s.session.state === 'WAIT_RF') cls = 'waiting';
      else if (isCur && cls !== 'best' && a.kind !== 'done') cls = 'current';
      if (target === k || (a.kind === 'initialCall' && k === 1)) cls = 'current';
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', `M0 0 L${x0.toFixed(2)} ${y0.toFixed(2)} A100 100 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`);
      path.setAttribute('class', 's-' + cls);
      svg.appendChild(path);
      const tcls = cls === 'untested' || cls === 'waiting' || cls === 'skipped' ? 't-dark' : 't-light';
      const [tx, ty] = pt(mid, 62);
      const num = document.createElementNS(ns, 'text');
      num.setAttribute('x', tx.toFixed(1)); num.setAttribute('y', (ty - 6).toFixed(1));
      num.setAttribute('class', tcls); num.textContent = k;
      svg.appendChild(num);
      const val = document.createElementNS(ns, 'text');
      val.setAttribute('x', tx.toFixed(1)); val.setAttribute('y', (ty + 9).toFixed(1));
      val.setAttribute('class', 'rssi ' + tcls);
      val.textContent = c && c.measured ? Math.round(c.bestRssi) : (c && c.skipped ? '—' : '');
      svg.appendChild(val);
    }
  }

  function drawFine(s, a) {
    const bar = $('fine-bar');
    const show = s.fine.length > 0 || (a.kind === 'move' && a.phase === 'fine');
    bar.hidden = !show;
    if (!show) return;
    bar.replaceChildren();
    const byStep = Object.fromEntries(s.fine.map((f) => [f.step, f]));
    const cur = s.current;
    for (let k = 1; k <= cfg.fineSteps; k++) {
      const f = byStep[k], el = document.createElement('div');
      let cls = f && f.measured ? 'measured' : '';
      if (s.best && s.best.phase === 'fine' && s.best.step === k) cls = 'best';
      const isCur = cur && cur.phase === 'fine' && cur.step === k;
      if (isCur && s.session.state === 'WAIT_RF') cls = 'waiting';
      if (a.kind === 'move' && a.phase === 'fine' && a.step === k) cls = 'current';
      el.className = cls;
      el.textContent = FINE_SHORT[k - 1];
      const b = document.createElement('b');
      b.textContent = f && f.measured ? Math.round(f.bestRssi) : '·';
      el.appendChild(b);
      bar.appendChild(el);
    }
  }

  // Live fine tune: one big number that changes each time the reference receiver reports.
  function drawLive(s, a) {
    const on = a.kind === 'live' && !!s.live;
    $('live-panel').hidden = !on;
    document.querySelector('.pizza-wrap').hidden = on;
    if (!on) return;
    const L = s.live, bars = $('live-bars'), trend = $('live-trend');
    $('live-rssi').textContent = L.lastRssi === null ? '–' : `${L.lastRssi} dBm`;
    const before = L.previousRssi !== null ? L.previousRssi : Math.round(L.referenceRssi);
    const d = L.lastRssi === null ? null : L.lastRssi - before;
    trend.className = d === null ? '' : d >= 2 ? 'up' : d <= -2 ? 'down' : '';
    trend.textContent = d === null ? '' : d >= 2 ? T('mai bine cu {0} dB', d) : d <= -2 ? T('mai slab cu {0} dB', -d) : T('la fel');
    bars.replaceChildren();
    const vals = L.readings.map((r) => r.rssi), lo = Math.min(...vals, L.referenceRssi) - 3, hi = Math.max(...vals, L.referenceRssi) + 1;
    L.readings.forEach((r, i) => {
      const el = document.createElement('i');
      el.style.height = Math.round(8 + 92 * (r.rssi - lo) / (hi - lo)) + '%';
      if (i === L.readings.length - 1) el.className = 'last';
      else if (r.rssi === L.bestRssi) el.className = 'best';
      bars.appendChild(el);
    });
    if (L.lastRssi === null) {
      $('live-age').textContent = T('Aștept prima citire de la {0}. La baleiaj: {1}.', L.serial, dbm(L.referenceRssi));
    } else {
      const age = L.ageSeconds + Math.floor((Date.now() - lastSummaryAt) / 1000), left = L.intervalS - age;
      $('live-age').textContent = T('Citire de acum {0} s · ', age) + (left > 0 ? T('următoarea în circa {0} s', left) : T('următoarea trebuie să apară'))
        + T(' · cea mai bună {0} · la baleiaj {1} · {2}', dbm(L.bestRssi), dbm(L.referenceRssi), L.serial);
    }
  }

  function drawReceivers(s) {
    const list = $('recv-list');
    list.replaceChildren();
    $('recv-empty').hidden = s.receivers.length > 0;
    // Only receivers from the loaded registry reach this list. They are shown per
    // site, because one site (mast, chimney) usually carries up to three of them.
    $('recv-warn').hidden = !s.warnings.includes('REGISTRY_EMPTY') || !s.receivers.length;
    const flat = s.warnings.includes('REGISTRY_EMPTY');   // no registry: no sites to group by
    const sitesSeen = new Map();
    for (const r of s.receivers) {
      const key = r.siteCode || '?' + r.serial;
      if (!sitesSeen.has(key)) sitesSeen.set(key, []);
      sitesSeen.get(key).push(r);
    }
    for (const group of sitesSeen.values()) {
      const first = group[0], head = document.createElement('li');
      head.className = 'site';
      const title = document.createElement('span');
      title.textContent = [first.siteName, first.address].filter(Boolean).join(', ') || T('site necunoscut în registru');
      const hsub = document.createElement('span');
      hsub.className = 'sub';
      hsub.textContent = (group.length === 1 ? T('1 concentrator a auzit contorul') : T('{0} concentratoare au auzit contorul', group.length))
        + (first.distanceM !== null ? T(' · {0} spre {1}', dist(first.distanceM), T(first.compass)) : '');
      head.append(title, document.createElement('span'), hsub);
      if (!flat) list.appendChild(head);
      for (const r of group) {
        const li = document.createElement('li');
        li.className = flat ? '' : 'child';
        li.setAttribute('role', 'button'); li.tabIndex = 0;
        const name = document.createElement('span');
        name.textContent = r.serial + ' ';
        const tag = document.createElement('span');
        tag.className = 'tag ' + r.relation; tag.textContent = T(RELATION_RO[r.relation]);
        name.appendChild(tag);
        const val = document.createElement('span');
        val.className = 'val'; val.textContent = dbm(r.bestRssi);
        const sub = document.createElement('span');
        sub.className = 'sub';
        sub.textContent = r.bestPhase === 'check' ? (r.observedUtc ? T('auzit {0}', ago(r.observedUtc)) + (r.stale ? ' · ' + T('nu a mai fost auzit de peste o zi') : '') : T('fără oră de la sursă'))
          : T('felii: {0} · cel mai bun pe felia {1}', r.sectors.join(', ') || '–', r.bestPhase === 'coarse' ? r.bestStep : (s.coarseWinner ? s.coarseWinner.step : '–'));
        li.append(name, val, sub);
        li.onclick = () => { selectedSerial = r.serial; showView('map'); };
        list.appendChild(li);
      }
    }
    const b = s.backup;
    $('backup-card').hidden = !b;
    if (b) {
      const kind = b.redundancy === 'DISTINCT_SITE' ? T('pe alt site (rezervă reală)') :
        b.redundancy === 'SAME_SITE' ? T('pe același site (doar rezervă de echipament)') : T('pe un site necunoscut');
      let t = T('Rezervă: {0} {1}, {2}', b.serial, kind, dbm(b.bestRssi));
      t += b.usable ? '.' : T(' – prea slab pentru a conta.');
      if (b.primaryDegradationDb !== null && b.primaryDegradationDb > 0) {
        t += b.positionRecommendable
          ? T(' Poziția ei cea mai bună costă doar {0} dB pe legătura principală.', b.primaryDegradationDb)
          : T(' Poziția ei cea mai bună ar slăbi legătura principală cu {0} dB – rămâi pe felia verde.', b.primaryDegradationDb);
      }
      $('backup-text').textContent = t;
    }
  }

  // ---------------------------------------------------------------- map
  /** One entry per site that heard the meter: its best concentrator, signal and distance. */
  function siteLinks(s) {
    const by = new Map();
    for (const r of s.receivers) {
      if (r.latitude === null) continue;
      const key = r.siteCode || r.serial, cur = by.get(key);
      if (!cur) {
        by.set(key, { key, lat: r.latitude, lon: r.longitude, name: r.siteName, address: r.address, distanceM: r.distanceM,
          best: r.bestRssi, serial: r.serial, count: 1, primary: r.relation === 'PRIMARY' });
      } else {
        cur.count++;
        if (r.relation === 'PRIMARY') cur.primary = true;
        if (r.bestRssi > cur.best) { cur.best = r.bestRssi; cur.serial = r.serial; }
      }
    }
    return [...by.values()].sort((x, y) => y.best - x.best);
  }
  // Colours follow the PROVISIONAL thresholds: good / marginal / weak.
  const linkColor = (rssi) => {
    const th = cfg.thresholds || { goodDbm: -95, marginalDbm: -110 };
    return rssi >= th.goodDbm ? '#1b8a3a' : rssi >= th.marginalDbm ? '#b26a00' : '#c62828';
  };
  const meters = (m) => Math.round(m).toLocaleString(lang === 'da' ? 'da-DK' : 'ro-RO') + ' m';
  const linkText = (l) => `${Math.round(l.best)} dBm` + (l.distanceM !== null ? ` · ${meters(l.distanceM)}` : '');
  let lastFit = '';

  function drawMap() {
    if (!ensureMap()) { $('map-info').textContent = T('Harta nu este disponibilă.'); return; }
    mapLayer.clearLayers();
    const g = S && S.session.gps.lat !== null ? S.session.gps : null;
    const links = S ? siteLinks(S) : [];
    const pts = [];
    links.forEach((l, i) => {
      const color = linkColor(l.best);
      if (g) {
        // meter -> site: signal and distance written on the line
        const line = L.polyline([[g.lat, g.lon], [l.lat, l.lon]], { color, weight: l.primary ? 6 : 3, dashArray: l.primary ? null : '8 8', opacity: 0.9 }).addTo(mapLayer);
        line.bindTooltip(linkText(l), { permanent: i < 6 || l.primary, direction: 'center', className: 'link-label' + (l.primary ? ' primary' : '') });
      }
      L.circleMarker([l.lat, l.lon], { radius: l.primary ? 10 : 7, color: '#fff', weight: 3, fillColor: color, fillOpacity: 1 })
        .bindTooltip(`${[l.name, l.address].filter(Boolean).join(', ') || l.serial} · ${linkText(l)}`).addTo(mapLayer);
      pts.push([l.lat, l.lon]);
    });
    if (g) {
      L.circleMarker([g.lat, g.lon], { radius: 9, color: '#fff', weight: 3, fillColor: '#1565c0', fillOpacity: 1 }).bindTooltip(T('Contor / telefon')).addTo(mapLayer);
      pts.push([g.lat, g.lon]);
    }
    let info = T('Harta explică doar geometria. Măsurătoarea radio rămâne decisivă.');
    if (links.length) {
      info = T('{0} site-uri au auzit contorul. Linia groasă este receptorul principal; verde = semnal bun, galben = la limită, roșu = slab.', links.length)
        + (g ? '' : ' ' + T('Alege poziția contorului la început ca să apară liniile și distanțele.'));
    } else if (S && S.warnings.includes('REGISTRY_EMPTY')) info = T('Încarcă registrul (site-uri și concentratoare) pe ecranul de start ca să apară concentratoarele pe hartă.');
    else if (!pts.length) info = T('Fără poziție GPS și fără receptoare cu coordonate. ') + info;
    $('map-info').textContent = info;
    const fit = pts.map((q) => q.join(',')).join(';');
    setTimeout(() => {
      map.invalidateSize();
      if (fit === lastFit) return;              // keep the installer's own pan and zoom
      lastFit = fit;
      if (pts.length > 1) map.fitBounds(pts, { padding: [50, 50] });
      else map.setView(pts[0] || [56, 10.5], pts.length ? 16 : 6);
    }, 0);
  }

  // ---------------------------------------------------------------- session plumbing
  function apply(summary) {
    const was = S ? S.session.state : null;
    S = summary; lastSummaryAt = Date.now();
    if (S.session.id) store.set('session', S.session.id);   // a status check is not a stored session
    if (was === 'WAIT_RF' && S.session.state === 'MEASURED' && navigator.vibrate) navigator.vibrate(200);
  }

  function syncTimers() {
    const active = S && S.session.status === 'ACTIVE' && S.session.state !== 'READY';
    if (active && !pollTimer) {
      pollTimer = setInterval(poll, cfg.pollIntervalS * 1000);
      tickTimer = setInterval(() => { if (S && !busy && (S.session.state === 'WAIT_RF' || (S.current && S.current.phase === 'live'))) render(); }, 1000);
    } else if (!active && pollTimer) {
      clearInterval(pollTimer); clearInterval(tickTimer); pollTimer = tickTimer = null;
    }
  }

  async function poll() {
    if (busy || !S || document.hidden) return;
    try {
      const r = await api(`/api/sessions/${S.session.id}/poll`);
      if (busy) return;           // an action finished meanwhile; its summary is newer
      apply(r.summary);
      $('align-error').hidden = true;
      if (r.warning && r.warning.startsWith('UPSTREAM_ERROR')) showError('align-error', T('Serviciul Kamstrup nu răspunde. Reîncerc automat.'));
      render();
    } catch (e) {
      if (e.status === 409 || e.status === 404) { try { apply(await api(`/api/sessions/${S.session.id}`)); render(); } catch { /* offline */ } }
      else showError('align-error', e.message);
    }
  }

  function showView(name) {
    for (const v of ['pair', 'start', 'align', 'recv', 'map']) $('view-' + v).hidden = v !== name;
    $('tabs').hidden = name === 'start' || name === 'pair' || picking;
    $('pick-bar').hidden = !(picking && name === 'map');
    $('map-info').hidden = picking;
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === name));
    if (name === 'map') { if (picking) drawPickMap(); else drawMap(); }
  }

  function enterSession(summary) {
    apply(summary);
    ui = store.get('ui', {}) || {};
    if (ui.sid !== S.session.id) { ui = { sid: S.session.id }; store.set('ui', ui); }
    $('outcome').replaceChildren(); delete $('outcome').dataset.touched; $('note').value = '';
    showView('align');
    render();
    if (navigator.wakeLock) navigator.wakeLock.request('screen').then((w) => { wakeLock = w; }).catch(() => {});
  }

  function leaveSession() {
    S = null; ui = {}; selectedSerial = null;
    store.del('session'); store.del('ui');
    if (pollTimer) { clearInterval(pollTimer); clearInterval(tickTimer); pollTimer = tickTimer = null; }
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    $('meter').value = '';
    $('scan-info').hidden = true; $('scan-chips').hidden = true;
    $('report-msg').hidden = true; $('report-preview').hidden = true; lastPhoto = null;
    refreshData();
    showView('start');
  }

  // ---------------------------------------------------------------- start screen
  async function showCandidates() {
    try {
      const sites = (await api(`/api/sites?lat=${gps.lat}&lon=${gps.lon}`)).filter((x) => x.rankingEligible && x.distanceM !== null).slice(0, 3);
      const ul = $('candidate-list');
      ul.replaceChildren();
      for (const x of sites) {
        const li = document.createElement('li');
        const n = document.createElement('span'); n.textContent = x.name || x.siteCode;
        const v = document.createElement('span'); v.className = 'val'; v.textContent = dist(x.distanceM);
        const sub = document.createElement('span'); sub.className = 'sub';
        sub.textContent = T('{0} · direcția {1}° ({2})', x.address || '', x.bearingDeg, T(x.compass));
        li.append(n, v, sub); ul.appendChild(li);
      }
      $('candidates').hidden = sites.length === 0;
    } catch { /* candidates are optional */ }
  }

  $('gps-btn').onclick = () => {
    if (!navigator.geolocation || !window.isSecureContext) {
      $('gps-info').textContent = T('GPS-ul telefonului cere o adresă sigură (HTTPS sau localhost). Folosește „Alege pe hartă”.');
      return;
    }
    $('gps-info').textContent = T('Caut poziția…');
    navigator.geolocation.getCurrentPosition((p) => {
      gps = { lat: p.coords.latitude, lon: p.coords.longitude, accuracyM: Math.round(p.coords.accuracy) };
      $('gps-info').textContent = T('Poziție GPS luată, precizie ±{0} m.', gps.accuracyM);
      showCandidates();
    }, (err) => {
      $('gps-info').textContent = T('Nu am putut lua poziția ({0}). Folosește „Alege pe hartă” sau continuă fără.', err.message);
    }, { enableHighAccuracy: true, timeout: 15000 });
  };

  // ---- position without GPS: tap the map, or paste coordinates
  let picking = false, picked = null, pickMarker = null;
  function ensureMap() {
    if (map || !window.L) return !!map;
    map = L.map('map', { zoomControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
    mapLayer = L.layerGroup().addTo(map);
    map.on('click', (e) => { if (picking) setPick(e.latlng.lat, e.latlng.lng, false); });
    return true;
  }
  function setPick(lat, lon, recenter) {
    picked = { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6 };
    if (pickMarker) pickMarker.remove();
    pickMarker = L.circleMarker([lat, lon], { radius: 10, color: '#fff', weight: 3, fillColor: '#1565c0', fillOpacity: 1 }).addTo(map);
    if (recenter) map.setView([lat, lon], Math.max(map.getZoom() || 0, 17));
    $('pick-info').textContent = T('Poziție aleasă: {0}, {1}', picked.lat.toFixed(5), picked.lon.toFixed(5));
    $('pick-ok').disabled = false;
  }
  async function drawPickMap() {
    if (!ensureMap()) { $('pick-info').textContent = T('Harta nu este disponibilă.'); return; }
    mapLayer.clearLayers();
    let sites = [];
    try { sites = (await api('/api/sites')).filter((x) => x.latitude !== null); } catch { /* map still usable */ }
    for (const x of sites) {
      L.circleMarker([x.latitude, x.longitude], { radius: 7, color: '#fff', weight: 3, fillColor: '#55626b', fillOpacity: 1 })
        .bindTooltip(x.name || x.siteCode).addTo(mapLayer);
    }
    setTimeout(() => {
      map.invalidateSize();
      const last = gps || store.get('lastPos');
      if (last) map.setView([last.lat, last.lon], 17);
      else if (sites.length > 1) map.fitBounds(sites.map((x) => [x.latitude, x.longitude]), { padding: [40, 40] });
      else if (sites.length) map.setView([sites[0].latitude, sites[0].longitude], 14);
      else map.setView([56, 10.5], 7);
      if (gps) setPick(gps.lat, gps.lon, false);
    }, 0);
  }
  function endPick() {
    picking = false;
    if (pickMarker) { pickMarker.remove(); pickMarker = null; }
    showView('start');
  }
  $('pick-btn').onclick = () => { picking = true; picked = null; $('pick-ok').disabled = true; $('pick-info').textContent = T('Nicio poziție aleasă.'); showView('map'); };
  $('pick-cancel').onclick = endPick;
  $('pick-ok').onclick = () => {
    gps = { lat: picked.lat, lon: picked.lon, accuracyM: null };
    store.set('lastPos', picked);
    $('gps-info').textContent = T('Poziție aleasă pe hartă: {0}, {1}.', picked.lat.toFixed(5), picked.lon.toFixed(5));
    endPick();
    showCandidates();
  };
  $('pick-coords').onchange = (ev) => {
    // "56.1234, 10.1234", "56,1234 10,1234" or a pasted maps link containing lat,lon
    const t = ev.target.value.trim();
    let m = t.match(/(-?\d{1,2}\.\d{3,})[^\d-]+(-?\d{1,3}\.\d{3,})/);
    if (!m) {                                           // decimal commas
      const c = t.match(/(-?\d{1,2}),(\d{3,})[^\d-]+(-?\d{1,3}),(\d{3,})/);
      if (c) m = [t, `${c[1]}.${c[2]}`, `${c[3]}.${c[4]}`];
    }
    if (!m || Math.abs(+m[1]) > 90 || Math.abs(+m[2]) > 180) { $('pick-info').textContent = T('Nu am recunoscut coordonatele. Exemplu: 56.1234, 10.1234'); return; }
    if (ensureMap()) setPick(+m[1], +m[2], true);
  };

  $('start-form').onsubmit = async (ev) => {
    ev.preventDefault();
    $('start-error').hidden = true;
    store.set('tech', $('tech').value.trim());
    try {
      enterSession(await api('/api/sessions', 'POST', { meterSerial: $('meter').value.trim(), technician: $('tech').value.trim(), gps }));
    } catch (e) { showError('start-error', e.message); }
  };

  $('check-btn').onclick = async () => {
    $('start-error').hidden = true;
    const meter = $('meter').value.trim();
    if (!meter) { showError('start-error', 'Introdu sau scanează seria contorului.'); return; }
    try { enterSession(await api('/api/check', 'POST', { meterSerial: meter, technician: $('tech').value.trim(), gps })); }
    catch (e) { showError('start-error', e.status === 404 ? 'Verificarea fără CALL există doar în varianta fără server.' : e.message); }
  };

  // ---------------------------------------------------------------- camera scanning
  // Native BarcodeDetector where the browser has it (Chrome on Android); jsQR otherwise.
  const scanner = (() => {
    let stream = null, timer = null, onResult = null, detector = null, canvas = null;
    const loadScript = (src) => new Promise((ok, fail) => {
      const el = document.createElement('script');
      el.src = src; el.onload = ok; el.onerror = () => fail(new Error(T('Nu am putut încărca cititorul de coduri.')));
      document.head.appendChild(el);
    });
    async function open(title, cb) {
      onResult = cb;
      $('scan-title').textContent = title;
      $('scan-error').hidden = true;
      $('scanner').hidden = false;
      try {
        if (!window.isSecureContext || !navigator.mediaDevices) throw new Error(T('Camera live cere o adresă sigură (HTTPS sau localhost). Apasă „Fotografiază codul”.'));
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
        const v = $('scan-video');
        v.srcObject = stream;
        await v.play();
        if (!detector && 'BarcodeDetector' in window) {
          try {
            const have = await BarcodeDetector.getSupportedFormats();
            const formats = ['qr_code', 'data_matrix', 'code_128', 'code_39', 'ean_13'].filter((f) => have.includes(f));
            if (formats.includes('qr_code')) detector = new BarcodeDetector({ formats });
          } catch { /* fall back to jsQR */ }
        }
        if (!detector && !window.jsQR) await loadScript('vendor/jsQR.js');
        loop();
      } catch (e) {
        showError('scan-error', e.name === 'NotAllowedError' ? T('Permite accesul la cameră din setările browserului.') : e.message);
      }
    }
    async function loop() {
      if (!stream) return;
      const v = $('scan-video');
      let text = null;
      if (v.readyState >= 2 && v.videoWidth) {
        try {
          if (detector) {
            const found = await detector.detect(v);
            if (found.length) text = found[0].rawValue;
          } else {
            canvas = canvas || document.createElement('canvas');
            const k = Math.min(1, 800 / v.videoWidth);
            canvas.width = Math.round(v.videoWidth * k); canvas.height = Math.round(v.videoHeight * k);
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const hit = window.jsQR(img.data, img.width, img.height);
            if (hit && hit.data) text = hit.data;
          }
        } catch { /* try the next frame */ }
      }
      if (text && stream) {
        const cb = onResult;
        close();
        if (navigator.vibrate) navigator.vibrate(80);
        cb(text.trim());
        return;
      }
      timer = setTimeout(loop, 180);
    }
    function close() {
      clearTimeout(timer);
      if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
      $('scan-video').srcObject = null;
      $('scanner').hidden = true;
    }
    // Works everywhere, also when the page is opened as a file: the phone's own
    // camera app takes a photo and the code is read from the picture.
    async function decodePhoto(file) {
      const bmp = await createImageBitmap(file);
      if (!window.jsQR) await loadScript('vendor/jsQR.js');
      const c = document.createElement('canvas'), ctx = c.getContext('2d', { willReadFrequently: true });
      const W = bmp.width, H = bmp.height;
      if ('BarcodeDetector' in window) {
        try {
          const found = await new BarcodeDetector({ formats: ['qr_code'] }).detect(bmp);
          if (found.length) return found[0].rawValue;
        } catch { /* fall through to jsQR */ }
      }
      // The code is often small in a large photo: try the whole picture at rising
      // sizes, then overlapping windows at full detail.
      const tries = [[0, 0, W, H, 1000], [0, 0, W, H, 1800]];
      for (const n of [2, 3, 4]) {
        const w = W / n * 1.3, h = H / n * 1.3;
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
          tries.push([Math.min(W - w, i * W / n), Math.min(H - h, j * H / n), w, h, 1400]);
        }
      }
      for (const [sx, sy, sw, sh, max] of tries) {
        const k = Math.min(1, max / Math.max(sw, sh));
        c.width = Math.round(sw * k); c.height = Math.round(sh * k);
        ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
        const img = ctx.getImageData(0, 0, c.width, c.height);
        const hit = window.jsQR(img.data, img.width, img.height);
        if (hit && hit.data) return hit.data;
      }
      return null;
    }
    $('scan-photo-btn').onclick = () => $('scan-photo').click();
    $('scan-photo').onchange = async (ev) => {
      const file = ev.target.files[0];
      ev.target.value = '';
      if (!file) return;
      try {
        const text = await decodePhoto(file);
        if (!text) { showError('scan-error', T('Nu am găsit un cod QR în fotografie. Apropie-te, ține telefonul drept și încearcă din nou.')); return; }
        const cb = onResult;
        close();
        cb(text.trim());
      } catch (e) { showError('scan-error', T('Nu am putut citi fotografia: {0}', e.message)); }
    };
    return { open, close };
  })();
  $('scan-close').onclick = () => scanner.close();

  // The exact content of the meter's QR code is not known yet, so: accept a bare
  // serial, otherwise offer every 6-12 digit group found in the text.
  function serialCandidates(text) {
    if (/^[0-9A-Za-z]{4,20}$/.test(text)) return [text];
    return [...new Set(text.match(/\d{6,12}/g) || [])];
  }

  $('scan-btn').onclick = () => scanner.open(T('Îndreaptă camera spre codul QR al contorului'), (text) => {
    const found = serialCandidates(text), info = $('scan-info'), chips = $('scan-chips');
    chips.replaceChildren();
    chips.hidden = found.length < 2;
    info.hidden = false;
    const shown = text.length > 80 ? text.slice(0, 80) + '…' : text;
    if (found.length === 1) {
      $('meter').value = found[0];
      info.textContent = found[0] === text ? T('Serie citită din cod.') : T('Serie citită din codul: {0}', shown);
    } else if (found.length > 1) {
      info.textContent = T('Codul conține mai multe numere. Alege seria contorului: {0}', shown);
      for (const f of found) {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = f;
        b.onclick = () => { $('meter').value = f; chips.hidden = true; info.textContent = T('Serie aleasă din cod.'); };
        chips.appendChild(b);
      }
    } else {
      info.textContent = T('Codul nu conține o serie de contor: {0}', shown);
    }
  });

  // ---------------------------------------------------------------- pairing
  async function pair(code) {
    $('pair-error').hidden = true;
    store.set('token', code);
    try {
      const me = await api('/api/me');
      store.set('tech', me.technician);
      showStart(me.technician);
    } catch (e) {
      store.del('token');
      showView('pair');
      showError('pair-error', e.status === 401 ? T('Cod de cuplare invalid sau retras.') : e.message);
    }
  }

  function showStart(pairedName) {
    if (pairedName) {
      $('tech').value = pairedName; $('tech').readOnly = true;
      $('paired-text').textContent = T('Telefon cuplat ca {0}.', pairedName);
    }
    $('paired').hidden = !pairedName;
    showView('start');
  }

  function pairFromText(text) {
    const m = text.match(/#pair=([\w-]{8,})/) || text.match(/^([\w-]{16,})$/);
    if (!m) { showError('pair-error', T('Acesta nu este un cod de cuplare.')); return; }
    let host = null;
    try { host = new URL(text).origin; } catch { /* bare code */ }
    if (host && host !== location.origin) {
      showError('pair-error', T('Codul este pentru altă adresă ({0}). Deschide linkul din cod în browser.', host));
      return;
    }
    pair(m[1]);
  }
  $('pair-scan-btn').onclick = () => scanner.open(T('Îndreaptă camera spre codul de cuplare'), pairFromText);
  $('pair-form').onsubmit = (ev) => { ev.preventDefault(); pairFromText($('pair-code').value.trim()); };
  $('unpair-btn').onclick = () => { store.del('token'); store.del('tech'); $('tech').value = ''; $('tech').readOnly = false; showView('pair'); };

  $('outcome').onchange = () => { $('outcome').dataset.touched = '1'; };

  $('restart-btn').onclick = async () => {
    if (!armedRestart) {           // two taps instead of a blocking dialog
      armedRestart = true;
      $('restart-btn').textContent = T('Apasă din nou ca să renunți');
      setTimeout(() => { armedRestart = false; $('restart-btn').textContent = T('Renunță și ia-o de la capăt'); }, 4000);
      return;
    }
    armedRestart = false;
    $('restart-btn').textContent = T('Renunță și ia-o de la capăt');
    try { if (S && S.session.status === 'ACTIVE') await api(`/api/sessions/${S.session.id}/complete`, 'POST', { outcome: 'ABORTED' }); } catch { /* keep going */ }
    leaveSession();
  };

  $('lang-btn').onclick = () => {
    lang = lang === 'da' ? 'ro' : 'da';
    store.set('lang', lang);
    translatePage(); refreshData(); render();
  };
  document.querySelectorAll('#tabs button').forEach((b) => { b.onclick = () => showView(b.dataset.view); });
  window.addEventListener('hashchange', () => { if (location.hash.startsWith('#pair=')) location.reload(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S) poll(); });
  window.addEventListener('deviceorientationabsolute', (e) => {
    if (e.alpha !== null) heading = Math.round((360 - e.alpha) % 360);
  });

  // ---------------------------------------------------------------- standalone mode
  // No LinkIQ server (static hosting, or the page opened as a file): the browser
  // calls Kamstrup directly and keeps registry and sessions on this device.
  async function serverAnswers() {
    if (location.protocol === 'file:') return false;
    try {
      const ctl = new AbortController();
      setTimeout(() => ctl.abort(), 3000);
      const r = await fetch('api/config', { signal: ctl.signal, cache: 'no-store' });
      return r.ok && !!(await r.json()).coarseSteps;
    } catch { return false; }
  }

  async function deviceStorage() {
    // IndexedDB: room for hundreds of sessions. localStorage is the fallback.
    try {
      const db = await new Promise((ok, fail) => {
        const r = indexedDB.open('linkiq', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error);
      });
      const initial = await new Promise((ok, fail) => {
        const r = db.transaction('kv').objectStore('kv').get('db');
        r.onsuccess = () => ok(r.result || null); r.onerror = () => fail(r.error);
      });
      return { get: () => initial, set: (k, v) => { try { db.transaction('kv', 'readwrite').objectStore('kv').put(v, 'db'); } catch { /* keep running in memory */ } } };
    } catch {
      return { get: () => store.get('db'), set: (k, v) => store.set('db', v) };
    }
  }

  async function startStandalone() {
    engine = new LinkIQEngine.Engine({
      storage: await deviceStorage(),
      settings: store.get('settings', {}) || {},          // optional overrides, e.g. thresholds
      fetchJson: async (url) => {
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      },
    });
    $('data-card').hidden = false;
    $('demo-toggle').checked = engine.demo;
    refreshData();
  }

  function refreshData() {
    if (!engine) return;
    const r = engine.registryInfo();
    $('reg-info').textContent = r.concentrators
      ? T('Registru: {0} site-uri, {1} concentratoare', r.sites, r.concentrators) + (r.review ? T(', {0} fără site sigur.', r.review) : '.')
      : T('Registrul nu este încărcat: toate receptoarele auzite sunt tratate ca proprii, iar harta nu are site-uri.');
    const n = engine.sessionCount();
    $('sess-info').textContent = T('{0} {1} pe acest dispozitiv. Datele nu pleacă nicăieri până nu le exporți.', n, n === 1 ? T('sesiune salvată') : T('sesiuni salvate'));
    $('mode').hidden = !engine.demo;
    cfg.kamstrupMode = engine.demo ? 'sim' : 'live';
  }

  async function readCsvFile(file) {
    const buf = await file.arrayBuffer();
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch { return new TextDecoder('windows-1252').decode(buf); }   // CSV saved by Excel
  }
  for (const [id, fn] of [['sites-file', 'importSites'], ['conc-file', 'importConcentrators']]) {
    $(id).onchange = async (ev) => {
      const file = ev.target.files[0], msg = $('reg-msg');
      if (!file) return;
      try {
        const r = engine[fn](await readCsvFile(file));
        msg.textContent = r.imported ? T('{0}: {1} rânduri încărcate', file.name, r.imported) + (r.review ? T(', {0} de verificat.', r.review) : '.')
          : T('{0}: nu am găsit rânduri valide. Verifică denumirile coloanelor.', file.name);
      } catch (e) { msg.textContent = `${file.name}: ${e.message}`; }
      msg.hidden = false;
      ev.target.value = '';
      refreshData();
    };
  }
  $('reg-clear').onclick = () => { engine.clearRegistry(); $('reg-msg').hidden = true; refreshData(); };
  $('demo-toggle').onchange = (ev) => { engine.setDemo(ev.target.checked); refreshData(); };
  $('export-btn').onclick = () => {
    const blob = new Blob(['\uFEFF' + engine.exportCsv()], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `linkiq-masuratori-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  // ---------------------------------------------------------------- report
  // At the end of a session: a report image named after the meter serial, and a
  // photo of the antenna with the measurement stamped on it. Both are drawn on a
  // canvas and saved through the browser's normal download.
  const INK = { navy: '#0b2a3c', blue: '#1565c0', green: '#1b8a3a', gray: '#55626b', light: '#dfe5e9', red: '#c62828', ink: '#0b1f2a', yellow: '#f9c400', amber: '#b26a00' };
  const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const fmtTime = (utc) => (utc ? new Date(utc).toLocaleString(lang === 'da' ? 'da-DK' : 'ro-RO', { dateStyle: 'medium', timeStyle: 'short' }) : '–');
  const outcomeColor = (o) => (/^(OPTIMAL|GOOD)/.test(o || '') ? INK.green : o === 'MARGINAL' ? INK.amber : INK.red);
  const safeName = (serial) => String(serial).replace(/[^0-9A-Za-z_-]/g, '');

  function pizzaOnCanvas(x, s, cx, cy, r) {
    const n = Math.max(cfg.coarseSteps, ...s.coarse.map((c) => c.step));
    const by = Object.fromEntries(s.coarse.map((c) => [c.step, c]));
    for (let k = 1; k <= n; k++) {
      const mid = (k - 1) * 2 * Math.PI / n - Math.PI / 2, half = Math.PI / n, c = by[k];
      const win = !!(s.coarseWinner && s.coarseWinner.step === k), measured = !!(c && c.measured);
      x.beginPath(); x.moveTo(cx, cy); x.arc(cx, cy, r, mid - half, mid + half); x.closePath();
      x.fillStyle = win ? INK.green : measured ? INK.gray : INK.light; x.fill();
      x.lineWidth = Math.max(2, r / 40); x.strokeStyle = '#fff'; x.stroke();
      const tx = cx + Math.cos(mid) * r * 0.62, ty = cy + Math.sin(mid) * r * 0.62;
      x.fillStyle = win || measured ? '#fff' : INK.ink; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.font = `700 ${Math.round(r * 0.2)}px ${SANS}`; x.fillText(String(k), tx, ty - r * 0.09);
      x.font = `600 ${Math.round(r * 0.14)}px ${SANS}`; x.fillText(measured ? String(Math.round(c.bestRssi)) : '–', tx, ty + r * 0.12);
    }
  }

  /** Map for the report: OpenStreetMap background when it loads, plain grid otherwise. */
  async function reportMap(s, W, H, useTiles = true) {
    const g = s.session.gps, links = siteLinks(s);
    if (!g || g.lat === null || !links.length) return null;
    const merc = (lat, lon, z) => {
      const n = 256 * 2 ** z, sl = Math.sin(lat * Math.PI / 180);
      return [(lon + 180) / 360 * n, (0.5 - Math.log((1 + sl) / (1 - sl)) / (4 * Math.PI)) * n];
    };
    const pts = [[g.lat, g.lon], ...links.map((l) => [l.lat, l.lon])];
    let z = 17, box;
    for (; z >= 4; z--) {
      const q = pts.map((p) => merc(p[0], p[1], z));
      box = [Math.min(...q.map((v) => v[0])), Math.min(...q.map((v) => v[1])), Math.max(...q.map((v) => v[0])), Math.max(...q.map((v) => v[1]))];
      if (box[2] - box[0] <= W - 260 && box[3] - box[1] <= H - 170) break;
    }
    const ox = (box[0] + box[2]) / 2 - W / 2, oy = (box[1] + box[3]) / 2 - H / 2;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.fillStyle = '#eef2f4'; x.fillRect(0, 0, W, H);
    let tiles = false;
    if (useTiles) {
      try {
        const jobs = [];
        for (let tx = Math.floor(ox / 256); tx <= Math.floor((ox + W) / 256); tx++) {
          for (let ty = Math.floor(oy / 256); ty <= Math.floor((oy + H) / 256); ty++) {
            jobs.push(new Promise((ok, fail) => {
              const img = new Image();
              img.crossOrigin = 'anonymous';
              img.onload = () => ok({ img, tx, ty }); img.onerror = () => fail(new Error('tile'));
              img.src = `https://tile.openstreetmap.org/${z}/${tx}/${ty}.png`;
            }));
          }
        }
        const got = await Promise.race([Promise.all(jobs), new Promise((_, fail) => setTimeout(() => fail(new Error('timeout')), 6000))]);
        for (const t of got) x.drawImage(t.img, Math.round(t.tx * 256 - ox), Math.round(t.ty * 256 - oy));
        x.fillStyle = 'rgba(255,255,255,0.45)'; x.fillRect(0, 0, W, H);
        x.getImageData(0, 0, 1, 1);               // throws if the tiles may not be exported
        tiles = true;
      } catch { return reportMap(s, W, H, false); }
    }
    if (!tiles) {
      x.strokeStyle = '#d5dde2'; x.lineWidth = 1;
      for (let v = 0; v < W; v += 80) { x.beginPath(); x.moveTo(v, 0); x.lineTo(v, H); x.stroke(); }
      for (let v = 0; v < H; v += 80) { x.beginPath(); x.moveTo(0, v); x.lineTo(W, v); x.stroke(); }
    }
    const P = (lat, lon) => { const m = merc(lat, lon, z); return [m[0] - ox, m[1] - oy]; };
    const [mx, my] = P(g.lat, g.lon);
    const boxed = (str, bx, by, color, bold) => {
      x.font = `${bold ? 700 : 600} 21px ${SANS}`;
      const w = x.measureText(str).width + 16;
      const lx = Math.max(4, Math.min(W - w - 4, bx - w / 2)), ly = Math.max(4, Math.min(H - 34, by - 15));
      x.fillStyle = '#fff'; x.strokeStyle = color; x.lineWidth = 2;
      x.beginPath(); x.roundRect(lx, ly, w, 30, 6); x.fill(); x.stroke();
      x.fillStyle = INK.ink; x.textAlign = 'left'; x.textBaseline = 'middle'; x.fillText(str, lx + 8, ly + 16);
    };
    [...links].reverse().forEach((l) => {          // weakest first, so the strong links stay on top
      const [sx, sy] = P(l.lat, l.lon), color = linkColor(l.best);
      x.strokeStyle = color; x.lineWidth = l.primary ? 7 : 3; x.setLineDash(l.primary ? [] : [12, 9]);
      x.beginPath(); x.moveTo(mx, my); x.lineTo(sx, sy); x.stroke(); x.setLineDash([]);
      x.fillStyle = color; x.strokeStyle = '#fff'; x.lineWidth = 3;
      x.beginPath(); x.arc(sx, sy, l.primary ? 12 : 9, 0, 2 * Math.PI); x.fill(); x.stroke();
    });
    links.forEach((l, i) => {
      if (i >= 8 && !l.primary) return;
      const [sx, sy] = P(l.lat, l.lon);
      boxed(linkText(l), mx + (sx - mx) * 0.62, my + (sy - my) * 0.62, linkColor(l.best), l.primary);
      x.font = `600 18px ${SANS}`; x.fillStyle = INK.ink; x.textAlign = 'center'; x.textBaseline = 'top';
      x.lineWidth = 4; x.strokeStyle = 'rgba(255,255,255,0.9)';
      const nm = (l.name || (l.address || '').split(',')[0] || l.serial).slice(0, 26);
      x.strokeText(nm, sx, sy + 15); x.fillText(nm, sx, sy + 15);
    });
    x.fillStyle = INK.blue; x.strokeStyle = '#fff'; x.lineWidth = 4;
    x.beginPath(); x.arc(mx, my, 12, 0, 2 * Math.PI); x.fill(); x.stroke();
    x.font = `700 19px ${SANS}`; x.textAlign = 'center'; x.textBaseline = 'bottom'; x.lineWidth = 4; x.strokeStyle = 'rgba(255,255,255,0.9)';
    x.strokeText(T('Contor'), mx, my - 15); x.fillStyle = INK.ink; x.fillText(T('Contor'), mx, my - 15);
    // legend, scale, north, attribution
    const legend = [[linkColor(-50), T('bun')], [linkColor(-100), T('la limită')], [linkColor(-130), T('slab')]];
    x.font = `600 17px ${SANS}`; x.textBaseline = 'middle'; x.textAlign = 'left';
    let lx = 14;
    x.fillStyle = 'rgba(255,255,255,0.88)'; x.fillRect(6, H - 38, 470, 32);
    for (const [col, name] of legend) { x.fillStyle = col; x.fillRect(lx, H - 27, 26, 9); x.fillStyle = INK.ink; x.fillText(name, lx + 32, H - 22); lx += 44 + x.measureText(name).width; }
    x.fillStyle = INK.ink; x.fillRect(lx, H - 29, 26, 13); x.fillText('= ' + T('receptor principal'), lx + 32, H - 22);
    const mpp = 156543.03392 * Math.cos(g.lat * Math.PI / 180) / 2 ** z;
    const nice = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].find((v) => v / mpp >= 90) || 50000;
    x.fillStyle = 'rgba(255,255,255,0.88)'; x.fillRect(W - nice / mpp - 30, 8, nice / mpp + 22, 38);
    x.fillStyle = INK.ink; x.fillRect(W - nice / mpp - 18, 34, nice / mpp, 4);
    x.textAlign = 'right'; x.fillText(meters(nice) + '   N ↑', W - 18, 22);
    if (tiles) { x.font = `400 14px ${SANS}`; x.fillStyle = 'rgba(255,255,255,0.85)'; x.fillRect(W - 150, H - 22, 150, 22); x.fillStyle = INK.ink; x.fillText('© OpenStreetMap', W - 6, H - 11); }
    return c;
  }

  async function buildReport(s) {
    const W = 1080, P = 56, big = document.createElement('canvas');
    big.width = W; big.height = 4400;
    const x = big.getContext('2d');
    let y = 0;
    const font = (weight, px) => { x.font = `${weight} ${px}px ${SANS}`; };
    const text = (str, tx, ty, color = INK.ink, align = 'left') => { x.fillStyle = color; x.textAlign = align; x.textBaseline = 'alphabetic'; x.fillText(str, tx, ty); };
    const wrap = (str, maxW) => {
      const out = []; let line = '';
      for (const w of String(str).split(/\s+/)) {
        const t = line ? line + ' ' + w : w;
        if (x.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t;
      }
      if (line) out.push(line);
      return out;
    };
    const section = (title) => { y += 36; x.fillStyle = INK.light; x.fillRect(P, y, W - 2 * P, 2); y += 50; font(700, 30); text(title, P, y, INK.navy); y += 10; };
    const row = (label, value, color = INK.ink) => {
      y += 44; font(500, 25); text(label, P, y, INK.gray);
      font(600, 27);
      wrap(value, W - 2 * P - 300).forEach((l, i) => { if (i) y += 36; text(l, P + 300, y, color); });
    };

    x.fillStyle = '#fff'; x.fillRect(0, 0, W, big.height);
    x.fillStyle = INK.navy; x.fillRect(0, 0, W, 150);
    font(700, 40); text('LinkIQ Field Assistant', P, 68, '#fff');
    const isCheck = s.session.status === 'CHECK';
    font(500, 28); text(T(isCheck ? 'Raport de stare, fără CALL' : 'Raport de punere în funcțiune'), P, 114, '#cfe0ea');
    y = 150;
    if (s.session.demo) {
      x.fillStyle = INK.yellow; x.fillRect(0, y, W, 56);
      font(700, 26); text(T('DEMONSTRAȚIE – nu este o măsurătoare reală'), P, y + 37);
      y += 56;
    }
    y += 56; font(500, 25); text(T('Contor'), P, y, INK.gray);
    y += 68; font(800, 68); text(s.session.meterSerial, P, y);
    if (!isCheck) {
      const label = outcomeLabel(s.session.outcome || s.suggestedOutcome);
      font(700, 28);
      const pw = x.measureText(label).width + 44;
      x.fillStyle = outcomeColor(s.session.outcome || s.suggestedOutcome);
      x.beginPath(); x.roundRect(W - P - pw, y - 50, pw, 58, 29); x.fill();
      text(label, W - P - pw / 2, y - 11, '#fff', 'center');
    }
    y += 10;
    row(T('Data'), fmtTime(s.session.finishedUtc || s.session.startedUtc));
    row(T('Instalator'), s.session.technician);
    const g = s.session.gps;
    row(T('Poziție'), g && g.lat !== null ? `${g.lat.toFixed(5)}, ${g.lon.toFixed(5)}` + (g.accuracyM ? ` (±${g.accuracyM} m)` : '') : T('neînregistrată'));
    if (isCheck) row(T('Auzit ultima dată'), s.check.lastSeenUtc ? `${fmtTime(s.check.lastSeenUtc)} (${ago(s.check.lastSeenUtc)})` : '–');

    const mapCanvas = await reportMap(s, W - 2 * P, 620);
    if (mapCanvas) {
      section(T('Hartă'));
      y += 14;
      x.drawImage(mapCanvas, P, y);
      x.strokeStyle = INK.light; x.lineWidth = 2; x.strokeRect(P, y, W - 2 * P, 620);
      y += 620;
    } else {
      section(T('Hartă'));
      row('', T(g && g.lat !== null ? 'Harta lipsește: registrul cu site-uri nu este încărcat pe acest dispozitiv.' : 'Harta lipsește: sesiunea nu are poziția contorului.'), INK.gray);
    }

    if (!isCheck) {
    section(T('Baleiaj'));
    const top = y + 24, r = 170;
    pizzaOnCanvas(x, s, P + r + 10, top + r, r);
    let ly = top + 30;
    const n = Math.max(cfg.coarseSteps, ...s.coarse.map((c) => c.step));
    const by = Object.fromEntries(s.coarse.map((c) => [c.step, c]));
    for (let k = 1; k <= n; k++) {
      const c = by[k], win = s.coarseWinner && s.coarseWinner.step === k;
      font(win ? 700 : 500, 28);
      text(T('Felia {0}', k), P + 440, ly, win ? INK.green : INK.ink);
      text(c && c.measured ? dbm(c.bestRssi) + (win ? ' · ' + T('cea mai bună') : '') : T('fără măsurătoare'), P + 600, ly, win ? INK.green : c && c.measured ? INK.ink : INK.gray);
      ly += 46;
    }
    y = Math.max(top + 2 * r, ly) + 10;

    section(T('Reglaj fin'));
    const L = s.live;
    if (L && L.readings.length) {
      const h = 130, vals = L.readings.map((q) => q.rssi), lo = Math.min(...vals, L.referenceRssi) - 3, hi = Math.max(...vals, L.referenceRssi) + 1;
      const bw = Math.min(46, (W - 2 * P) / vals.length - 6);
      y += 20;
      vals.forEach((v, i) => {
        const bh = Math.round(h * (0.08 + 0.92 * (v - lo) / (hi - lo)));
        x.fillStyle = i === vals.length - 1 ? INK.blue : v === L.bestRssi ? INK.green : INK.gray;
        x.fillRect(P + i * (bw + 6), y + h - bh, bw, bh);
        font(500, 17); text(String(v), P + i * (bw + 6) + bw / 2, y + h + 22, INK.gray, 'center');
      });
      x.fillStyle = INK.light; x.fillRect(P, y + h, W - 2 * P, 2);
      y += h + 34;
      row(L.serial, T('{0} citiri · cea mai bună {1} · ultima {2}', L.readings.length, dbm(L.bestRssi), dbm(L.lastRssi)));
    } else row('', T('Fără reglaj fin'), INK.gray);

    section(T('Confirmare finală'));
    const f = s.finalCheck;
    if (f && f.rssi !== null) row(f.ok ? 'OK' : '!', T('{0} · {1} dB față de cea mai bună măsurătoare ({2})', dbm(f.rssi), (f.deltaDb >= 0 ? '+' : '') + f.deltaDb, dbm(f.winnerRssi)), f.ok ? INK.green : INK.red);
    else row('', f ? T('Receptorul principal nu a răspuns') : T('Fără confirmare finală'), INK.red);

    }

    section(T('Receptoare'));
    const where = (q) => [q.siteName, q.address].filter(Boolean).join(', ');
    const p1 = s.receivers.find((q) => q.relation === 'PRIMARY');
    row(T('Receptor principal'), p1 ? [p1.serial, dbm(p1.bestRssi), where(p1)].filter(Boolean).join(' · ') : '–');
    const b = s.backup;
    row(T('Rezervă'), b ? [b.serial, dbm(b.bestRssi), T(RELATION_RO[b.redundancy] || 'site necunoscut'), b.siteName].filter(Boolean).join(' · ') : T('niciuna'), b ? INK.ink : INK.gray);
    y += 16;
    for (const q of s.receivers.slice(0, 8)) {
      y += 36; font(500, 23);
      text(q.serial, P, y); text(dbm(q.bestRssi), P + 300, y, INK.ink, 'right');
      text(q.bestPhase === 'check' && q.observedUtc ? ago(q.observedUtc) : T(RELATION_RO[q.relation]), P + 330, y, INK.gray);
      text((wrap(where(q) + (q.distanceM !== null ? ' · ' + meters(q.distanceM) : ''), W - 2 * P - 540)[0] || ''), P + 540, y, INK.gray);
    }
    if (s.session.note) {
      section(T('Observații'));
      font(500, 26);
      for (const l of wrap(s.session.note, W - 2 * P)) { y += 38; text(l, P, y); }
    }
    y += 70; font(400, 21);
    text(`LinkIQ Field Assistant v${VERSION} · ${T('generat {0}', fmtTime(new Date().toISOString()))}`, P, y, INK.gray);
    y += 44;
    const out = document.createElement('canvas');
    out.width = W; out.height = y;
    out.getContext('2d').drawImage(big, 0, 0);
    return out;
  }

  /** The installer's photo of the antenna, with the result written across the bottom. */
  async function stampPhoto(file, s) {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1920 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const x = c.getContext('2d'), W = c.width, H = c.height;
    x.drawImage(bmp, 0, 0, W, H);
    const u = Math.max(16, Math.round(W / 42)), bh = Math.round(u * 8.4), r = Math.round(bh * 0.42);
    const grad = x.createLinearGradient(0, H - bh * 1.5, 0, H);
    grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(0.35, 'rgba(0,0,0,0.72)'); grad.addColorStop(1, 'rgba(0,0,0,0.86)');
    x.fillStyle = grad; x.fillRect(0, H - bh * 1.5, W, bh * 1.5);
    pizzaOnCanvas(x, s, W - r - u, H - bh / 2 - u * 0.2, r);
    const maxW = W - 2 * r - 3.5 * u, f = s.finalCheck, w = s.coarseWinner;
    const signal = f && f.rssi !== null ? `${T('Semnal final')}: ${dbm(f.rssi)}` : s.best ? `${T('Cel mai bun semnal')}: ${dbm(s.best.rssi)}` : T('Nicio măsurătoare');
    const lines = [
      [`700 ${Math.round(u * 1.55)}px ${SANS}`, `${s.session.meterSerial} · ${outcomeLabel(s.session.outcome || s.suggestedOutcome)}`],
      [`600 ${Math.round(u * 1.15)}px ${SANS}`, signal + (s.primary ? ` · ${T('Receptor')} ${s.primary.serial}` : '')],
      [`500 ${u}px ${SANS}`, [w ? T('Felia {0}', w.step) + ' / ' + Math.max(cfg.coarseSteps, ...s.coarse.map((q) => q.step)) : null,
        fmtTime(s.session.finishedUtc || s.session.startedUtc), s.session.technician].filter(Boolean).join(' · ')],
      [`400 ${Math.round(u * 0.8)}px ${SANS}`, (s.session.gps.lat !== null ? `${s.session.gps.lat.toFixed(5)}, ${s.session.gps.lon.toFixed(5)} · ` : '')
        + `LinkIQ Field Assistant v${VERSION}` + (s.session.demo ? ' · DEMO' : '')],
    ];
    x.textAlign = 'left'; x.textBaseline = 'alphabetic'; x.fillStyle = '#fff';
    x.shadowColor = 'rgba(0,0,0,0.8)'; x.shadowBlur = u * 0.3;
    let y = H - bh + u * 1.3;
    for (const [fontSpec, str] of lines) { x.font = fontSpec; x.fillText(str, u, y, maxW); y += u * 1.95; }
    return c;
  }

  let lastPhoto = null;        // stamped antenna photo of this session, for the PDF

  function saveBlob(blob, name, doneKey, previewUrl) {
    const msg = $('report-msg'), img = $('report-preview');
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    if (previewUrl !== null) { img.src = previewUrl || url; img.alt = name; img.hidden = false; }   // also shown, so it can be saved by long-press
    msg.textContent = T(doneKey, name) + (previewUrl !== null ? ' ' + T('Dacă descărcarea nu pornește, ține apăsat pe imagine și alege „Salvează”.') : '');
    msg.hidden = false;
  }
  const canvasBlob = (canvas, type) => new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('canvas'))), type, 0.9));

  /** Minimal PDF: one page per canvas, each page a JPEG of that canvas. No library needed. */
  function pdfFromCanvases(canvases) {
    const enc = new TextEncoder(), parts = [], offsets = [];
    let len = 0;
    const push = (d) => { const b = typeof d === 'string' ? enc.encode(d) : d; parts.push(b); len += b.length; };
    const obj = (n, body, stream) => {
      offsets[n] = len;
      push(`${n} 0 obj\n${body}\n`);
      if (stream) { push('stream\n'); push(stream); push('\nendstream\n'); }
      push('endobj\n');
    };
    push('%PDF-1.4\n'); push(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));
    const kids = [];
    canvases.forEach((c, i) => {
      const page = 3 + i * 3, content = page + 1, image = page + 2;
      const bin = atob(c.toDataURL('image/jpeg', 0.9).split(',')[1]), jpeg = new Uint8Array(bin.length);
      for (let k = 0; k < bin.length; k++) jpeg[k] = bin.charCodeAt(k);
      const W = 595, H = Math.round(595 * c.height / c.width * 100) / 100;      // A4 width, height follows the picture
      const draw = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
      kids.push(`${page} 0 R`);
      obj(page, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${image} 0 R >> >> /Contents ${content} 0 R >>`);
      obj(content, `<< /Length ${draw.length} >>`, enc.encode(draw));
      obj(image, `<< /Type /XObject /Subtype /Image /Width ${c.width} /Height ${c.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`, jpeg);
    });
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${canvases.length} >>`);
    const total = 2 + canvases.length * 3, start = len;
    let xref = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
    for (let n = 1; n <= total; n++) xref += String(offsets[n]).padStart(10, '0') + ' 00000 n \n';
    push(xref + `trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);
    return new Blob(parts, { type: 'application/pdf' });
  }
  const reportName = (s) => safeName(s.session.meterSerial) + (s.session.status === 'CHECK' ? '_status' : '');

  $('report-btn').onclick = async () => {
    if (!S) return;
    try { saveBlob(await canvasBlob(await buildReport(S), 'image/png'), reportName(S) + '.png', 'Raportul a fost salvat ca {0}.'); }
    catch (e) { showError('align-error', T('Nu am putut crea fișierul: {0}', e.message)); }
  };
  $('report-pdf-btn').onclick = async () => {
    if (!S) return;
    try {
      const pages = [await buildReport(S)];
      if (lastPhoto && S.session.status !== 'CHECK') pages.push(lastPhoto);
      saveBlob(pdfFromCanvases(pages), reportName(S) + '.pdf', pages.length > 1 ? 'Raportul PDF, cu fotografia antenei, a fost salvat ca {0}.' : 'Raportul PDF a fost salvat ca {0}.', null);
    } catch (e) { showError('align-error', T('Nu am putut crea fișierul: {0}', e.message)); }
  };
  $('photo-file').onchange = async (ev) => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file || !S) return;
    try {
      lastPhoto = await stampPhoto(file, S);
      saveBlob(await canvasBlob(lastPhoto, 'image/jpeg'), safeName(S.session.meterSerial) + '_antenne.jpg', 'Fotografia cu datele măsurătorii a fost salvată ca {0}.');
    } catch (e) { showError('align-error', T('Nu am putut crea fișierul: {0}', e.message)); }
  };

  // ---------------------------------------------------------------- boot
  (async function boot() {
    $('ver').textContent = 'v' + VERSION;
    translatePage();
    $('tech').value = store.get('tech', '') || '';
    if (!(await serverAnswers())) await startStandalone();
    // Pairing link: https://host/#pair=CODE. The fragment never reaches the server.
    const hashCode = (location.hash.match(/^#pair=([\w-]{8,})$/) || [])[1];
    if (hashCode) history.replaceState(null, '', location.pathname + location.search);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    try {
      cfg = { ...cfg, ...(await api('/api/config')) };
      $('mode').hidden = cfg.kamstrupMode !== 'sim';
    } catch { /* offline start: defaults */ }
    let pairedName = null;
    if (cfg.authMode === 'token') {
      if (hashCode) { leaveSession(); store.set('token', hashCode); }
      if (!store.get('token')) { showView('pair'); return; }
      try {
        pairedName = (await api('/api/me')).technician;
        store.set('tech', pairedName);
      } catch (e) {
        if (e.status === 401) { store.del('token'); showView('pair'); showError('pair-error', T('Cod de cuplare invalid sau retras.')); return; }
        pairedName = store.get('tech');   // offline: keep going with what we know
      }
    }
    const sid = store.get('session');
    if (sid) {
      try {
        const s = await api('/api/sessions/' + sid);
        if (s.session.status === 'ACTIVE') { enterSession(s); return; }
      } catch { /* fall through */ }
      store.del('session');
    }
    showStart(pairedName);
  })();
})();
