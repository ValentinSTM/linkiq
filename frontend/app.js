/* LinkIQ Field Assistant - PWA client. Plain JavaScript, no build step, no framework.
   The server owns the session; this file only renders the summary it returns and
   decides which single instruction to show next. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const VERSION = '0.22';
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
  // Age of the last contact in a status check (thresholds from the engine: 75 min and 8 h).
  const AGE_RO = { CURRENT: 'ultima oră', OCCASIONAL: 'ocazional', OLD: 'peste 8 ore' };

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
  /** Status check: how many of our receivers had contact, and when, in one sentence. */
  function contactText(s) {
    const c = s.check && s.check.contact;
    if (!c) return '';
    const parts = [];
    if (c.current) parts.push(T('{0} cu contact în ultima oră', c.current));
    if (c.occasional) parts.push(T('{0} doar ocazional (1–{1} ore)', c.occasional, c.historyMaxH));
    if (c.old) parts.push(T('{0} fără contact de peste {1} ore (nu contează)', c.old, c.historyMaxH));
    return parts.join(' · ');
  }
  /** Status check verdict: [colour, sentence]. Hourly data is the goal; contact older than 8 h is history only. */
  function contactVerdict(s) {
    const c = s.check && s.check.contact;
    if (!c || !s.receivers.length) return ['red', T('Niciun concentrator de-al nostru nu a auzit contorul.')];
    if (!s.primary) return ['red', T('Fără contact în ultimele {0} ore: datele din această perioadă se pierd.', c.historyMaxH)];
    if (c.current >= 2) return ['green', T('Date orare, cu redundanță.')];
    if (c.current === 1) return ['yellow', T('Un singur concentrator cu contact în ultima oră: fără redundanță.')];
    return ['yellow', T('Niciun contact în ultima oră: datele ajung cu întârziere.')];
  }
  /** One line with the signal and contact-age limits, so a report can be read on its own. */
  function limitsText(withAge) {
    const th = cfg.thresholds || { goodDbm: -95, marginalDbm: -110 };
    let t = T('Semnal: bun ≥ {0} dBm · la limită {0}…{1} dBm · slab < {1} dBm (praguri provizorii).', th.goodDbm, th.marginalDbm);
    if (withAge) t += ' ' + T('Contact: ultima oră ≤ {0} min · ocazional ≤ {1} ore · mai vechi de {1} ore nu contează.', th.contactCurrentMaxMin || 75, th.contactHistoryMaxH || 8);
    return t;
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

  // ---------------------------------------------------------------- installation details
  // Big chips, nothing preselected, at most five taps. The card is on screen during
  // the whole session, so it can be filled in while waiting for a measurement.
  const INSTALL = {
    meter: [['basement', 'Subsol'], ['ground', 'Parter'], ['floor', 'Etaj']],
    type: [['internal', 'Internă'], ['external', 'Externă']],
    place: [['meter', 'Lângă contor'], ['basement', 'Subsol'], ['ground', 'Parter'], ['floor', 'Etaj'], ['facade', 'Fațadă, afară'], ['roof', 'Acoperiș']],
  };
  const levelDone = (l) => !!l && ((l.kind !== 'basement' && l.kind !== 'floor') || !!l.n);
  // An internal antenna sits in the meter: no place to give.
  const installDone = (i) => !!i && levelDone(i.meterLevel) && !!i.antennaType && (i.antennaType === 'internal' || levelDone(i.antennaPlace));
  function levelText(l) {
    if (!l) return '–';
    return { basement: T('Subsol −{0}', l.n), ground: T('Parter'), floor: T('Etaj {0}', l.n), meter: T('lângă contor'), facade: T('fațadă, afară'), roof: T('acoperiș') }[l.kind];
  }
  const modeText = (i) => (i && i.mode === 'single' ? T('o singură poziție')
    : T('rotație') + (i && i.excluded && i.excluded.length ? ' (' + T('fără felia {0}', i.excluded.slice().sort().join(', ')) + ')' : ''));
  const typeText = (t) => (t === 'internal' ? T('Internă') : t === 'external' ? T('Externă') : '–');
  const installShort = (i) => (i ? [T('Contor') + ': ' + levelText(i.meterLevel), T('Antenă') + ' ' + typeText(i.antennaType).toLowerCase() + ', ' + (i.antennaType === 'internal' ? T('în contor') : levelText(i.antennaPlace))].join(' · ') : '');

  function chipRow(el, options, current, onPick) {
    el.replaceChildren();
    for (const [value, label] of options) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = label;
      b.className = current === value ? 'on' : '';
      b.setAttribute('aria-pressed', String(current === value));
      b.onclick = () => onPick(value);
      el.appendChild(b);
    }
  }
  function levelRow(el, level, changed) {
    const need = level && (level.kind === 'basement' || level.kind === 'floor');
    el.hidden = !need;
    if (!need) return;
    const options = level.kind === 'basement' ? [1, 2, 3].map((n) => [n, '−' + n]) : [1, 2, 3, 4, 5, 6, 7, 8].map((n) => [n, String(n)]);
    chipRow(el, options, level.n, (n) => { level.n = n; changed(); });
    if (level.kind === 'floor') {                       // rare: higher than the eighth floor
      const more = document.createElement('input');
      more.type = 'number'; more.min = 9; more.max = 60; more.placeholder = '9+'; more.inputMode = 'numeric';
      if (level.n > 8) more.value = level.n;
      more.onchange = () => { const n = Math.round(Number(more.value)); if (n >= 9 && n <= 60) { level.n = n; changed(); } };
      el.appendChild(more);
    }
  }
  function syncSetup() {                    // cheap: called on every render
    const i = ui.install || {}, ready = !!S && S.session.state === 'READY' && S.session.status === 'ACTIVE';
    $('setup-card').hidden = !ready;
    $('type-info').hidden = ready || !i.antennaType;
    $('type-info').textContent = i.antennaType ? T('Antenă') + ': ' + typeText(i.antennaType) + (i.antennaType === 'external' ? ' · ' + modeText(i) : '') : '';
    $('place-row').hidden = i.antennaType === 'internal';
  }
  function drawInstall() {
    const i = ui.install = ui.install || { meterLevel: null, antennaType: null, antennaPlace: null };
    const changed = () => { store.set('ui', ui); drawInstall(); };
    chipRow($('ch-meter'), INSTALL.meter.map(([v, l]) => [v, T(l)]), i.meterLevel && i.meterLevel.kind, (k) => { i.meterLevel = { kind: k, n: null }; changed(); });
    levelRow($('ch-meter-n'), i.meterLevel, changed);
    // Antenna type and kind of measurement are chosen before the first CALL (setup card).
    const ready = !!S && S.session.state === 'READY';
    chipRow($('ch-type'), INSTALL.type.map(([v, l]) => [v, T(l)]), i.antennaType, (t) => {
      if (!ready) return;
      i.antennaType = t;
      if (t === 'external' && !i.mode) i.mode = 'sweep';
      changed(); if (!busy) render();
    });
    $('mode-row').hidden = i.antennaType !== 'external';
    chipRow($('ch-mode'), [['sweep', T('Rotație ({0} felii)', cfg.coarseSteps)], ['single', T('O singură poziție')]], i.mode, (m) => {
      if (!ready) return;
      i.mode = m; changed(); if (!busy) render();
    });
    $('mode-hint').textContent = i.antennaType === 'internal' ? T('Antena internă nu se poate muta: o singură măsurătoare, fără rotație.')
      : !i.antennaType ? '' : i.mode === 'single'
      ? T('Pentru antena prinsă fix sau locul cerut de inginer: un CALL, o măsurătoare, răspuns imediat.')
      : T('Atinge o felie ca s-o scoți (de ex. acolo antena ar lovi peretele). În timpul rotației poți sări peste orice felie.');
    syncSetup();
    chipRow($('ch-place'), INSTALL.place.map(([v, l]) => [v, T(l)]), i.antennaPlace && i.antennaPlace.kind, (k) => { i.antennaPlace = { kind: k, n: null }; changed(); });
    levelRow($('ch-place-n'), i.antennaPlace, changed);
    $('install-ok').textContent = installDone(i) ? '✓' : '';
    $('install-card').classList.toggle('done', installDone(i));
  }

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
      // Internal antenna, screwed-on antenna or the place the site engineer points at: one measurement.
      if (isSingle()) return { kind: 'finish', single: true };
      const steps = sweepSteps();
      if (cur.step === steps[0] && s.quickConfirmEligible && !ui.fullSweep) return { kind: 'quickChoice' };
      const next = steps.find((k) => k > cur.step);
      if (next) return { kind: 'move', phase: 'coarse', step: next };
      if (!s.coarseWinner) return { kind: 'finish' };
      return { kind: 'coarseDone' };
    }
    return { kind: 'finalCall' };   // a session from an older version, left in the 5-position fine tune
  }

  const isInternal = () => !!(ui.install && ui.install.antennaType === 'internal');
  const isSingle = () => isInternal() || !!(ui.install && ui.install.mode === 'single');
  const excludedSet = () => new Set((ui.install && ui.install.excluded) || []);
  const sweepSteps = () => { const ex = excludedSet(); return Array.from({ length: cfg.coarseSteps }, (_, k) => k + 1).filter((k) => !ex.has(k)); };
  const instOf = (s) => s.session.install || ui.install || null;
  const singleOf = (s) => { const i = instOf(s); return !!i && (i.antennaType === 'internal' || i.mode === 'single'); };

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

  function setButtons(main, alt, alt2) {
    const m = $('main-btn'), a = $('alt-btn'), a2 = $('alt2-btn');
    a2.hidden = !alt2;
    if (alt2) { a2.textContent = alt2.label; a2.onclick = guarded(alt2.run); }
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
    // installation card: under the buttons while measuring, above "save" at the end
    const card = $('install-card'), active = s.session.status === 'ACTIVE';
    card.hidden = !active;
    if (active) {
      const ref = a.kind === 'finish' ? $('finish-box') : $('align-error');
      if (card.nextElementSibling !== ref) ref.parentNode.insertBefore(card, ref);
    }
    // position: optional, can be set or corrected after the fact
    const showPos = a.kind === 'check' || a.kind === 'done' || a.kind === 'finish';
    $('pos-card').hidden = !showPos;
    if (showPos) {
      const g = s.session.gps;
      $('pos-text').textContent = g.lat !== null
        ? T('Poziția contorului: {0}, {1}', g.lat.toFixed(5), g.lon.toFixed(5)) + (g.source === 'saved' ? ' · ' + T('salvată la vizita din {0}', fmtTime(g.savedUtc)) : '') + '.'
        : T('Fără poziția contorului nu apar harta și distanțele. O poți indica pe hartă, dacă vrei.');
      $('pos-btn').textContent = T(g.lat !== null ? 'Corectează poziția pe hartă' : 'Indică poziția pe hartă');
    }

    switch (a.kind) {
      case 'initialCall':
        if (!ui.install || !ui.install.antennaType) {
          setInstruction('blue', T('Alege tipul antenei'), T('Internă sau externă? Abia apoi apeși CALL pe contor.'));
          setButtons({ label: T('Alege întâi antena'), disabled: true });
          break;
        }
        setInstruction('blue', T('Apasă CALL pe contor'), isInternal()
          ? T('Antenă internă: nu se rotește, se face o singură măsurătoare. Confirmă abia când CALL apare pe afișajul contorului.')
          : isSingle() ? T('O singură poziție: antena rămâne unde este. Confirmă abia când CALL apare pe afișajul contorului.')
            : T('Pune antena pe felia {0}. Confirmă abia când CALL apare pe afișajul contorului.', sweepSteps()[0]));
        setButtons({ label: T('CALL este pe afișaj'), run: act('call-confirmed', { phase: 'initial', step: isSingle() ? 1 : sweepSteps()[0] }) });
        break;
      case 'wait': {
        const w = waitSeconds(), slow = w >= cfg.warnAfterS;
        setInstruction(slow ? 'red' : 'yellow', T('AȘTEAPTĂ – nu mișca antena'),
          slow ? T('Durează mai mult decât de obicei. Ține antena nemișcată sau sari peste această poziție.')
               : (S.current.nObs > 0 ? T('Am primit primele citiri. Mai aștept receptorul principal.')
                                     : T('Măsurătoarea vine de obicei în 20–40 de secunde.')));
        const sweeping = cur.phase === 'coarse' && !isSingle();
        setButtons({ label: T('Aștept măsurătoarea… {0} s', w), cls: 'wait', disabled: true },
          S.current.nObs > 0 && w >= 10 ? { label: T('Gata, mergi mai departe cu ce a venit'), run: act('accept') }
            : sweeping ? { label: T('Sari peste felia {0}', cur.step), run: act('skip') }
              : slow ? { label: T('Sari peste această poziție'), run: act('skip') } : null,
          sweeping && S.current.nObs > 0 && w >= 10 ? { label: T('Sari peste felia {0}', cur.step), run: act('skip') } : null);
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
        } else if (!f && a.single && s.best) {
          const th = cfg.thresholds || { goodDbm: -95, marginalDbm: -110 };
          setInstruction(s.best.rssi >= th.goodDbm ? 'green' : s.best.rssi >= th.marginalDbm ? 'yellow' : 'red',
            T(isInternal() ? 'Antenă internă: {0}' : 'O singură poziție: {0}', dbm(s.best.rssi)),
            T(isInternal() ? 'Antena internă nu se poate muta, deci nu se face rotația. Completează montajul și salvează.'
              : 'Măsurătoarea din locul ales. Completează montajul și salvează, sau fă totuși rotația.'));
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
          if (!installDone(ui.install)) {
            $('install-card').scrollIntoView({ behavior: 'smooth', block: 'center' });
            throw new Error(T(isInternal() ? 'Completează montajul: nivelul contorului.' : 'Completează montajul: nivelul contorului, tipul antenei și locul antenei.'));
          }
          apply(await api(`/api/sessions/${s.session.id}/complete`, 'POST', { outcome: sel.value, note: $('note').value || null, install: ui.install }));
        } }, a.single && !isInternal() ? { label: T('Fă totuși rotația'), run: async () => { ui.install.mode = 'sweep'; store.set('ui', ui); } } : null);
        break;
      }
      case 'check': {
        // Status without CALL: who hears this meter right now.
        const c = s.check, n = s.receivers.length, top = s.receivers[0];
        const seen = c.lastSeenUtc ? T('Auzit ultima dată {0} ({1}).', fmtTime(c.lastSeenUtc), ago(c.lastSeenUtc)) : T('Nu se știe când a fost auzit ultima dată.');
        const [color, verdict] = contactVerdict(s);
        const who = s.warnings.includes('REGISTRY_EMPTY') ? T('{0} receptoare l-au auzit; registrul nu este încărcat, deci nu se știe care sunt ale noastre.', n)
          : n ? T('Concentratoarele noastre: {0}.', contactText(s)) : '';
        const pos = s.session.gps.source === 'saved' ? ' ' + T('Poziția este cea salvată la vizita din {0}.', fmtTime(s.session.gps.savedUtc)) : '';
        setInstruction(color, T('Contor {0}', s.session.meterSerial), [verdict, seen, who].filter(Boolean).join(' ') + pos);
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
    syncSetup();
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
    const READY = s.session.state === 'READY';
    if ((READY && (!ui.install || !ui.install.antennaType)) ) { svg.parentElement.hidden = true; return; }
    svg.parentElement.hidden = false;
    if ((READY || s.session.status === 'ACTIVE') ? isSingle() : singleOf(s)) {
      // one measurement: one circle, no slices
      const c0 = s.coarse[0], waiting = s.session.state === 'WAIT_RF';
      const circ = document.createElementNS(ns, 'circle');
      circ.setAttribute('r', '100');
      circ.setAttribute('class', READY ? 's-current' : waiting ? 's-waiting' : c0 && c0.measured ? 's-best' : 's-untested');
      if (c0 && c0.measured && !waiting) circ.style.fill = linkColor(c0.bestRssi);
      svg.appendChild(circ);
      const lbl = document.createElementNS(ns, 'text');
      lbl.setAttribute('y', '-18'); lbl.setAttribute('class', waiting || !c0 ? 't-dark' : 't-light');
      lbl.textContent = T(isInternal() ? 'Antenă internă' : 'O poziție');
      lbl.style.fontSize = '17px';
      svg.appendChild(lbl);
      const v = document.createElementNS(ns, 'text');
      v.setAttribute('y', '26'); v.setAttribute('class', 'rssi ' + (waiting || !c0 ? 't-dark' : 't-light'));
      v.style.fontSize = '38px';
      v.textContent = c0 && c0.measured ? Math.round(c0.bestRssi) + ' dBm' : waiting ? '…' : '';
      svg.appendChild(v);
      return;
    }
    const ex = excludedSet(), first = sweepSteps()[0];
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
      if (target === k || (a.kind === 'initialCall' && k === first)) cls = 'current';
      if (ex.has(k) && !(c && (c.measured || c.skipped))) cls = 'excluded';
      // Tap a slice that is still to come to leave it out (or take it back).
      const open = s.session.status === 'ACTIVE' && !(c && (c.measured || c.skipped)) && !(isCur && s.session.state === 'WAIT_RF') && !s.coarseWinner;
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', `M0 0 L${x0.toFixed(2)} ${y0.toFixed(2)} A100 100 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`);
      path.setAttribute('class', 's-' + cls + (open ? ' tap' : ''));
      if (open) path.onclick = () => toggleSlice(k);
      svg.appendChild(path);
      const tcls = cls === 'untested' || cls === 'waiting' || cls === 'skipped' || cls === 'excluded' ? 't-dark' : 't-light';
      const [tx, ty] = pt(mid, 62);
      const num = document.createElementNS(ns, 'text');
      num.setAttribute('x', tx.toFixed(1)); num.setAttribute('y', (ty - 6).toFixed(1));
      num.setAttribute('class', tcls); num.textContent = k;
      svg.appendChild(num);
      const val = document.createElementNS(ns, 'text');
      val.setAttribute('x', tx.toFixed(1)); val.setAttribute('y', (ty + 9).toFixed(1));
      val.setAttribute('class', 'rssi ' + tcls);
      val.textContent = c && c.measured ? Math.round(c.bestRssi) : (c && c.skipped) || cls === 'excluded' ? '✕' : '';
      svg.appendChild(val);
    }
  }

  function toggleSlice(k) {
    if (busy) return;
    const i = ui.install = ui.install || {};
    const ex = new Set(i.excluded || []);
    if (ex.has(k)) ex.delete(k);
    else {
      const left = sweepSteps().filter((q) => q !== k);
      if (!left.length) { showError('align-error', T('Măcar o felie trebuie măsurată.')); return; }
      ex.add(k);
    }
    i.excluded = [...ex].sort();
    store.set('ui', ui);
    render();
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
    if (on) document.querySelector('.pizza-wrap').hidden = true;   // drawPizza decides otherwise
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
      const isCheck = first.bestPhase === 'check';
      const counts = isCheck ? ['CURRENT', 'OCCASIONAL', 'OLD'].map((k) => [k, group.filter((r) => r.age === k).length]).filter(([, v]) => v) : [];
      hsub.textContent = (group.length === 1 ? T('1 concentrator a auzit contorul') : T('{0} concentratoare au auzit contorul', group.length))
        + (counts.length ? ' (' + counts.map(([k, v]) => `${v} ${T(AGE_RO[k])}`).join(', ') + ')' : '')
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
        if (!(r.age === 'OLD' && r.relation !== 'PRIMARY')) name.appendChild(tag);
        if (r.age) {
          const at = document.createElement('span');
          at.className = 'tag age ' + r.age; at.textContent = T(AGE_RO[r.age]);
          name.append(' ', at);
          if (r.age === 'OLD') li.classList.add('old');
        }
        const val = document.createElement('span');
        val.className = 'val'; val.textContent = dbm(r.bestRssi);
        const sub = document.createElement('span');
        sub.className = 'sub';
        sub.textContent = r.bestPhase === 'check' ? (r.observedUtc ? T('ultimul contact {0}', ago(r.observedUtc))
            + (r.age === 'OLD' ? ' · ' + T('nu contează: contorul păstrează doar {0} ore de date', (cfg.thresholds || {}).contactHistoryMaxH || 8)
              : r.age === 'OCCASIONAL' ? ' · ' + T('nu în ultima oră') : '') : T('fără oră de la sursă'))
          : T('felii: {0} · cel mai bun pe felia {1}', r.sectors.join(', ') || '–', r.bestPhase === 'coarse' ? r.bestStep : (s.coarseWinner ? s.coarseWinner.step : '–'));
        li.append(name, val, sub);
        li.onclick = () => { selectedSerial = r.serial; showView('map'); };
        list.appendChild(li);
      }
    }
    const legend = document.createElement('li');
    legend.className = 'legend';
    legend.textContent = limitsText(s.session.status === 'CHECK');
    if (s.receivers.length) list.appendChild(legend);
    const b = s.backup;
    $('backup-card').hidden = !b;
    if (b) {
      const kind = b.redundancy === 'DISTINCT_SITE' ? T('pe alt site (rezervă reală)') :
        b.redundancy === 'SAME_SITE' ? T('pe același site (doar rezervă de echipament)') : T('pe un site necunoscut');
      let t = T('Rezervă: {0} {1}, {2}', b.serial, kind, dbm(b.bestRssi));
      t += b.age && b.age !== 'CURRENT' ? T(' – doar contact ocazional, nu contează ca redundanță.') : b.usable ? '.' : T(' – prea slab pentru a conta.');
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
      const key = r.siteCode || r.serial, cur = by.get(key), rank = AGE_RANK[r.age] || 0;
      if (!cur) {
        by.set(key, { key, lat: r.latitude, lon: r.longitude, name: r.siteName, address: r.address, distanceM: r.distanceM,
          best: r.bestRssi, serial: r.serial, count: 1, primary: r.relation === 'PRIMARY', age: r.age || null, rank });
      } else {
        cur.count++;
        if (r.relation === 'PRIMARY') cur.primary = true;
        if (rank < cur.rank || (rank === cur.rank && r.bestRssi > cur.best)) { cur.best = r.bestRssi; cur.serial = r.serial; cur.age = r.age || null; cur.rank = rank; }
      }
    }
    return [...by.values()].sort((x, y) => (x.rank - y.rank) || y.best - x.best);
  }
  const AGE_RANK = { CURRENT: 0, OCCASIONAL: 1, OLD: 2 };
  const OLD_GRAY = '#9aa5ad';
  /** Line style: solid for contact in the last hour, dashed for occasional, grey dotted for older than 8 h. */
  const linkStyle = (l) => (l.age === 'OLD' ? { color: OLD_GRAY, dash: [4, 8], dashL: '2 8' }
    : { color: linkColor(l.best), dash: l.primary ? [] : l.age === 'OCCASIONAL' ? [14, 10] : [12, 9], dashL: l.primary ? null : '8 8' });
  // Colours follow the PROVISIONAL thresholds: good / marginal / weak.
  const linkColor = (rssi) => {
    const th = cfg.thresholds || { goodDbm: -95, marginalDbm: -110 };
    return rssi >= th.goodDbm ? '#1b8a3a' : rssi >= th.marginalDbm ? '#b26a00' : '#c62828';
  };
  const meters = (m) => Math.round(m).toLocaleString(lang === 'da' ? 'da-DK' : 'ro-RO') + ' m';
  const linkText = (l) => `${Math.round(l.best)} dBm` + (l.distanceM !== null ? ` · ${meters(l.distanceM)}` : '') + (l.age === 'OLD' ? ` · ${T('peste 8 ore')}` : '');
  let lastFit = '';

  function drawMap() {
    if (!ensureMap()) { $('map-info').textContent = T('Harta nu este disponibilă.'); return; }
    mapLayer.clearLayers();
    const g = S && S.session.gps.lat !== null ? S.session.gps : null;
    const links = S ? siteLinks(S) : [];
    const pts = [];
    links.forEach((l, i) => {
      const st = linkStyle(l), color = st.color;
      if (g) {
        // meter -> site: signal and distance written on the line
        const line = L.polyline([[g.lat, g.lon], [l.lat, l.lon]], { color, weight: l.primary ? 6 : 3, dashArray: st.dashL, opacity: l.age === 'OLD' ? 0.7 : 0.9 }).addTo(mapLayer);
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
        + (S.session.status === 'CHECK' ? ' ' + T('Linie gri = fără contact de peste 8 ore.') : '')
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

  let lastView = 'start';
  function showView(name) {
    for (const v of ['pair', 'start', 'align', 'recv', 'map', 'sync']) $('view-' + v).hidden = v !== name;
    if (name !== 'sync') lastView = name;
    if (name === 'sync') vqLoad().then(renderVq);
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
    drawInstall();
    $('outcome').replaceChildren(); delete $('outcome').dataset.touched; $('note').value = '';
    showView('align');
    render();
    renderReadings();
    renderVvs();
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
    $('vvs-msg').textContent = T('Copiază seria contorului și deschide VVS-dialog. Acolo scrie li în bara de adrese și alege bookmark-ul cu steluță.');
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
      const here = S && S.session.gps.lat !== null ? S.session.gps : gps;
      const last = here || store.get('lastPos');
      if (last) map.setView([last.lat, last.lon], 17);
      else if (sites.length > 1) map.fitBounds(sites.map((x) => [x.latitude, x.longitude]), { padding: [40, 40] });
      else if (sites.length) map.setView([sites[0].latitude, sites[0].longitude], 14);
      else map.setView([56, 10.5], 7);
      if (here) setPick(here.lat, here.lon, false);
    }, 0);
  }
  function endPick() {
    picking = false;
    if (pickMarker) { pickMarker.remove(); pickMarker = null; }
    showView(S ? 'align' : 'start');
  }
  $('pick-btn').onclick = () => { picking = true; picked = null; $('pick-ok').disabled = true; $('pick-info').textContent = T('Nicio poziție aleasă.'); showView('map'); };
  $('pick-cancel').onclick = endPick;
  $('pos-btn').onclick = () => { picking = true; picked = null; $('pick-ok').disabled = true; $('pick-info').textContent = T('Nicio poziție aleasă.'); showView('map'); };
  $('pick-ok').onclick = async () => {
    store.set('lastPos', picked);
    if (S) {                                   // position for the session or status check on screen
      const pos = { lat: picked.lat, lon: picked.lon, accuracyM: null };
      try {
        apply(S.session.status === 'CHECK'
          ? await api('/api/check', 'POST', { meterSerial: S.session.meterSerial, technician: S.session.technician, gps: pos })
          : await api(`/api/sessions/${S.session.id}/position`, 'POST', { gps: pos }));
      } catch (e) { showError('align-error', e.status === 404 ? 'Poziția se poate schimba doar în varianta fără server.' : e.message); }
      lastFit = '';
      endPick();
      render();
      return;
    }
    gps = { lat: picked.lat, lon: picked.lon, accuracyM: null };
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

  $('meter').addEventListener('change', () => {
    const p = engine && !gps ? engine.savedPosition($('meter').value) : null;
    if (p) $('gps-info').textContent = T('Pentru acest contor există o poziție salvată la vizita din {0}; se folosește dacă nu alegi alta.', fmtTime(p.savedUtc));
  });

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
    let stream = null, timer = null, onResult = null, detector = null, canvas = null, frame = 0;
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
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false });
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
            // Alternate the whole frame (small codes anywhere) with the centre square at full
            // detail (dense codes, such as the registry, held in the middle of the picture).
            canvas = canvas || document.createElement('canvas');
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            frame++;
            if (frame % 2) {
              const k = Math.min(1, 800 / v.videoWidth);
              canvas.width = Math.round(v.videoWidth * k); canvas.height = Math.round(v.videoHeight * k);
              ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            } else {
              const side = Math.min(v.videoWidth, v.videoHeight), k = Math.min(1, 1100 / side);
              canvas.width = canvas.height = Math.round(side * k);
              ctx.drawImage(v, (v.videoWidth - side) / 2, (v.videoHeight - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
            }
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
    return { open, close, decodePhoto, loadScript };
  })();
  $('scan-close').onclick = () => scanner.close();

  // ---------------------------------------------------------------- registry by QR code
  // Work phones may not save files from Teams or mail, so the registry travels as a
  // QR code: shown on a colleague's screen or paper, or as a picture. Format:
  // "LIQR1:<yyyymmdd>:" + base64url(deflate-raw(sites CSV + RS + concentrators CSV)).
  const REGQR = 'LIQR1:';
  const b64url = (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const unb64url = (t) => Uint8Array.from(atob(t.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0));
  async function pipe(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }
  async function registryToQrText() {
    if (!('CompressionStream' in window)) throw new Error(T('Browserul este prea vechi pentru a face codul QR.'));
    const csv = engine.registryCsv();
    const z = await pipe(new TextEncoder().encode(csv.sites + '\u001e' + csv.concentrators), new CompressionStream('deflate-raw'));
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `${REGQR}${day}:${b64url(z)}`;
  }
  async function importRegistryQr(text) {
    const msg = $('reg-msg');
    msg.hidden = false;
    try {
      const m = /^LIQR1:(\d{8}):([A-Za-z0-9_-]+)$/.exec((text || '').trim());
      if (!m) { msg.textContent = T('Acesta nu este un cod QR cu registrul LinkIQ.'); return; }
      if (!('DecompressionStream' in window)) throw new Error(T('Browserul este prea vechi pentru a citi codul QR.'));
      const raw = new TextDecoder().decode(await pipe(unb64url(m[2]), new DecompressionStream('deflate-raw')));
      const [sites, conc] = raw.split('\u001e');
      const r = engine.replaceRegistry(sites || '', conc || '', { origin: 'qr', version: m[1] });
      if (!r) { msg.textContent = T('Codul QR nu conține un registru valid.'); return; }
      keepRegistry();
      const d = m[1];
      msg.textContent = T('Registru citit din codul QR din {0}: {1} site-uri, {2} concentratoare.', `${d.slice(6)}.${d.slice(4, 6)}.${d.slice(0, 4)}`, r.sites, r.concentrators);
    } catch (e) { msg.textContent = T('Nu am putut citi registrul: {0}', e.message); }
    refreshData();
  }
  $('regqr-scan').onclick = () => scanner.open(T('Îndreaptă camera spre codul QR cu registrul'), importRegistryQr);
  $('regqr-image').onchange = async (ev) => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    $('reg-msg').hidden = false; $('reg-msg').textContent = T('Caut codul QR în imagine…');
    try {
      const text = await scanner.decodePhoto(file);
      if (!text) { $('reg-msg').textContent = T('Nu am găsit un cod QR în imagine.'); return; }
      await importRegistryQr(text);
    } catch (e) { $('reg-msg').textContent = T('Nu am putut citi imaginea: {0}', e.message); }
  };
  let regQrBlob = null;
  $('regqr-make').onclick = async () => {
    try {
      if (!window.qrcode) await scanner.loadScript('vendor/qrcode.js');
      const text = await registryToQrText();
      const qr = window.qrcode(0, 'L');
      qr.addData(text, 'Byte'); qr.make();
      const n = qr.getModuleCount(), cell = Math.max(6, Math.floor(900 / (n + 8))), size = (n + 8) * cell;
      const c = document.createElement('canvas'); c.width = size; c.height = size + 70;
      const x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#000';
      for (let r = 0; r < n; r++) for (let q = 0; q < n; q++) if (qr.isDark(r, q)) x.fillRect((q + 4) * cell, (r + 4) * cell, cell, cell);
      const info = engine.registryInfo();
      x.font = `600 26px ${SANS}`; x.textAlign = 'center'; x.fillStyle = '#0b1f2a';
      x.fillText(`LinkIQ – ${T('registru')}: ${info.sites} ${T('site-uri')}, ${info.concentrators} ${T('concentratoare')} · ${fmtTime(new Date().toISOString())}`, size / 2, size + 40);
      regQrBlob = await new Promise((ok) => c.toBlob(ok, 'image/png'));
      $('regqr-img').src = URL.createObjectURL(regQrBlob);
      $('regqr-info').textContent = T('{0} site-uri, {1} concentratoare · {2} caractere', info.sites, info.concentrators, text.length);
      $('regqr-sheet').hidden = false;
    } catch (e) { $('reg-msg').hidden = false; $('reg-msg').textContent = T('Nu am putut face codul QR: {0}', e.message); }
  };
  $('regqr-save').onclick = () => { if (regQrBlob) saveBlob(regQrBlob, `linkiq-register-qr-${new Date().toISOString().slice(0, 10)}.png`); };
  $('regqr-close').onclick = () => { $('regqr-sheet').hidden = true; };

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
    translatePage(); refreshData(); refreshReportDir(); if (S) drawInstall(); render();
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
    await loadRegistry();
    refreshData();
  }

  // ---- registry without importing: built into the app file, or lying next to the app
  // Order: 1) a registry built into this file (tools/build_single.py --sites --concentrators),
  // 2) linkiq_sites.csv + linkiq_koncentratorer.csv in the app's own folder on the server,
  // 3) what was imported by hand earlier. A hand import stays until a NEWER built-in or
  // folder registry appears; the same one is never applied twice.
  const hashText = (t) => { let h = 5381; for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0; return String(h >>> 0); };
  let storageWorks = true;
  async function loadRegistry() {
    let src = window.LINKIQ_REGISTRY || null, origin = 'embedded';
    if (!src && /^https?:$/.test(location.protocol)) {
      try {
        const [a, b] = await Promise.all(['linkiq_sites.csv', 'linkiq_koncentratorer.csv'].map(async (f) => {
          const r = await fetch(f, { cache: 'no-store' });
          return r.ok ? decodeCsv(await r.arrayBuffer()) : null;
        }));
        // a server that answers every address with a web page must not wipe the registry
        if (a && b && /site/i.test(a.split('\n', 1)[0]) && /seri/i.test(b.split('\n', 1)[0]) && !/<html/i.test(a + b)) { src = { sites: a, concentrators: b }; origin = 'folder'; }
      } catch { /* no such files: fine */ }
    }
    if (src) {
      const version = src.version || hashText(src.sites + src.concentrators);
      if (engine.db.builtInApplied !== version || !engine.registryInfo().concentrators) {
        if (engine.replaceRegistry(src.sites, src.concentrators, { origin, version })) { engine.db.builtInApplied = version; engine.save(); }
      }
    }
    if (!engine.registryInfo().concentrators) engine.restoreRegistry(store.get('registry'));   // second copy, if the main store was emptied
    keepRegistry();
  }
  function keepRegistry() {
    if (engine.registryInfo().concentrators) store.set('registry', engine.registryCopy());
    else store.del('registry');
    // can this way of opening the app keep anything at all?
    try { localStorage.setItem('linkiq.probe', '1'); storageWorks = localStorage.getItem('linkiq.probe') === '1'; } catch { storageWorks = false; }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});   // ask the browser not to evict it
  }

  function refreshData() {
    if (!engine) return;
    const r = engine.registryInfo();
    $('reg-info').textContent = r.concentrators
      ? T('Registru: {0} site-uri, {1} concentratoare', r.sites, r.concentrators) + (r.review ? T(', {0} fără site sigur.', r.review) : '.')
        + ' ' + T({ embedded: 'Este inclus în aplicație; nu trebuie importat.', folder: 'Se încarcă singur din dosarul aplicației.',
          qr: 'Citit dintr-un cod QR; rămâne pe acest dispozitiv până imporți altul.' }[(engine.db.registrySource || {}).origin]
          || 'Importat manual; rămâne pe acest dispozitiv până imporți altul.')
      : T('Registrul nu este încărcat: toate receptoarele auzite sunt tratate ca proprii, iar harta nu are site-uri.');
    const embedded = (engine.db.registrySource || {}).origin === 'embedded';
    $('store-warn').hidden = storageWorks || embedded;
    const n = engine.sessionCount();
    $('sess-info').textContent = T('{0} {1} pe acest dispozitiv. Datele nu pleacă nicăieri până nu le exporți.', n, n === 1 ? T('sesiune salvată') : T('sesiuni salvate'));
    $('sess-clear').hidden = n === 0;
    $('reg-clear').hidden = !r.concentrators;
    $('regqr-make').hidden = !r.concentrators;
    $('mode').hidden = !engine.demo;
    cfg.kamstrupMode = engine.demo ? 'sim' : 'live';
  }

  function decodeCsv(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch { return new TextDecoder('windows-1252').decode(buf); }   // CSV saved by Excel
  }
  const readCsvFile = async (file) => decodeCsv(await file.arrayBuffer());
  for (const [id, fn] of [['sites-file', 'importSites'], ['conc-file', 'importConcentrators']]) {
    $(id).onchange = async (ev) => {
      const file = ev.target.files[0], msg = $('reg-msg');
      if (!file) return;
      try {
        const r = engine[fn](await readCsvFile(file));
        if (r.imported) { engine.db.registrySource = { origin: 'manual' }; engine.save(); keepRegistry(); }
        msg.textContent = r.imported ? T('{0}: {1} rânduri încărcate', file.name, r.imported) + (r.review ? T(', {0} de verificat.', r.review) : '.')
          : T('{0}: nu am găsit rânduri valide. Verifică denumirile coloanelor.', file.name);
      } catch (e) { msg.textContent = `${file.name}: ${e.message}`; }
      msg.hidden = false;
      ev.target.value = '';
      refreshData();
    };
  }
  // Destructive buttons need a second tap, and say exactly what they remove.
  function twoTaps(btn, label, confirmLabel, action) {
    let armed = false, timer = null;
    const reset = () => { armed = false; btn.textContent = T(label); btn.classList.remove('armed'); };
    btn.onclick = () => {
      if (!armed) { armed = true; btn.textContent = T(confirmLabel); btn.classList.add('armed'); timer = setTimeout(reset, 4000); return; }
      clearTimeout(timer); reset(); action();
    };
  }
  twoTaps($('reg-clear'), 'Scoate site-urile și concentratoarele din aplicație', 'Apasă din nou ca să scoți registrul; va trebui importat iar',
    () => { engine.clearRegistry(); keepRegistry(); $('reg-msg').hidden = true; refreshData(); });
  twoTaps($('sess-clear'), 'Șterge măsurătorile salvate', 'Apasă din nou ca să ștergi măsurătorile',
    () => { engine.clearSessions(); store.del('session'); refreshData(); });
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

  function singleOnCanvas(x, s, cx, cy, r) {
    const c0 = s.coarse[0], ok = !!(c0 && c0.measured);
    x.beginPath(); x.arc(cx, cy, r, 0, 2 * Math.PI);
    x.fillStyle = ok ? linkColor(c0.bestRssi) : INK.light; x.fill();
    x.fillStyle = ok ? '#fff' : INK.ink; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = `800 ${Math.round(r * 0.42)}px ${SANS}`; x.fillText(ok ? String(Math.round(c0.bestRssi)) : '–', cx, cy - r * 0.06);
    x.font = `600 ${Math.round(r * 0.2)}px ${SANS}`; x.fillText('dBm', cx, cy + r * 0.34);
  }

  function pizzaOnCanvas(x, s, cx, cy, r) {
    if (singleOf(s) && s.coarse.length <= 1) { singleOnCanvas(x, s, cx, cy, r); return; }
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
      const [sx, sy] = P(l.lat, l.lon), st = linkStyle(l), color = st.color;
      x.strokeStyle = color; x.lineWidth = l.primary ? 7 : 3; x.setLineDash(st.dash);
      x.beginPath(); x.moveTo(mx, my); x.lineTo(sx, sy); x.stroke(); x.setLineDash([]);
      x.fillStyle = color; x.strokeStyle = '#fff'; x.lineWidth = 3;
      x.beginPath(); x.arc(sx, sy, l.primary ? 12 : 9, 0, 2 * Math.PI); x.fill(); x.stroke();
    });
    links.forEach((l, i) => {
      if (i >= 8 && !l.primary) return;
      const [sx, sy] = P(l.lat, l.lon);
      boxed(linkText(l), mx + (sx - mx) * 0.62, my + (sy - my) * 0.62, linkStyle(l).color, l.primary);
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
    if (s.session.status === 'CHECK') legend.push([OLD_GRAY, T('peste 8 ore')]);
    x.font = `600 17px ${SANS}`; x.textBaseline = 'middle'; x.textAlign = 'left';
    let lx = 14;
    x.fillStyle = 'rgba(255,255,255,0.88)'; x.fillRect(6, H - 38, s.session.status === 'CHECK' ? 640 : 470, 32);
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

  // Concentrators that last heard the meter more than this long ago are left out of the
  // report: they cannot carry hourly data, and they may stem from the meter being switched
  // on before installation (heard on the road or in the van).
  const REPORT_MAX_AGE_H = 9;
  const isStale = (q) => q.ageMin !== null && q.ageMin !== undefined && q.ageMin > REPORT_MAX_AGE_H * 60;

  async function buildReport(s) {
    const staleCount = s.receivers.filter(isStale).length;
    const shown = s.receivers.filter((q) => !isStale(q));
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
    row(T('Poziție'), g && g.lat !== null ? `${g.lat.toFixed(5)}, ${g.lon.toFixed(5)}` + (g.accuracyM ? ` (±${g.accuracyM} m)` : '') + (g.source === 'saved' ? ' · ' + T('salvată la vizita din {0}', fmtTime(g.savedUtc)) : '') : T('neînregistrată'));
    if (isCheck) {
      row(T('Auzit ultima dată'), s.check.lastSeenUtc ? `${fmtTime(s.check.lastSeenUtc)} (${ago(s.check.lastSeenUtc)})` : '–');
      const [vc, vt] = contactVerdict(s);
      row(T('Contact'), vt, vc === 'green' ? INK.green : vc === 'red' ? INK.red : INK.amber);
      if (s.check.contact && s.receivers.length) row('', contactText(s), INK.gray);
    }

    const ins = s.session.install;
    if (ins) {
      section(T('Montaj'));
      row(T('Contor'), levelText(ins.meterLevel));
      row(T('Antenă'), typeText(ins.antennaType) + (ins.antennaType === 'external' ? ' · ' + modeText(ins) : ''));
      row(T('Locul antenei'), ins.antennaType === 'internal' ? T('în contor') : levelText(ins.antennaPlace));
    }

    y = await drawReadings(x, P, W, y, (t) => { section(t); return y; }, font, text);
    y = drawVvsSection(x, P, W, y, (t) => { section(t); return y; }, font, text);

    const mapCanvas = await reportMap({ ...s, receivers: shown }, W - 2 * P, 620);
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
    const internalOnly = !s.finalCheck && singleOf(s) && s.coarse.length <= 1;
    if (internalOnly) {
      section(T('Măsurătoare'));
      const top = y + 20, r = 90, internal = instOf(s).antennaType === 'internal';
      singleOnCanvas(x, s, P + r + 10, top + r, r);
      font(700, 30); text(internal ? T('Antenă internă') : T('O singură poziție'), P + 2 * r + 60, top + 60);
      font(800, 44); text(s.best ? dbm(s.best.rssi) : '–', P + 2 * r + 60, top + 116, s.best ? linkColor(s.best.rssi) : INK.gray);
      font(500, 22);
      text(internal ? T('Contorul și antena nu se pot muta: o singură măsurătoare.') : T('Antena n-a fost rotită: o singură măsurătoare, la locul ales.'), P + 2 * r + 60, top + 156, INK.gray);
      y = top + 2 * r + 20;
    } else {
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
      const out = !(c && c.measured) && ((instOf(s) && (instOf(s).excluded || []).includes(k)) || (c && c.skipped));
      text(c && c.measured ? dbm(c.bestRssi) + (win ? ' · ' + T('cea mai bună') : '') : out ? T('sărită') : T('fără măsurătoare'), P + 600, ly, win ? INK.green : c && c.measured ? INK.ink : INK.gray);
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

    }
    if (!internalOnly) {
    section(T('Confirmare finală'));
    const f = s.finalCheck;
    if (f && f.rssi !== null) row(f.ok ? 'OK' : '!', T('{0} · {1} dB față de cea mai bună măsurătoare ({2})', dbm(f.rssi), (f.deltaDb >= 0 ? '+' : '') + f.deltaDb, dbm(f.winnerRssi)), f.ok ? INK.green : INK.red);
    else row('', f ? T('Receptorul principal nu a răspuns') : T('Fără confirmare finală'), INK.red);
    }
    }

    section(T('Receptoare'));
    const where = (q) => [q.siteName, q.address].filter(Boolean).join(', ');
    const p1 = shown.find((q) => q.relation === 'PRIMARY');
    row(T('Receptor principal'), p1 ? [p1.serial, dbm(p1.bestRssi), where(p1)].filter(Boolean).join(' · ') : '–');
    const b = s.backup;
    const occasional = b && b.age && b.age !== 'CURRENT';
    row(T('Rezervă'), b ? [b.serial, dbm(b.bestRssi), T(RELATION_RO[b.redundancy] || 'site necunoscut'), b.siteName,
      occasional ? T('doar ocazional – nu contează ca redundanță') : null].filter(Boolean).join(' · ') : T('niciuna'), b && !occasional ? INK.ink : INK.gray);
    y += 16;
    for (const q of shown.slice(0, 10)) {
      y += 36; font(500, 23);
      const old = q.age === 'OLD', ageCol = q.age === 'CURRENT' ? INK.green : q.age === 'OCCASIONAL' ? INK.amber : INK.gray;
      text(q.serial, P, y, old ? INK.gray : INK.ink); text(dbm(q.bestRssi), P + 250, y, old ? INK.gray : INK.ink, 'right');
      if (q.bestPhase === 'check') {
        text(q.observedUtc ? ago(q.observedUtc) : '–', P + 280, y, ageCol);
        font(700, 19); text(T(AGE_RO[q.age] || ''), P + 500, y, ageCol); font(500, 23);
      } else text(T(RELATION_RO[q.relation]), P + 280, y, INK.gray);
      font(500, 21);
      text((wrap(where(q) + (q.distanceM !== null ? ' · ' + meters(q.distanceM) : ''), W - 2 * P - 660)[0] || ''), P + 660, y, INK.gray);
    }
    if (shown.length > 10) { y += 34; font(500, 20); text(T('… și încă {0}', shown.length - 10), P, y, INK.gray); }
    if (staleCount) {
      y += 34; font(500, 20);
      text(T(staleCount === 1 ? '1 concentrator văzut ultima dată acum peste {1} ore nu este inclus în raport.' : '{0} concentratoare văzute ultima dată acum peste {1} ore nu sunt incluse în raport.', staleCount, REPORT_MAX_AGE_H), P, y, INK.gray);
    }
    y += 18; font(500, 19);
    for (const l of wrap(limitsText(isCheck), W - 2 * P)) { y += 28; text(l, P, y, INK.gray); }
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
      [`400 ${Math.round(u * 0.8)}px ${SANS}`, (s.session.install ? installShort(s.session.install) + ' · ' : '') + (s.session.gps.lat !== null ? `${s.session.gps.lat.toFixed(5)}, ${s.session.gps.lon.toFixed(5)} · ` : '')
        + `LinkIQ Field Assistant v${VERSION}` + (s.session.demo ? ' · DEMO' : '')],
    ];
    x.textAlign = 'left'; x.textBaseline = 'alphabetic'; x.fillStyle = '#fff';
    x.shadowColor = 'rgba(0,0,0,0.8)'; x.shadowBlur = u * 0.3;
    let y = H - bh + u * 1.3;
    for (const [fontSpec, str] of lines) { x.font = fontSpec; x.fillText(str, u, y, maxW); y += u * 1.95; }
    return c;
  }

  let lastPhoto = null;        // stamped antenna photo of this session, for the PDF

  // ---- report folder: the installer picks a place once, every report lands there.
  // Uses the File System Access API where the browser has it; otherwise normal downloads.
  const canPickDir = 'showDirectoryPicker' in window && window.isSecureContext;
  let reportDir = null;
  const kv = (() => {
    let opening = null;
    const open = () => opening || (opening = new Promise((ok, fail) => {
      const r = indexedDB.open('linkiq', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error);
    }));
    return {
      get: async (k) => { const db = await open(); return new Promise((ok, fail) => { const r = db.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); }); },
      set: async (k, v) => { const db = await open(); return new Promise((ok, fail) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => ok(); t.onerror = () => fail(t.error); }); },
    };
  })();

  /** True when the chosen folder may be written. `ask` may show the browser's permission prompt (needs a tap). */
  async function dirReady(ask) {
    if (!reportDir) return false;
    try {
      let perm = await reportDir.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted' && ask) perm = await reportDir.requestPermission({ mode: 'readwrite' });
      return perm === 'granted';
    } catch { return false; }
  }

  // The browser forgets the folder permission when the app is closed. It is asked for with
  // one tap at the start (banner, or the first "start"), never while a report is being saved,
  // and a prompt that gets lost behind the app can no longer lock it: after 10 s we go on.
  let dirPerm = 'none';
  async function updateDirPerm() {
    dirPerm = !reportDir ? 'none' : await reportDir.queryPermission({ mode: 'readwrite' }).catch(() => 'prompt');
    const need = dirPerm === 'prompt' || dirPerm === 'denied';
    for (const id of ['dir-allow', 'dir-allow2']) {
      const el = $(id);
      el.hidden = !need;
      if (reportDir) el.querySelector('button').textContent = T('Permite salvarea în dosarul „{0}”', reportDir.name);
    }
    showPerm();
    return dirPerm;
  }

  // Start-up card: what the app needs, asked by the installer's own tap, before any work.
  let camPerm = 'unknown';
  async function updateCamPerm() {
    try {
      const st = await navigator.permissions.query({ name: 'camera' });
      camPerm = st.state;
      st.onchange = () => { camPerm = st.state; showPerm(); };
    } catch { camPerm = 'unknown'; }
    showPerm();
  }
  function showPerm() {
    const cam = $('perm-cam'), dir = $('dir-allow');
    cam.hidden = camPerm === 'granted' || !navigator.mediaDevices;
    cam.querySelector('button').hidden = camPerm === 'denied';
    cam.querySelector('.pl').textContent = camPerm === 'denied' ? T('Camera este blocată: permite-o din setările browserului (lacătul de lângă adresă).') : T('Camera');
    $('perm-card').hidden = cam.hidden && dir.hidden;
  }
  $('perm-cam').querySelector('button').onclick = async () => {
    try {
      const st = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      st.getTracks().forEach((t) => t.stop());
      camPerm = 'granted';
    } catch (e) { if (e && e.name === 'NotAllowedError') camPerm = 'denied'; }
    updateCamPerm();
  };
  function askDir() {                       // call straight from a tap, before any await
    if (!reportDir || dirPerm === 'granted') return Promise.resolve(dirPerm === 'granted');
    const req = reportDir.requestPermission({ mode: 'readwrite' }).catch(() => 'denied');
    const late = new Promise((ok) => setTimeout(() => ok('timeout'), 10000));
    return Promise.race([req, late]).then(async () => { await updateDirPerm(); refreshReportDir(); return dirPerm === 'granted'; });
  }

  async function writeToDir(blob, name) {
    let final = name;
    try {                                   // keep an earlier report of the same meter: add date and time
      await reportDir.getFileHandle(name);
      const d = new Date(), two = (v) => String(v).padStart(2, '0');
      final = name.replace(/(\.[a-z0-9]+)$/i, `_${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}$1`);
    } catch { /* no such file yet */ }
    const handle = await reportDir.getFileHandle(final, { create: true });
    const w = await handle.createWritable();
    await w.write(blob); await w.close();
    return final;
  }

  async function refreshReportDir() {
    const info = $('dir-info'), list = $('dir-list'), btn = $('dir-btn'), open = $('dir-open');
    $('dir-card').hidden = false;
    list.replaceChildren();
    open.hidden = true;
    if (!canPickDir) {
      btn.hidden = true;
      info.textContent = T('Acest browser salvează rapoartele în dosarul de descărcări.');
      $('dir-info2').textContent = info.textContent;
      return;
    }
    btn.hidden = false;
    btn.textContent = T(reportDir ? 'Schimbă dosarul' : 'Alege dosarul');
    $('dir-none').hidden = !reportDir;
    if (!reportDir) {
      info.textContent = T('Alege o dată locul; aplicația creează acolo dosarul „LinkIQ-rapporter” și salvează în el toate rapoartele.');
      $('dir-info2').textContent = T('Acest browser salvează rapoartele în dosarul de descărcări.');
      return;
    }
    info.textContent = T('Rapoartele se salvează în dosarul „{0}”.', reportDir.name);
    $('dir-info2').textContent = info.textContent;
    await updateDirPerm();
    if (dirPerm !== 'granted') { open.hidden = false; return; }     // the browser wants a tap before it uses the folder again
    const files = [];
    try {
      for await (const [name, h] of reportDir.entries()) {
        if (h.kind !== 'file' || files.length >= 300) continue;
        const f = await h.getFile();
        files.push({ name, h, at: f.lastModified });
      }
    } catch { return; }
    files.sort((x, y) => y.at - x.at);
    info.textContent += ' ' + T('{0} fișiere în dosar', files.length) + '.';
    for (const f of files.slice(0, 12)) {
      const li = document.createElement('li');
      li.setAttribute('role', 'button'); li.tabIndex = 0;
      const n = document.createElement('span'); n.textContent = f.name;
      const d = document.createElement('span'); d.className = 'sub'; d.textContent = fmtTime(new Date(f.at).toISOString());
      li.append(n, document.createElement('span'), d);
      li.onclick = async () => { try { window.open(URL.createObjectURL(await f.h.getFile()), '_blank'); } catch { /* removed meanwhile */ } };
      list.appendChild(li);
    }
  }

  $('dir-btn').onclick = async () => {
    try {
      const picked = await window.showDirectoryPicker({ id: 'linkiq-reports', mode: 'readwrite', startIn: 'documents' });
      // one tidy folder of our own, unless the installer already picked it
      reportDir = /linkiq/i.test(picked.name) ? picked : await picked.getDirectoryHandle('LinkIQ-rapporter', { create: true });
      try { await kv.set('reportDir', reportDir); } catch { /* remembered for this visit only */ }
    } catch (e) { if (e.name !== 'AbortError') showError('start-error', T('Nu am putut folosi dosarul ales: {0}', e.message)); }
    refreshReportDir();
  };
  $('dir-open').onclick = () => askDir();
  $('dir-allow').querySelector('button').onclick = () => askDir();
  $('dir-allow2').querySelector('button').onclick = () => askDir();
  $('dir-none').onclick = async () => {
    reportDir = null;
    try { await kv.set('reportDir', null); } catch { /* nothing kept */ }
    await updateDirPerm(); refreshReportDir();
  };

  async function saveBlob(blob, name, doneKey, previewUrl) {
    const msg = $('report-msg'), img = $('report-preview');
    const url = URL.createObjectURL(blob);
    let saved = null;
    if (await dirReady(false)) { try { saved = await writeToDir(blob, name); } catch { saved = null; } }
    const noPerm = !saved && reportDir && dirPerm !== 'granted';
    if (!saved) {                           // no folder chosen, or the browser cannot write there: normal download
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
    }
    if (previewUrl !== null) { img.src = previewUrl || url; img.alt = name; img.hidden = false; }   // also shown, so it can be saved by long-press
    msg.textContent = saved ? T('Salvat în dosarul „{0}” ca {1}.', reportDir.name, saved)
      : T(doneKey, name) + (noPerm ? ' ' + T('Fără permisiune pentru dosar: fișierul e în Descărcări.') : '')
        + (previewUrl !== null ? ' ' + T('Dacă descărcarea nu pornește, ține apăsat pe imagine și alege „Salvează”.') : '');
    msg.hidden = false;
    if (saved) refreshReportDir();
    if (S && /\.(pdf|png)$/i.test(name)) vqUpsert(saved || name, blob);
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

  $('report-btn').onclick = () => S && askReadings(savePng);
  async function savePng() {
    if (!S) return;
    try { await saveBlob(await canvasBlob(await buildReport(S), 'image/png'), reportName(S) + '.png', 'Raportul a fost salvat ca {0}.'); }
    catch (e) { showError('align-error', T('Nu am putut crea fișierul: {0}', e.message)); }
  }
  $('report-pdf-btn').onclick = () => S && askReadings(savePdf);
  async function savePdf() {
    if (!S) return;
    try {
      const pages = [await buildReport(S)];
      if (lastPhoto && S.session.status !== 'CHECK') pages.push(lastPhoto);
      await saveBlob(pdfFromCanvases(pages), reportName(S) + '.pdf', pages.length > 1 ? 'Raportul PDF, cu fotografia antenei, a fost salvat ca {0}.' : 'Raportul PDF a fost salvat ca {0}.', null);
    } catch (e) { showError('align-error', T('Nu am putut crea fișierul: {0}', e.message)); }
  }
  $('photo-file').onchange = async (ev) => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file || !S) return;
    try {
      lastPhoto = await stampPhoto(file, S);
      await saveBlob(await canvasBlob(lastPhoto, 'image/jpeg'), safeName(S.session.meterSerial) + '_antenne.jpg', 'Fotografia cu datele măsurătorii a fost salvată ca {0}.');
    } catch (e) { showError('align-error', T('Nu am putut crea fișierul: {0}', e.message)); }
  };

  // ---------------------------------------------------------------- meter readings
  // Optional: the register values on the meter's own display, read with the camera
  // (lcd.js, on the phone, offline) and always editable before they go in the report.
  // A small picture of the display is kept with each value as evidence.
  const REGS = [
    { k: 'E1', ro: 'Energie termică', units: ['kWh', 'MWh', 'GJ'], n: 8, main: true },
    { k: 'V1', ro: 'Volum', units: ['m³'], n: 8, main: true },
    { k: 'HR', ro: 'Ore de funcționare', units: ['h'], main: true },
    { k: 'E8', ro: 'm³ × t1 (tur)', units: ['m³·°C'], n: 8, main: true },
    { k: 'E9', ro: 'm³ × t2 (retur)', units: ['m³·°C'], n: 8, main: true },
    { k: 'V2', ro: 'Volum 2', units: ['m³'], n: 8 },
    { k: 'E2', ro: 'Energie de răcire', units: ['kWh', 'MWh', 'GJ'], n: 8 },
    { k: 'E3', ro: 'Energie E3', units: ['kWh', 'MWh', 'GJ'], n: 8 },
    { k: 'INFO', ro: 'Cod info', units: [''] },
    { k: 't1', ro: 'Temperatură tur', units: ['°C'] },
    { k: 't2', ro: 'Temperatură retur', units: ['°C'] },
    { k: 't1-t2', ro: 'Diferență de temperatură', units: ['K'] },
    { k: 'Q', ro: 'Debit', units: ['l/h', 'm³/h'] },
    { k: 'P', ro: 'Putere', units: ['kW', 'MW'] },
    { k: 'qp', ro: 'Debit nominal', units: ['m³/h'] },
    { k: 'P/l', ro: 'Impulsuri pe litru', units: [''] },
    { k: 'TA2', ro: 'Registru tarifar TA2', units: [''] },
    { k: 'TA3', ro: 'Registru tarifar TA3', units: [''] },
    { k: 'A1', ro: 'Registru A1', units: [''] },
    { k: 'A2', ro: 'Registru A2', units: [''] },
    { k: '*', ro: 'Alt registru', units: [''] },
  ];
  const regOf = (k) => REGS.find((r) => r.k === k) || REGS[REGS.length - 1];
  const SRC_RO = { camera: 'citit cu camera', edited: 'corectat de montor', manual: 'introdus de montor' };

  function readings() {
    const meter = S ? S.session.meterSerial : null;
    if (!Array.isArray(ui.readings) || ui.readingsMeter !== meter) {
      ui.readings = [];
      ui.readingsMeter = meter;
    }
    // the permanent registers always come first, in their fixed order
    const mains = REGS.filter((r) => r.main).map((reg) => ui.readings.find((r) => r.k === reg.k) || { k: reg.k, unit: reg.units[0], value: '' });
    const extras = ui.readings.filter((r) => !regOf(r.k).main);
    ui.readings = mains.concat(extras);
    return ui.readings;
  }
  const filledReadings = () => readings().filter((r) => r.value || r.img);
  const saveReadings = () => store.set('ui', ui);
  const cleanValue = (v) => String(v || '').replace(/,/g, '.').replace(/[^0-9.\-]/g, '').slice(0, 16);

  function renderReadings() {
    const list = $('readings-list');
    list.replaceChildren();
    readings().forEach((r, i) => {
      const reg = regOf(r.k), li = document.createElement('li');
      const head = document.createElement('div'); head.className = 'rk';
      if (r.k === '*') {
        const name = document.createElement('input');
        name.placeholder = T('Numele registrului'); name.value = r.label || ''; name.maxLength = 30;
        name.onchange = () => { r.label = name.value.trim(); saveReadings(); };
        head.append(name);
      } else {
        const small = document.createElement('small');
        small.textContent = T(reg.ro);
        head.append(r.k + ' ', small);
      }
      li.append(head);
      if (!reg.main) {
        const rm = document.createElement('button');
        rm.type = 'button'; rm.className = 'rm'; rm.textContent = '✕'; rm.setAttribute('aria-label', T('Șterge'));
        rm.onclick = () => {
          if ((r.value || r.img) && !confirm(T('Ștergi citirea {0} deja introdusă?', r.k === '*' ? (r.label || T('Alt registru')) : r.k))) return;
          readings().splice(i, 1); saveReadings(); renderReadings();
        };
        li.append(rm);
      } else li.append(document.createElement('span'));
      const row = document.createElement('div'); row.className = 'rv';
      const val = document.createElement('input');
      val.inputMode = 'decimal'; val.autocomplete = 'off'; val.value = r.value || ''; val.placeholder = '–';
      val.setAttribute('aria-label', r.k);
      val.onchange = () => {
        r.value = cleanValue(val.value); val.value = r.value;
        r.src = r.read ? (r.value === r.read ? 'camera' : 'edited') : (r.value ? 'manual' : null);
        r.ts = r.ts || new Date().toISOString();
        saveReadings(); renderReadings();
      };
      row.append(val);
      if (reg.units.length > 1) {
        const sel = document.createElement('select');
        for (const u of reg.units) sel.add(new Option(u, u, false, u === r.unit));
        sel.onchange = () => { r.unit = sel.value; saveReadings(); };
        row.append(sel);
      } else if (reg.units[0]) {
        const u = document.createElement('span'); u.className = 'unit'; u.textContent = reg.units[0]; row.append(u);
      }
      const cam = document.createElement('button');
      cam.type = 'button'; cam.className = 'cam primary'; cam.textContent = '📷';
      cam.setAttribute('aria-label', T('Citește {0} cu camera', r.k));
      cam.onclick = () => lcdReader.open(r);
      row.append(cam);
      li.append(row);
      if (r.img || r.src) {
        const st = document.createElement('div');
        st.className = 'rs' + (r.src === 'edited' ? ' edited' : '');
        if (r.img) { const im = document.createElement('img'); im.src = r.img; im.alt = ''; st.append(im); }
        const t = document.createElement('span');
        t.textContent = r.src === 'edited' ? T('corectat de montor; camera a citit {0}', r.read) : r.src ? T(SRC_RO[r.src]) : T('doar poza');
        st.append(t);
        li.append(st);
      }
      list.append(li);
    });
    // Optional registers: tick the ones wanted, several at a time.
    const box = $('readings-extra');
    box.replaceChildren();
    const have = new Set(readings().map((r) => r.k));
    for (const reg of REGS.filter((q) => !q.main)) {
      const lab = document.createElement('label'), cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = have.has(reg.k);
      cb.onchange = () => toggleExtra(reg, cb);
      lab.append(cb, ' ' + (reg.k === '*' ? T(reg.ro) : `${reg.k} – ${T(reg.ro)}`));
      box.append(lab);
    }
    const n = readings().filter((r) => !regOf(r.k).main).length;
    $('readings-more-sum').textContent = n ? T('Alte registre ({0} alese)', n) : T('Alte registre');
  }
  function toggleExtra(reg, cb) {
    const list = readings();
    if (cb.checked) list.push({ k: reg.k, unit: reg.units[0], value: '' });
    else {
      const has = list.filter((r) => r.k === reg.k && (r.value || r.img));
      if (has.length && !confirm(T('Ștergi citirea {0} deja introdusă?', reg.k === '*' ? T(reg.ro) : reg.k))) { cb.checked = true; return; }
      ui.readings = list.filter((r) => r.k !== reg.k);
    }
    saveReadings();
    const open = $('readings-more').open;
    renderReadings();
    $('readings-more').open = open;
  }

  // Live camera: the display is held inside a 2:1 frame; each frame is read and a
  // value is taken once the same text has come back several times.
  const lcdReader = (() => {
    let stream = null, timer = null, target = null, voter = null, startedAt = 0, best = null, seenAt = 0;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const digitCount = (t) => (t.match(/\d/g) || []).length;

    function frameRegion(v) {
      const vw = v.videoWidth, vh = v.videoHeight, vr = v.getBoundingClientRect(), fr = $('lcd-frame').getBoundingClientRect();
      const k = Math.max(vr.width / vw, vr.height / vh);
      const dx = (vr.width - vw * k) / 2, dy = (vr.height - vh * k) / 2;
      let sx = (fr.left - vr.left - dx) / k, sy = (fr.top - vr.top - dy) / k, sw = fr.width / k, sh = fr.height / k;
      sx = Math.max(0, sx); sy = Math.max(0, sy); sw = Math.min(vw - sx, sw); sh = Math.min(vh - sy, sh);
      return [sx, sy, sw, sh];
    }
    function snapshot(src, region) {
      const c = document.createElement('canvas'), [sx, sy, sw, sh] = region;
      const k = Math.min(1, 420 / sw);
      c.width = Math.round(sw * k); c.height = Math.round(sh * k);
      c.getContext('2d').drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.72);
    }
    function grab(src, region) {
      const [sx, sy, sw, sh] = region, k = Math.min(1, 720 / sw);
      canvas.width = Math.round(sw * k); canvas.height = Math.round(sh * k);
      ctx.drawImage(src, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      return window.LinkIQLcd.readLcd(ctx.getImageData(0, 0, canvas.width, canvas.height));
    }
    function setUse() {
      $('lcd-use').textContent = best ? T('Folosește {0}', best.text) : T('Păstrează poza, scriu eu valoarea');
    }
    async function open(r) {
      target = r; best = null; seenAt = 0;
      const reg = regOf(r.k);
      voter = new window.LinkIQLcd.Voter(3, 10);
      $('lcd-title').textContent = `${r.k === '*' ? (r.label || T('Alt registru')) : r.k} · ${T(reg.ro)}`;
      $('lcd-tip').textContent = T('Arată {0} pe contor și ține tot afișajul în chenar.', r.k === '*' ? T('registrul') : r.k);
      $('lcd-live').textContent = '…';
      $('lcd-frame').className = 'lcd-frame';
      $('lcd-error').hidden = true; $('lcd-torch').hidden = true;
      setUse();
      $('lcd-reader').hidden = false;
      startedAt = Date.now();
      try {
        if (!window.isSecureContext || !navigator.mediaDevices) throw new Error(T('Camera live cere o adresă sigură (HTTPS sau localhost). Apasă „Fotografiază”.'));
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        const v = $('lcd-video');
        v.srcObject = stream;
        await v.play();
        const track = stream.getVideoTracks()[0], caps = track.getCapabilities ? track.getCapabilities() : {};
        if (caps.torch) $('lcd-torch').hidden = false;
        if (caps.focusMode && caps.focusMode.includes('continuous')) track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
        loop();
      } catch (e) {
        showError('lcd-error', e.name === 'NotAllowedError' ? T('Permite accesul la cameră din setările browserului.') : e.message);
      }
    }
    function loop() {
      if (!stream) return;
      const v = $('lcd-video');
      if (v.readyState >= 2 && v.videoWidth) {
        try {
          const region = frameRegion(v), res = grab(v, region);
          const want = regOf(target.k).n;
          const ok = res.text && res.text.indexOf('?') < 0;
          if (res.kind !== 'none') seenAt = Date.now();
          $('lcd-frame').className = 'lcd-frame' + (ok ? ' seen' : '');
          $('lcd-live').textContent = res.text || '…';
          const vote = voter.add(ok ? res : null);
          if (ok && vote.text === res.text) { best = { text: res.text, img: snapshot(v, region) }; setUse(); }
          // The main registers show 8 digits; another count is taken only when it is very steady.
          const need = !want || !vote.text || vote.text === '---' || digitCount(vote.text) === want ? 3 : 6;
          if (vote.count >= need && best && best.text === vote.text) { finish(best, 'camera'); return; }
          if (!seenAt && Date.now() - startedAt > 4000) $('lcd-tip').textContent = T('Nu văd cifre. Apropie telefonul; dacă lumina se reflectă în geam, înclină-l puțin sau stinge lanterna.');
          else if (seenAt && !best && Date.now() - startedAt > 6000) $('lcd-tip').textContent = T('Cifrele nu se citesc sigur. Ține telefonul nemișcat, drept în fața afișajului, fără reflexii.');
        } catch { /* next frame */ }
      }
      timer = setTimeout(loop, 140);
    }
    function finish(res, how) {
      const r = target;
      close();
      if (res && res.text) { r.value = cleanValue(res.text); r.read = r.value; r.src = how; }
      else if (!r.value) r.src = null;
      if (res && res.img) r.img = res.img;
      r.ts = new Date().toISOString();
      saveReadings(); renderReadings();
      if (navigator.vibrate && res && res.text) navigator.vibrate(80);
    }
    function close() {
      clearTimeout(timer);
      if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
      $('lcd-video').srcObject = null;
      $('lcd-reader').hidden = true;
    }
    $('lcd-close').onclick = close;
    $('lcd-use').onclick = () => {
      if (best) { finish(best, 'camera'); return; }
      const v = $('lcd-video');
      finish(v.videoWidth ? { text: '', img: snapshot(v, frameRegion(v)) } : null, 'manual');
    };
    $('lcd-torch').onclick = async () => {
      if (!stream) return;
      const track = stream.getVideoTracks()[0], on = !track.getSettings().torch;
      try { await track.applyConstraints({ advanced: [{ torch: on }] }); } catch { /* not supported after all */ }
    };
    // Photo from the phone's camera app: try display-sized windows around the centre.
    $('lcd-photo-btn').onclick = () => $('lcd-photo').click();
    $('lcd-photo').onchange = async (ev) => {
      const file = ev.target.files[0];
      ev.target.value = '';
      if (!file || !target) return;
      try {
        const bmp = await createImageBitmap(file), W = bmp.width, H = bmp.height;
        let found = null;
        for (const f of [0.55, 0.7, 0.85, 0.4, 1]) {
          for (const cy of [0.45, 0.35, 0.55]) {
            const sw = W * f, sh = Math.min(H, sw / 2), region = [(W - sw) / 2, Math.max(0, Math.min(H - sh, H * cy - sh / 2)), sw, sh];
            const res = grab(bmp, region);
            const score = res.text && res.text.indexOf('?') < 0 ? res.quality + digitCount(res.text) / 10 : 0;
            if (score > (found ? found.score : 0)) found = { score, text: res.text, img: snapshot(bmp, region) };
          }
        }
        if (found) finish(found, 'camera');
        else {
          const sw = W * 0.7, sh = Math.min(H, sw / 2);
          finish({ text: '', img: snapshot(bmp, [(W - sw) / 2, (H - sh) / 2, sw, sh]) }, 'manual');
          showError('align-error', T('Nu am putut citi cifrele din poză. Poza este păstrată; scrie valoarea de mână.'));
        }
      } catch (e) { showError('lcd-error', T('Nu am putut citi fotografia: {0}', e.message)); }
    };
    return { open, close };
  })();

  // Asked once per session before a report is saved, while no value has been entered.
  function askReadings(then) {
    if (ui.readingsAsked || filledReadings().length) { then(); return; }
    ui.readingsAsked = true; saveReadings();
    $('readings-ask').hidden = false;
    $('ask-no').onclick = () => { $('readings-ask').hidden = true; then(); };
    $('ask-yes').onclick = () => {
      $('readings-ask').hidden = true;
      const card = $('readings-card');
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash');
      const first = readings().find((r) => !r.value);
      if (first) lcdReader.open(first);
    };
  }

  /** Report section with the readings and the picture of the display beside each value. */
  async function drawReadings(x, P, W, y, section, font, text) {
    const list = filledReadings();
    if (!list.length) return y;
    y = section(T('Citirile contorului'));
    for (const r of list) {
      const reg = regOf(r.k), top = y + 18;
      let img = null;
      if (r.img) { try { img = new Image(); img.src = r.img; await img.decode(); } catch { img = null; } }
      const ih = 104, iw = img ? Math.round(ih * img.width / img.height) : 0;
      font(800, 28); text(r.k === '*' ? (r.label || T('Alt registru')) : r.k, P, top + 34);
      font(500, 20); text(r.k === '*' ? '' : T(reg.ro), P, top + 62, INK.gray);
      font(800, 40); x.fillStyle = r.src === 'edited' ? INK.amber : INK.ink; x.textAlign = 'left';
      x.fillText(r.value ? `${r.value} ${r.unit || ''}`.trim() : '–', P + 250, top + 44, W - 2 * P - 250 - (img ? iw + 16 : 0));
      font(500, 20);
      const how = r.src === 'edited' ? T('corectat de montor; camera a citit {0}', r.read) : r.src ? T(SRC_RO[r.src]) : T('doar poza');
      const room = W - 2 * P - 250 - (img ? iw + 16 : 0);
      x.fillStyle = r.src === 'edited' ? INK.amber : INK.gray; x.textAlign = 'left';
      x.fillText(how, P + 250, top + 76, room);
      if (r.ts) x.fillText(fmtTime(r.ts), P + 250, top + 102, room);
      if (img) {
        x.drawImage(img, W - P - iw, top, iw, ih);
        x.strokeStyle = INK.light; x.lineWidth = 2; x.strokeRect(W - P - iw, top, iw, ih);
      }
      y = top + ih + 6;
    }
    font(500, 19);
    text(T(list.some((r) => r.img) ? 'Valorile vin de pe afișajul contorului; montorul le-a verificat. Poza afișajului e alături.' : 'Valorile vin de pe afișajul contorului; montorul le-a verificat.'), P, y + 30, INK.gray);
    return y + 40;
  }

  // ---------------------------------------------------------------- feedback
  // The app has no server of its own, so feedback leaves through the phone's share
  // sheet (Teams, mail) or the clipboard. Technical context is added automatically;
  // meter serials and positions are never included.
  let fbType = null;
  function techLine() {
    const ua = navigator.userAgent;
    const device = (ua.match(/Android [\d.]+/) || ua.match(/iPhone OS [\d_]+/) || ua.match(/Windows NT [\d.]+/) || ['?'])[0].replace(/_/g, '.');
    const browser = (ua.match(/(?:Chrome|CriOS|Firefox|Version)\/\d+/) || ['?'])[0];
    const reg = engine ? engine.registryInfo() : null;
    const parts = [`LinkIQ v${VERSION}`, device, browser, `${screen.width}×${screen.height}`,
      location.protocol === 'file:' || location.protocol === 'content:' ? 'fil' : location.host,
      engine ? 'uden server' : 'med server', 'sprog ' + lang,
      reg ? `register ${reg.sites}/${reg.concentrators}` + (reg.concentrators ? ' (' + ((engine.db.registrySource || {}).origin || '?') + ')' : '') : null,
      typeof reportDir !== 'undefined' && reportDir ? 'rapportmappe valgt' : 'ingen rapportmappe',
      storageWorks ? null : 'kan ikke gemme data',
      S ? `skærm: ${S.session.status}/${S.session.state}` + (S.session.outcome ? '/' + S.session.outcome : '') : 'skærm: start'];
    return parts.filter(Boolean).join(' · ');
  }
  function feedbackText() {
    const who = ($('tech').value || '').trim();
    return `[LinkIQ feedback · ${T(fbType)}]\n${$('fb-text').value.trim()}\n` + (who ? `\n${T('Instalator')}: ${who}` : '')
      + ($('fb-tech').checked ? `\n— ${techLine()}` : '');
  }
  function drawFeedbackTypes() {
    chipRow($('fb-type'), ['Eroare', 'Propunere', 'Întrebare'].map((k) => [k, T(k)]), fbType, (k) => { fbType = k; drawFeedbackTypes(); });
  }
  function openFeedback() {
    $('fb-msg').hidden = true;
    $('fb-share').hidden = !navigator.share;
    drawFeedbackTypes();
    $('feedback').hidden = false;
  }
  const fbReady = () => {
    if (fbType && $('fb-text').value.trim().length >= 3) return true;
    $('fb-msg').textContent = T('Alege tipul și scrie câteva cuvinte.'); $('fb-msg').hidden = false;
    return false;
  };
  $('fb-open').onclick = openFeedback;
  $('fb-open2').onclick = openFeedback;
  $('fb-close').onclick = () => { $('feedback').hidden = true; };
  $('fb-share').onclick = async () => {
    if (!fbReady()) return;
    try { await navigator.share({ title: 'LinkIQ feedback', text: feedbackText() }); $('fb-text').value = ''; $('feedback').hidden = true; }
    catch (e) { if (e.name !== 'AbortError') { $('fb-msg').textContent = T('Nu am putut deschide trimiterea. Folosește „Copiază textul”.'); $('fb-msg').hidden = false; } }
  };
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch {                                   // older browsers, or the page opened as a file
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { /* nothing more to try */ }
      ta.remove();
      return ok;
    }
  }
  $('fb-copy').onclick = async () => {
    if (!fbReady()) return;
    await copyText(feedbackText());
    $('fb-msg').textContent = T('Text copiat. Lipește-l în grupul de Teams.'); $('fb-msg').hidden = false;
  };

  // ---------------------------------------------------------------- result for VVS-dialog
  // The installer chooses fixed words once, in the report; the "li" bookmark writes exactly
  // these words to "Ny aktivitet" and picks the case status. Words: vvstext.js (RPA reads them).
  const VT = window.LINKIQ_VVS_TEXT || { results: [], faults: [], faultPrefix: 'Fejl ', commentPrefix: '', statuses: [] };
  function vvsState() {
    const meter = S ? S.session.meterSerial : null;
    if (!ui.vvs || ui.vvs.meter !== meter) ui.vvs = { meter, result: null, faults: [], status: VT.statuses[0] || null, comment: '' };
    return ui.vvs;
  }
  function vvsText(v) {
    const lines = [];
    if (v.result && !(v.result === 'Fejl' && v.faults.length)) lines.push(v.result);
    for (const f of VT.faults) if (v.faults.includes(f)) lines.push(VT.faultPrefix + f);
    if (v.comment && v.comment.trim()) lines.push(VT.commentPrefix + v.comment.trim().replace(/\s+/g, ' '));
    return lines.join('\n');
  }
  const vvsReady = (v) => !!(v.result || v.faults.length) && !!v.status;
  function renderVvs() {
    const v = vvsState(), save = () => { store.set('ui', ui); renderVvs(); vvsQueueTouch(); };
    chipRow($('ch-vres'), VT.results.map((r) => [r, r]), v.result, (r) => {
      v.result = v.result === r ? null : r;
      if (v.result === VT.results[0]) v.faults = [];          // "all OK" excludes faults
      save();
    });
    $('vfault-row').hidden = v.result === VT.results[0];
    const fr = $('ch-vfault');
    fr.replaceChildren();
    for (const f of VT.faults) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = f;
      const on = v.faults.includes(f);
      b.className = on ? 'on' : ''; b.setAttribute('aria-pressed', String(on));
      b.onclick = () => { v.faults = on ? v.faults.filter((x) => x !== f) : v.faults.concat(f); save(); };
      fr.appendChild(b);
    }
    chipRow($('ch-vstat'), VT.statuses.map((s) => [s, s]), v.status, (s) => { v.status = s; save(); });
    if (document.activeElement !== $('vvs-comment')) $('vvs-comment').value = v.comment || '';
    $('vvs-preview').textContent = vvsText(v) || T('Alege rezultatul.');
  }
  $('vvs-comment').oninput = () => {
    const v = vvsState(); v.comment = $('vvs-comment').value; store.set('ui', ui);
    $('vvs-preview').textContent = vvsText(v) || T('Alege rezultatul.');
  };
  $('vvs-comment').onchange = () => vvsQueueTouch();

  /** Report section: the exact text and status that go to the case. */
  function drawVvsSection(x, P, W, y, section, font, text) {
    const v = vvsState(), t = vvsText(v);
    if (!t) return y;
    y = section(T('Pentru VVS-dialog'));
    font(500, 22); text(T('Statusul cazului'), P, y + 34, INK.gray);
    font(700, 24); text(v.status || '–', P + 300, y + 34);
    y += 40;
    font(500, 22); text(T('Text pentru Ny aktivitet'), P, y + 34, INK.gray);
    font(700, 24);
    for (const line of t.split('\n')) {
      // long comments wrap
      const words = line.split(' '); let cur = '';
      for (const wd of words) {
        if (x.measureText(cur + ' ' + wd).width > W - 2 * P - 300 && cur) { text(cur, P + 300, y + 34); y += 32; cur = wd; }
        else cur = cur ? cur + ' ' + wd : wd;
      }
      text(cur, P + 300, y + 34); y += 32;
    }
    return y + 10;
  }

  // ---------------------------------------------------------------- queue for VVS-dialog
  // Every saved report waits here until "li" has put it on the case. The list on the start
  // page shows what has arrived and what is still waiting; files are kept in IndexedDB.
  const VQ_KEEP_DAYS = 7;
  async function vqLoad() { try { return (await kv.get('vvsq')) || []; } catch { return []; } }
  async function vqSave(q) { try { await kv.set('vvsq', q); } catch { /* no storage */ } renderVq(q); }
  const vqId = () => (S ? (S.session.id || 'chk-' + S.session.meterSerial + '-' + new Date().toISOString().slice(0, 10)) : null);
  async function vqUpsert(fileName, blob) {
    if (!S) return;
    const id = vqId(), v = vvsState(), q = await vqLoad();
    let e = q.find((x) => x.id === id);
    if (!e) { e = { id, meter: String(S.session.meterSerial), created: new Date().toISOString(), files: [], state: 'pending' }; q.unshift(e); }
    if (e.state === 'sent' && (fileName || vvsText(v) !== e.text || v.status !== e.status)) e.state = 'pending';   // changed after sending
    e.text = vvsText(v); e.status = v.status; e.updated = new Date().toISOString();
    if (fileName && blob) {
      const ext = (fileName.match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase();
      const old = e.files.find((f) => f.toLowerCase().endsWith(ext));
      if (old) { e.files = e.files.filter((f) => f !== old); try { await kv.set('vvsf:' + id + ':' + old, null); } catch { /* */ } }
      e.files.push(fileName);
      try { await kv.set('vvsf:' + id + ':' + fileName, blob); } catch { /* */ }
    }
    await vqSave(q);
  }
  async function vvsQueueTouch() {                 // text/status changed after a report was saved
    if (!S) return;
    const q = await vqLoad();
    if (q.some((x) => x.id === vqId())) await vqUpsert();
  }
  async function vqPrune() {
    const q = await vqLoad(), limit = Date.now() - VQ_KEEP_DAYS * 864e5, keep = [];
    for (const e of q) {
      if (e.state === 'sent' && Date.parse(e.updated || e.created) < limit) {
        for (const f of e.files) { try { await kv.set('vvsf:' + e.id + ':' + f, null); } catch { /* */ } }
      } else keep.push(e);
    }
    await vqSave(keep);
  }
  function renderVq(q) {
    const waiting = q.filter((e) => e.state !== 'sent'), today = new Date().toISOString().slice(0, 10);
    const sentToday = q.filter((e) => e.state === 'sent' && (e.updated || e.created).slice(0, 10) === today).length;
    const errors = q.filter((e) => e.state === 'error').length;
    const sum = T('Azi: {0} pe caz · {1} așteaptă', sentToday, waiting.length) + (errors ? ' · ' + T('{0} cu eroare', errors) : '');
    $('vvsq-sum').textContent = q.length ? sum : T('Niciun raport în listă.');
    $('sync-sum').textContent = sum;
    $('vvsq-send').hidden = !waiting.length;
    $('vvsq-send').textContent = T('Trimite cele care așteaptă ({0})', waiting.length);
    const list = $('sync-list');
    list.replaceChildren();
    let day = null;
    for (const e of q) {
      const d = (e.updated || e.created).slice(0, 10);
      if (d !== day) {
        day = d;
        const h = document.createElement('div'); h.className = 'sync-day';
        h.textContent = d === today ? T('Azi') : new Date(d).toLocaleDateString(lang === 'da' ? 'da-DK' : 'ro-RO', { weekday: 'long', day: 'numeric', month: 'long' });
        list.append(h);
      }
      const card = document.createElement('div');
      card.className = 'card sync-item' + (e.state === 'sent' ? ' ok' : e.state === 'error' ? ' err' : '');
      const top = document.createElement('div'); top.className = 'top';
      const a = document.createElement('span'); a.textContent = e.meter;
      const st = document.createElement('span'); st.className = 'st' + (e.state === 'pending' ? ' wait' : '');
      st.textContent = e.state === 'sent' ? T('✓ pe caz {0}', e.cc || '') : e.state === 'error' ? T('eroare') : T('așteaptă');
      top.append(a, st); card.append(top);
      const meta = document.createElement('div'); meta.className = 'meta';
      meta.textContent = [fmtTime(e.updated || e.created), e.status || '', e.files.length ? e.files.join(', ') : T('fără fișiere')].filter(Boolean).join(' · ');
      card.append(meta);
      if (e.text) { const pre = document.createElement('pre'); pre.textContent = e.text; card.append(pre); }
      if (e.state === 'error' && e.msg) { const m = document.createElement('div'); m.className = 'error'; m.textContent = e.msg; card.append(m); }
      if (e.state === 'sent' && e.msg) { const m = document.createElement('div'); m.className = 'meta'; m.textContent = e.msg; card.append(m); }
      const acts = document.createElement('div'); acts.className = 'acts';
      const send = document.createElement('button'); send.type = 'button'; send.className = e.state === 'sent' ? 'secondary' : 'primary';
      send.textContent = e.state === 'sent' ? T('Trimite din nou') : T('Trimite');
      send.onclick = () => openVvs([e]);
      const del = document.createElement('button'); del.type = 'button'; del.className = 'secondary';
      del.textContent = T('Scoate din listă');
      del.onclick = async () => {
        if (e.state !== 'sent' && !confirm(T('Raportul pentru {0} nu a ajuns încă în VVS-dialog. Îl scoți totuși din listă?', e.meter))) return;
        const all = await vqLoad();
        for (const f of e.files) { try { await kv.set('vvsf:' + e.id + ':' + f, null); } catch { /* */ } }
        await vqSave(all.filter((x) => x.id !== e.id));
      };
      acts.append(send, del); card.append(acts);
      list.append(card);
    }
  }
  $('vvsq-open').onclick = () => showView('sync');
  $('sync-back').onclick = () => showView(lastView || 'start');

  // Hand-over to "li": LinkIQ opens VVS-dialog itself, so the page there can ask LinkIQ
  // (window.opener) for the waiting reports and answer with the result of each one.
  // When that link is lost (phone apps), the meter, text and status travel in the tab name,
  // and the installer picks the files in the panel.
  const VVS_ORIGIN = 'https://vvsdialog.kmd.dk';
  let vvsWin = null, vvsOffer = [];
  async function openVvs(items) {
    vvsOffer = items.map((e) => e.id);
    const first = items[0];
    const name = 'linkiq_j' + b64url(new TextEncoder().encode(JSON.stringify(items.slice(0, 30).map((e) => ({ m: e.meter, s: e.status || '', t: e.text || '', id: e.id })))));
    vvsWin = window.open(VVS_HOME + '#linkiq=' + first.meter, name);
  }
  window.addEventListener('message', async (ev) => {
    if (ev.origin !== VVS_ORIGIN || !ev.data || typeof ev.data !== 'object' || !ev.data.liq) return;
    if (vvsWin && ev.source !== vvsWin) return;
    const q = await vqLoad();
    if (ev.data.liq === 'hello') {
      const items = [];
      for (const e of q.filter((x) => vvsOffer.includes(x.id))) {
        const files = [];
        for (const f of e.files) { try { const b = await kv.get('vvsf:' + e.id + ':' + f); if (b) files.push({ name: f, blob: b }); } catch { /* */ } }
        items.push({ id: e.id, meter: e.meter, status: e.status, text: e.text, files });
      }
      ev.source.postMessage({ liq: 'items', items }, VVS_ORIGIN);
    } else if (ev.data.liq === 'result') {
      const e = q.find((x) => x.id === ev.data.id);
      if (!e) return;
      e.state = ev.data.ok ? 'sent' : 'error'; e.msg = ev.data.msg || ''; e.cc = ev.data.cc || e.cc;
      e.updated = new Date().toISOString();
      await vqSave(q);
    }
  });
  $('vvsq-send').onclick = async () => {
    const q = await vqLoad(), waiting = q.filter((e) => e.state !== 'sent');
    if (waiting.length) openVvs(waiting);
  };

  // ---------------------------------------------------------------- VVS-dialog
  // LinkIQ cannot act inside VVS-dialog (another site, the installer's own login).
  // It hands over the meter number three ways - in the address, as the name of the
  // new tab, and on the clipboard - and the installer starts the "li" bookmark there.
  const VVS_HOME = 'https://vvsdialog.kmd.dk/Home.aspx';
  $('vvs-btn').onclick = async () => {
    const m = S ? String(S.session.meterSerial).replace(/\D/g, '') : '';
    if (!m) return;
    const v = vvsState();
    if (!vvsReady(v)) { showError('align-error', T('Alege întâi rezultatul și statusul pentru VVS-dialog.')); $('vvsres-card').scrollIntoView({ behavior: 'smooth' }); return; }
    const q = await vqLoad(), id = vqId();
    let e = q.find((x) => x.id === id);
    const entry = e || { id, meter: m, status: v.status, text: vvsText(v), files: [] };
    openVvs([entry]);                                          // first, while the tap still counts
    if (!e) vqUpsert(); else vvsQueueTouch();
    if (!entry.files.length) $('vvs-msg').textContent = T('Raportul nu e salvat încă: pe caz ajung doar textul și statusul. Salvează raportul și trimite din nou.');
    copyText(m).then((ok) => {
      $('vvs-msg').textContent = ok
        ? T('Seria {0} este copiată. În VVS-dialog scrie li în bara de adrese și alege bookmark-ul cu steluță.', m)
        : T('În VVS-dialog scrie li în bara de adrese și alege bookmark-ul cu steluță. Seria contorului: {0}.', m);
    });
  };
  const vvsCode = window.LINKIQ_VVS_BOOKMARK || '';
  function openVvsSetup() {
    $('vvs-code').value = vvsCode;
    $('vvs-drag').href = vvsCode || '#';
    $('vvs-setup-msg').hidden = true;
    $('vvs-setup').hidden = false;
  }
  $('vvs-setup-open').onclick = openVvsSetup;
  $('vvs-setup-open2').onclick = openVvsSetup;
  $('vvs-setup-close').onclick = () => { $('vvs-setup').hidden = true; };
  $('vvs-drag').onclick = (e) => e.preventDefault();          // it is for dragging to the bookmarks bar
  $('vvs-copy').onclick = async () => {
    const ok = await copyText(vvsCode);
    $('vvs-setup-msg').textContent = ok ? T('Cod copiat. Continuă cu pasul 2.') : T('Nu am putut copia. Selectează textul din câmp și copiază-l.');
    $('vvs-setup-msg').hidden = false;
  };

  // ---------------------------------------------------------------- boot
  (async function boot() {
    $('ver').textContent = 'v' + VERSION;
    translatePage();
    try { reportDir = (await kv.get('reportDir')) || null; } catch { /* no storage: ask again when needed */ }
    refreshReportDir();
    updateCamPerm();
    vqPrune();
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
