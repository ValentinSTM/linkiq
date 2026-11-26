/* LinkIQ Field Assistant - PWA client. Plain JavaScript, no build step, no framework.
   The server owns the session; this file only renders the summary it returns and
   decides which single instruction to show next. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const VERSION = '0.27';
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
    // what counts is a usable link: heard in the last hour AND a signal of at least the marginal
    // limit. Many weak or old links are no reserve, however many there are.
    const parts = [];
    if (c.usable !== undefined) {
      const lim = c.usableDbm || c.marginalDbm;
      parts.push(T('{0} utilizabile (≥ {1} dBm, ultima oră)', c.usable, lim));
      if (c.weak) parts.push(T('{0} slabe (< {1} dBm): nu contează', c.weak, lim));
    } else if (c.current) parts.push(T('{0} cu contact în ultima oră', c.current));
    if (c.occasional) parts.push(T('{0} doar ocazional (1–{1} ore)', c.occasional, c.historyMaxH));
    if (c.old) parts.push(T('{0} fără contact de peste {1} ore (nu contează)', c.old, c.historyMaxH));
    return parts.join(' · ');
  }
  /** Status check verdict: [colour, sentence]. Hourly data is the goal; contact older than 8 h is history only. */
  function contactVerdict(s) {
    const c = s.check && s.check.contact;
    if (!c || !s.receivers.length) return ['red', T('Niciun concentrator de-al nostru nu a auzit contorul.')];
    if (!s.primary) return ['red', T('Fără contact în ultimele {0} ore: datele din această perioadă se pierd.', c.historyMaxH)];
    if (c.usable !== undefined) {
      if (!c.usable) return c.current ? ['red', T('Contact doar cu semnal slab (sub {0} dBm): datele orare se pot pierde.', c.usableDbm || c.marginalDbm)]
        : ['yellow', T('Niciun contact în ultima oră: datele ajung cu întârziere.')];
      if (c.usable >= 2 && c.goodPrimary) return ['green', c.usableSites >= 2 ? T('Date orare, semnal bun și rezervă pe alt site.') : T('Date orare, semnal bun și rezervă pe același site.')];
      // below the marginal limit the hours still arrive, but complete only after retries, sometimes hours later
      const late = s.primary && s.primary.rssi < c.marginalDbm;
      if (c.usable >= 2) return ['yellow', late ? T('Datele ajung pe două căi, dar semnalul principal e slab: orele se completează cu întârziere, uneori de câteva ore.')
        : T('Date orare cu rezervă, dar semnalul principal e doar la limită.')];
      return ['yellow', late ? T('O singură legătură, cu semnal slab: orele se completează cu întârziere și nu există rezervă.')
        : T('O singură legătură utilizabilă: fără rezervă sigură.')];
    }
    if (c.current >= 2) return ['green', T('Date orare, cu redundanță.')];
    if (c.current === 1) return ['yellow', T('Un singur concentrator cu contact în ultima oră: fără redundanță.')];
    return ['yellow', T('Niciun contact în ultima oră: datele ajung cu întârziere.')];
  }
  /** One line with the signal and contact-age limits, so a report can be read on its own. */
  function limitsText(withAge) {
    const th = cfg.thresholds || { goodDbm: -95, marginalDbm: -110 };
    let t = T('Semnal: bun ≥ {0} dBm · la limită {0}…{1} dBm · slab < {1} dBm (praguri provizorii).', th.goodDbm, th.marginalDbm)
      + ' ' + T('O rezervă contează până la {0} dBm: fiecare valoare orară e trimisă de 18 ori pe oră, iar orele lipsă sunt recuperate.', th.usableDbm || -120);
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
    $('lang-btn').textContent = lang === 'da' ? 'Română' : 'Dansk';   // the language you can switch to
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
    setTimeout(renderLeave, 0);
    if (!S) return;
    const s = S, a = nextAction(s), cur = s.current;
    const act = (path, body) => async () => { apply(await api(`/api/sessions/${s.session.id}/${path}`, 'POST', body)); };
    const choose = (patch) => async () => { ui = { ...ui, ...patch }; store.set('ui', ui); };
    $('finish-box').hidden = true;
    $('report-box').hidden = a.kind !== 'done' && a.kind !== 'check';
    // an internal antenna sits in the meter: the installation photos show it, no separate antenna photo
    const inMeter = !!(ui.install && ui.install.antennaType === 'internal');
    $('photo-label').hidden = a.kind === 'check' || inMeter;
    $('photo-hint').hidden = a.kind === 'check' || inMeter;
    $('photo-gal').hidden = a.kind === 'check' || inMeter;
    $('photo-txt').textContent = T('Fotografiază antena');
    $('photo-hint').textContent = T('Fotografiază antena cu datele măsurătorii; pozele cu instalația se fac mai jos. PDF-ul le include pe toate.');
    instPhotos.place(s, a.kind);
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
  // The same three signal colours everywhere: map, legend, report, tags.
  const SIG = { good: '#1b8a3a', mid: '#e07800', weak: '#c62828' };
  /** Line style: solid for contact in the last hour, dashed for occasional, grey dotted for older than 8 h. */
  const linkStyle = (l) => (l.age === 'OLD' ? { color: OLD_GRAY, dash: [4, 8], dashL: '2 8' }
    : { color: linkColor(l.best), dash: l.primary ? [] : l.age === 'OCCASIONAL' ? [14, 10] : [12, 9], dashL: l.primary ? null : '8 8' });
  // Colours follow the PROVISIONAL thresholds: good / marginal / weak.
  const linkColor = (rssi) => {
    const th = cfg.thresholds || { goodDbm: -95, marginalDbm: -110 };
    return rssi >= th.goodDbm ? SIG.good : rssi >= th.marginalDbm ? SIG.mid : SIG.weak;
  };
  const sigClass = (l) => (l.age === 'OLD' ? 'sig-old' : linkColor(l.best) === SIG.good ? 'sig-good' : linkColor(l.best) === SIG.mid ? 'sig-mid' : 'sig-weak');
  const meters = (m) => Math.round(m).toLocaleString(lang === 'da' ? 'da-DK' : 'ro-RO') + ' m';
  const tipNode = (t) => { const e = document.createElement('span'); e.textContent = t; return e; };   // never HTML
  // Text under the map, and a legend drawn with the very colours and lines used on the map.
  function mapInfo(text, legend) {
    $('map-info-text').textContent = text;
    const box = $('map-legend');
    box.replaceChildren();
    box.hidden = !legend;
    if (!legend) return;
    const th = cfg.thresholds || { goodDbm: -95, marginalDbm: -110 };
    const NS = 'http://www.w3.org/2000/svg';
    const sample = (color, dash, width, dot) => {
      const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 44 14'); svg.setAttribute('width', '44'); svg.setAttribute('height', '14');
      if (dot) {
        const c = document.createElementNS(NS, 'circle'); c.setAttribute('cx', '22'); c.setAttribute('cy', '7'); c.setAttribute('r', '6');
        c.setAttribute('fill', color); c.setAttribute('stroke', '#fff'); c.setAttribute('stroke-width', '2'); svg.append(c);
      } else {
        const l = document.createElementNS(NS, 'line'); l.setAttribute('x1', '2'); l.setAttribute('y1', '7'); l.setAttribute('x2', '42'); l.setAttribute('y2', '7');
        l.setAttribute('stroke', color); l.setAttribute('stroke-width', String(width)); if (dash) l.setAttribute('stroke-dasharray', dash); svg.append(l);
      }
      return svg;
    };
    const item = (svg, txt) => { const d = document.createElement('div'); const sp = document.createElement('span'); sp.textContent = txt; d.append(svg, sp); box.append(d); };
    item(sample(SIG.good, null, 4), T('semnal bun, ≥ {0} dBm', th.goodDbm));
    item(sample(SIG.mid, null, 4), T('la limită, {0}…{1} dBm', th.goodDbm, th.marginalDbm));
    item(sample(SIG.weak, null, 4), T('slab, < {0} dBm', th.marginalDbm));
    if (legend.old) item(sample(OLD_GRAY, '2 5', 3), T('fără contact de peste 8 ore'));
    if (legend.lines) {
      item(sample('#55626b', null, 6), T('linie groasă și continuă: receptorul principal'));
      item(sample('#55626b', '8 6', 3), T('linie întreruptă: ceilalți receptori'));
    }
    if (legend.meter) item(sample('#1565c0', null, 0, true), T('contorul'));
  }
  const linkText = (l) => `${Math.round(l.best)} dBm` + (l.distanceM !== null ? ` · ${meters(l.distanceM)}` : '') + (l.age === 'OLD' ? ` · ${T('peste 8 ore')}` : '');
  let lastFit = '';

  async function drawMap() {
    if (!ensureMap()) { mapInfo(T('Harta nu este disponibilă.')); return; }
    mapLayer.clearLayers(); layoutPins = () => {}; if (leaders) leaders.clearLayers();
    $('map-pos').hidden = !S || picking || S.session.gps.lat !== null;
    if (!S) {                                   // no measurement: the sites in the registry
      let sites = [];
      try { sites = (await api('/api/sites')).filter((x) => x.latitude !== null); } catch { /* */ }
      if (S || picking) return;               // the view changed meanwhile
      for (const x of sites) L.circleMarker([x.latitude, x.longitude], { radius: 7, color: '#fff', weight: 3, fillColor: '#55626b', fillOpacity: 1 }).bindTooltip(tipNode(x.name || x.siteCode)).addTo(mapLayer);
      mapInfo(sites.length ? T('Nicio măsurătoare în curs. Harta arată site-urile din registru.') : T('Nicio măsurătoare în curs.'));
      setTimeout(() => {
        map.invalidateSize();
        if (lastFit === 'sites') return;
        lastFit = 'sites';
        if (sites.length > 1) map.fitBounds(sites.map((x) => [x.latitude, x.longitude]), { padding: [40, 40] });
        else map.setView(sites.length ? [sites[0].latitude, sites[0].longitude] : [56, 10.5], sites.length ? 14 : 7);
      }, 0);
      return;
    }
    const g = S && S.session.gps.lat !== null ? S.session.gps : null;
    const links = S ? siteLinks(S) : [];
    const pts = [];
    // Each site a numbered marker; the numbers are explained in the list under the map, so no
    // text sits on the lines and nothing hides the meter. Tap a marker or a line for its details.
    const pins = new Map();
    [...links].reverse().forEach((l) => {           // weakest first, strong lines on top
      const st = linkStyle(l);
      if (g) {
        L.polyline([[g.lat, g.lon], [l.lat, l.lon]], { color: st.color, weight: l.primary ? 6 : 3, dashArray: st.dashL, opacity: l.age === 'OLD' ? 0.7 : 0.9 })
          .bindTooltip(tipNode(linkText(l)), { sticky: true, className: 'link-label ' + sigClass(l) }).addTo(mapLayer);
      }
    });
    links.forEach((l, i) => {
      const el = document.createElement('span'); el.textContent = String(i + 1);
      const icon = L.divIcon({ className: 'site-pin ' + sigClass(l) + (l.primary ? ' primary' : ''), html: el, iconSize: l.primary ? [34, 34] : [28, 28] });
      const mk = L.marker([l.lat, l.lon], { icon, zIndexOffset: l.primary ? 500 : 100 - i, keyboard: false, home: [l.lat, l.lon] })
        .bindTooltip(tipNode(`${i + 1} · ${[l.name, l.address].filter(Boolean).join(', ') || l.serial} · ${linkText(l)}`), { direction: 'top', offset: [0, -14] }).addTo(mapLayer);
      pins.set(l.key, mk);
      pts.push([l.lat, l.lon]);
    });
    if (g) {
      L.marker([g.lat, g.lon], { icon: L.divIcon({ className: 'meter-pin', html: document.createElement('span'), iconSize: [18, 18] }), zIndexOffset: 1000, keyboard: false })
        .bindTooltip(tipNode(T('Contor')), { direction: 'top', offset: [0, -10] }).addTo(mapLayer);
      pts.push([g.lat, g.lon]);
    }
    layoutPins = () => spreadPins(pins, g);
    layoutPins();
    // the list: number, signal, distance, site; a tap shows the site on the map
    const ol = $('map-sites'); ol.replaceChildren(); ol.hidden = !links.length;
    links.forEach((l, i) => {
      const li = document.createElement('li'); li.setAttribute('role', 'button'); li.tabIndex = 0;
      const n = document.createElement('span'); n.className = 'site-pin ' + sigClass(l) + (l.primary ? ' primary' : ''); n.textContent = String(i + 1);
      const t = document.createElement('span'); t.className = 'st';
      const a = document.createElement('b'); a.textContent = linkText(l) + (l.count > 1 ? ' · ' + T('{0} concentratoare', l.count) : '') + (l.primary ? ' · ' + T('principal') : '');
      const b = document.createElement('small'); b.textContent = [l.name, (l.address || '').split(',').slice(0, 2).join(',')].filter(Boolean).join(', ') || l.serial;
      t.append(a, b); li.append(n, t);
      li.onclick = () => { const mk = pins.get(l.key); map.setView([l.lat, l.lon], Math.max(map.getZoom(), 14)); if (mk) mk.openTooltip(); $('map').scrollIntoView({ behavior: 'smooth', block: 'center' }); };
      ol.append(li);
    });
    let info = T('Harta explică doar geometria. Măsurătoarea radio rămâne decisivă.');
    if (links.length) {
      info = T('{0} site-uri au auzit contorul. Numerele de pe hartă sunt în lista de mai jos; atinge un rând ca să vezi site-ul.', links.length)
        + (g ? '' : ' ' + T('Alege poziția contorului (adresă sau hartă) ca să apară liniile și distanțele.'));
    } else if (S && S.warnings.includes('REGISTRY_EMPTY')) info = T('Încarcă registrul (site-uri și concentratoare) pe ecranul de start ca să apară concentratoarele pe hartă.');
    else if (!pts.length) info = T('Fără poziție GPS și fără receptoare cu coordonate. ') + info;
    mapInfo(info, links.length ? { lines: !!g, old: links.some((l) => l.age === 'OLD'), meter: !!g } : null);
    // Many sites far apart crowd around the meter: start close to the meter (the 5 nearest sites),
    // with a button for all of them.
    const nearPts = g ? [[g.lat, g.lon], ...links.filter((l) => l.distanceM !== null).sort((p, q) => p.distanceM - q.distanceM).slice(0, 5).map((l) => [l.lat, l.lon])] : pts;
    const twoViews = !!g && links.length > 5;
    $('map-views').hidden = !twoViews;
    const show = (which) => {
      mapScope = which;
      $('map-near').classList.toggle('on', which === 'near'); $('map-all').classList.toggle('on', which === 'all');
      const p = which === 'near' && twoViews ? nearPts : pts;
      if (p.length > 1) map.fitBounds(p, { padding: [40, 40] });
      else map.setView(p[0] || [56, 10.5], p.length ? 16 : 6);
    };
    $('map-near').onclick = () => show('near');
    $('map-all').onclick = () => show('all');
    const fit = pts.map((q) => q.join(',')).join(';');
    setTimeout(() => {
      map.invalidateSize();
      if (fit === lastFit) return;              // keep the installer's own pan and zoom
      lastFit = fit;
      show(twoViews ? 'near' : 'all');
      layoutPins();
    }, 0);
  }
  let mapScope = 'near';
  // Markers that would overlap each other or the meter at this zoom are moved apart on screen,
  // with a thin line to their true place; zooming in brings them back.
  let layoutPins = () => {}, leaders = null;
  function spreadPins(pins, g) {
    if (!map) return;
    if (leaders) leaders.clearLayers(); else leaders = L.layerGroup().addTo(map);
    const R = 15, list = [...pins.values()].map((mk) => {
      const p = map.latLngToContainerPoint(mk.options.home);
      return { mk, px: p.x, py: p.y, x: p.x, y: p.y };
    });
    const m = g ? map.latLngToContainerPoint([g.lat, g.lon]) : null;
    for (let it = 0; it < 60; it++) {
      let moved = false;
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        for (let j = i + 1; j < list.length; j++) {
          const b = list[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01, need = 2 * R + 4;
          if (d < need) { const k = (need - d) / 2 / d; a.x -= dx * k; a.y -= dy * k; b.x += dx * k; b.y += dy * k; moved = true; }
        }
        if (m) {
          const dx = a.x - m.x, dy = a.y - m.y, d = Math.hypot(dx, dy) || 0.01, need = R + 16;
          if (d < need) { a.x += dx / d * (need - d); a.y += dy / d * (need - d); moved = true; }
        }
      }
      if (!moved) break;
    }
    for (const q of list) {
      const shifted = Math.hypot(q.x - q.px, q.y - q.py) > 2;
      q.mk.setLatLng(shifted ? map.containerPointToLatLng([q.x, q.y]) : q.mk.options.home);
      if (shifted) L.polyline([q.mk.options.home, map.containerPointToLatLng([q.x, q.y])], { color: '#0b1f2a', weight: 1.5, interactive: false }).addTo(leaders);
    }
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

  // Views. The tab bar is always there (except while pairing or picking a position), and every
  // change of view is a step in the browser history, so the phone's back button goes back.
  let lastView = 'start', currentView = null;
  const VIEWS = ['pair', 'start', 'align', 'recv', 'map', 'sync', 'more'];
  function showView(name, opts = {}) {
    if (name === 'home') name = S ? 'align' : 'start';
    if (name === 'align' && !S) name = 'start';
    for (const v of VIEWS) $('view-' + v).hidden = v !== name;
    if (name !== 'sync' && name !== 'more') lastView = name;
    if (name === 'sync') vqLoad().then(renderVq);
    if (name === 'recv' && !S) { $('recv-list').replaceChildren(); $('recv-empty').textContent = T('Nicio măsurătoare în curs. Începe una la „Măsurare”.'); $('recv-empty').hidden = false; $('recv-warn').hidden = true; $('backup-card').hidden = true; }
    $('tabs').hidden = name === 'pair' || picking;
    $('pick-bar').hidden = !(picking && name === 'map');
    $('map-info').hidden = picking;
    const tab = name === 'start' || name === 'align' ? 'home' : name;
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === tab));
    if (name === 'map') { if (picking) drawPickMap(); else drawMap(); }
    if (opts.push !== false && currentView && currentView !== name) { try { history.pushState({ v: name }, ''); } catch { /* */ } }
    else if (!currentView) { try { history.replaceState({ v: name }, ''); } catch { /* */ } }
    currentView = name;
    $('main-scroll').scrollTop = 0;
  }
  window.addEventListener('popstate', (e) => {
    if (!$('viewer').hidden) { viewer.close(false); return; }
    const v = (e.state && e.state.v) || (S ? 'align' : 'start');
    if (picking) { picking = false; if (pickMarker) { pickMarker.remove(); pickMarker = null; } }
    showView(v, { push: false });
  });

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
    renderElsyn();
    renderFs();
    if (navigator.wakeLock) navigator.wakeLock.request('screen').then((w) => { wakeLock = w; }).catch(() => {});
  }

  function leaveSession() {
    S = null; ui = {}; selectedSerial = null;
    store.del('session'); store.del('ui');
    if (pollTimer) { clearInterval(pollTimer); clearInterval(tickTimer); pollTimer = tickTimer = null; }
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    $('meter').value = ''; $('addr').value = '';
    $('scan-info').hidden = true; $('scan-chips').hidden = true;
    $('report-msg').hidden = true; $('report-preview').hidden = true; lastPhoto = null; instPhotos.forget();
    $('vvs-msg').textContent = T('Copiază seria contorului și deschide VVS-dialog. Acolo scrie li în bara de adrese și alege bookmark-ul cu steluță.');
    gps = null;                                // the next meter is somewhere else
    $('gps-info').textContent = T('Măsurarea funcționează și fără GPS. Poziția doar propune site-ul probabil și apare pe hartă.');
    if (locPerm === 'granted') locate(true); else if (locPerm === 'denied') $('gps-info').textContent = T(OFF_TXT);
    $('candidates').hidden = true;
    refreshData();
    renderFs();
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

  // Position: GPS when the device allows it; otherwise (e.g. a PC where company policy turns
  // location off) the address or a tap on the map, which give the same map and distances.
  let locPerm = 'unknown';
  const OFF_TXT = 'Poziția GPS nu este disponibilă pe acest dispozitiv (de exemplu oprită prin politica firmei). Apasă „Adresă sau hartă” și scrie adresa contorului.';
  function locate(silent) {
    if (!navigator.geolocation || !window.isSecureContext) {
      if (!silent) $('gps-info').textContent = T(OFF_TXT);
      return Promise.resolve(false);
    }
    if (!silent) $('gps-info').textContent = T('Caut poziția…');
    return new Promise((ok) => navigator.geolocation.getCurrentPosition((p) => {
      if (silent && gps && gps.accuracyM === null) { ok(false); return; }   // an automatic fix never replaces a position chosen by hand
      gps = { lat: p.coords.latitude, lon: p.coords.longitude, accuracyM: Math.round(p.coords.accuracy) };
      $('gps-info').textContent = T('Poziție GPS luată, precizie ±{0} m.', gps.accuracyM);
      showCandidates(); updateLocPerm(); ok(true);
    }, (err) => {
      if (err.code === 1) locPerm = 'denied';
      if (!silent || err.code !== 3) $('gps-info').textContent = err.code === 3 ? T('Nu am putut lua poziția ({0}). Folosește „Adresă sau hartă” sau continuă fără.', err.message) : T(OFF_TXT);
      updateLocPerm(); ok(false);
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 120000 }));
  }
  async function updateLocPerm() {
    try {
      const st = await navigator.permissions.query({ name: 'geolocation' });
      if (locPerm !== 'denied' || st.state !== 'prompt') locPerm = st.state;
      st.onchange = () => { locPerm = st.state; showPerm(); if (st.state === 'granted' && !gps) locate(true); };
    } catch { if (!navigator.geolocation) locPerm = 'denied'; }
    showPerm();
  }
  $('gps-btn').onclick = () => locate(false);
  $('perm-loc').querySelector('button').onclick = () => locate(false);

  // ---- position without GPS: tap the map, or paste coordinates
  let picking = false, picked = null, pickMarker = null;
  function ensureMap() {
    if (map || !window.L) return !!map;
    map = L.map('map', { zoomControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
    mapLayer = L.layerGroup().addTo(map);
    map.on('click', (e) => { if (picking) setPick(e.latlng.lat, e.latlng.lng, false); });
    map.on('zoomend', () => layoutPins());
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
    mapLayer.clearLayers(); layoutPins = () => {}; if (leaders) leaders.clearLayers();
    let sites = [];
    try { sites = (await api('/api/sites')).filter((x) => x.latitude !== null); } catch { /* map still usable */ }
    for (const x of sites) {
      L.circleMarker([x.latitude, x.longitude], { radius: 7, color: '#fff', weight: 3, fillColor: '#55626b', fillOpacity: 1 })
        .bindTooltip(tipNode(x.name || x.siteCode)).addTo(mapLayer);
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
  $('pick-btn').onclick = () => { picking = true; picked = null; pickedAddr = null; $('pick-ok').disabled = true; $('pick-info').textContent = T('Nicio poziție aleasă.'); showView('map'); };
  $('pick-cancel').onclick = endPick;
  $('map-pos').onclick = () => $('pos-btn').click();
  $('pos-btn').onclick = () => { picking = true; picked = null; $('pick-ok').disabled = true; $('pick-info').textContent = T('Nicio poziție aleasă.'); showView('map'); };
  $('pick-ok').onclick = async () => {
    store.set('lastPos', picked);
    if (S) {                                   // position for the session or status check on screen
      const pos = { lat: picked.lat, lon: picked.lon, accuracyM: null };
      try {
        apply(S.session.status === 'CHECK'
          ? await api('/api/check', 'POST', { meterSerial: S.session.meterSerial, technician: S.session.technician, gps: pos, address: S.session.address || '' })
          : await api(`/api/sessions/${S.session.id}/position`, 'POST', { gps: pos }));
      } catch (e) { showError('align-error', e.status === 404 ? 'Poziția se poate schimba doar în varianta fără server.' : e.message); }
      lastFit = '';
      endPick();
      render();
      return;
    }
    gps = { lat: picked.lat, lon: picked.lon, accuracyM: null };
    if (pickedAddr) $('addr').value = pickedAddr;
    $('gps-info').textContent = T('Poziție aleasă pe hartă: {0}, {1}.', picked.lat.toFixed(5), picked.lon.toFixed(5));
    endPick();
    showCandidates();
  };
  // One field: coordinates ("56.1234, 10.1234", "56,1234 10,1234", a pasted maps link) or an
  // address, looked up in OpenStreetMap (Nominatim) only when the installer asks for it.
  function parseCoords(t) {
    let m = t.match(/(-?\d{1,2}\.\d{3,})[^\d-]+(-?\d{1,3}\.\d{3,})/);
    if (!m) {                                           // decimal commas
      const c = t.match(/(-?\d{1,2}),(\d{3,})[^\d-]+(-?\d{1,3}),(\d{3,})/);
      if (c) m = [t, `${c[1]}.${c[2]}`, `${c[3]}.${c[4]}`];
    }
    return m && Math.abs(+m[1]) <= 90 && Math.abs(+m[2]) <= 180 ? [+m[1], +m[2]] : null;
  }
  let lastSearch = '', pickedAddr = null;
  async function searchAddress(t) {
    const list = $('pick-results'), info = $('pick-info');
    list.replaceChildren(); list.hidden = true;
    info.textContent = T('Caut adresa…');
    const u = 'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&countrycodes=dk&accept-language=da'
      + '&viewbox=9.4,56.5,10.9,55.8&q=' + encodeURIComponent(t);
    let res;
    try {
      const r = await fetch(u, { referrerPolicy: 'strict-origin-when-cross-origin', headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      res = await r.json();
    } catch (e) { info.textContent = T('Căutarea adresei nu merge acum ({0}). Atinge harta sau folosește GPS.', e.message); return; }
    if (!res.length) { info.textContent = T('Nu am găsit adresa. Scrie strada, numărul și orașul, de ex. Søndergade 1, 8000 Aarhus C.'); return; }
    const pick = (x) => {
      list.hidden = true; if (ensureMap()) setPick(+x.lat, +x.lon, true);
      const a = x.address || {}, town = a.city || a.town || a.village || a.suburb || '';
      pickedAddr = a.road ? `${a.road}${a.house_number ? ' ' + a.house_number : ''}${a.postcode ? ', ' + a.postcode + (town ? ' ' + town : '') : ''}` : null; $('pick-info').textContent = x.display_name.split(', ').slice(0, 4).join(', ') + ' · ' + T('verifică pe hartă și mută punctul dacă e nevoie.'); };
    if (res.length === 1) { pick(res[0]); return; }
    for (const x of res) {
      const li = document.createElement('li'), b = document.createElement('button');
      b.type = 'button'; b.className = 'secondary'; b.textContent = x.display_name.split(', ').slice(0, 5).join(', ');
      b.onclick = () => pick(x);
      li.append(b); list.append(li);
    }
    list.hidden = false;
    info.textContent = T('Alege adresa potrivită.');
  }
  $('pick-form').onsubmit = (ev) => {
    ev.preventDefault();
    const t = $('pick-coords').value.trim();
    if (!t) return;
    const c = parseCoords(t);
    if (c) { $('pick-results').hidden = true; if (ensureMap()) setPick(c[0], c[1], true); return; }
    if (t.length < 4) { $('pick-info').textContent = T('Scrie adresa întreagă sau coordonatele.'); return; }
    if (t === lastSearch && !$('pick-results').hidden) return;
    lastSearch = t;
    $('pick-coords').blur();
    searchAddress(t);
  };
  $('pick-coords').onchange = () => { if (parseCoords($('pick-coords').value.trim())) $('pick-form').requestSubmit(); };

  $('start-form').onsubmit = async (ev) => {
    ev.preventDefault();
    $('start-error').hidden = true;
    store.set('tech', $('tech').value.trim());
    try {
      enterSession(await api('/api/sessions', 'POST', { meterSerial: $('meter').value.trim(), technician: $('tech').value.trim(), gps, address: $('addr').value.trim() }));
    } catch (e) { showError('start-error', e.message); needRegistry(e); }
  };

  $('meter').addEventListener('change', () => {
    const p = engine && !gps ? engine.savedPosition($('meter').value) : null;
    if (p) $('gps-info').textContent = T('Pentru acest contor există o poziție salvată la vizita din {0}; se folosește dacă nu alegi alta.', fmtTime(p.savedUtc));
  });

  $('check-btn').onclick = async () => {
    $('start-error').hidden = true;
    const meter = $('meter').value.trim();
    if (!meter) { showError('start-error', 'Introdu sau scanează seria contorului.'); return; }
    try { enterSession(await api('/api/check', 'POST', { meterSerial: meter, technician: $('tech').value.trim(), gps, address: $('addr').value.trim() })); }
    catch (e) { showError('start-error', e.status === 404 ? 'Verificarea fără CALL există doar în varianta fără server.' : e.message); needRegistry(e); }
  };
  // no registry: point at the card where it is loaded
  function needRegistry(e) {
    if (e.code !== 'REGISTRY_EMPTY') return;
    const c = $('reg-need');
    c.hidden = false;
    c.scrollIntoView({ behavior: 'smooth', block: 'center' });
    c.classList.remove('flash'); void c.offsetWidth; c.classList.add('flash');
  }

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
      $('meter').value = found[0]; renderFs();
      info.textContent = found[0] === text ? T('Serie citită din cod.') : T('Serie citită din codul: {0}', shown);
    } else if (found.length > 1) {
      info.textContent = T('Codul conține mai multe numere. Alege seria contorului: {0}', shown);
      for (const f of found) {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = f;
        b.onclick = () => { $('meter').value = f; renderFs(); chips.hidden = true; info.textContent = T('Serie aleasă din cod.'); };
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
  $('reg-need-scan').onclick = () => $('regqr-scan').click();
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
        + (r.inactive ? ' ' + T('{0} sunt marcate inactive și nu contează în rezultat.', r.inactive) : '')
        + ' ' + T({ embedded: 'Este inclus în aplicație; nu trebuie importat.', folder: 'Se încarcă singur din dosarul aplicației.',
          qr: 'Citit dintr-un cod QR; rămâne pe acest dispozitiv până imporți altul.' }[(engine.db.registrySource || {}).origin]
          || 'Importat manual; rămâne pe acest dispozitiv până imporți altul.')
      : T('Registrul nu este încărcat. Fără el nu se poate face nicio măsurătoare: LinkIQ nu poate ști care concentratoare sunt ale Kredsløb. Doar modul demonstrativ merge fără registru.');
    const embedded = (engine.db.registrySource || {}).origin === 'embedded';
    $('store-warn').hidden = storageWorks || embedded;
    const n = engine.sessionCount();
    $('sess-info').textContent = T('{0} {1} pe acest dispozitiv. Datele nu pleacă nicăieri până nu le exporți.', n, n === 1 ? T('sesiune salvată') : T('sesiuni salvate'));
    $('sess-clear').hidden = n === 0;
    $('reg-clear').hidden = !r.concentrators;
    $('regqr-make').hidden = !r.concentrators;
    $('mode').hidden = !engine.demo;
    $('reg-need').hidden = engine.demo || r.eligible > 0;
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
  const INK = { navy: '#0b2a3c', blue: '#1565c0', green: '#1b8a3a', gray: '#55626b', light: '#dfe5e9', red: '#c62828', ink: '#0b1f2a', yellow: '#f9c400', amber: '#e07800' };
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
  // Report map: every site a numbered marker (the same numbers as in the list under the map), no
  // text on the lines, the meter drawn last so nothing covers it. Markers that would overlap are
  // moved apart with a thin leader line to their true place. `fit`: the sites the view must hold.
  async function reportMap(s, W, H, useTiles = true, fit = null) {
    const g = s.session.gps, all = siteLinks(s);
    if (!g || g.lat === null || !all.length) return null;
    const num = new Map(all.map((l, i) => [l.key, i + 1])), links = all;
    const merc = (lat, lon, z) => {
      const n = 256 * 2 ** z, sl = Math.sin(lat * Math.PI / 180);
      return [(lon + 180) / 360 * n, (0.5 - Math.log((1 + sl) / (1 - sl)) / (4 * Math.PI)) * n];
    };
    const pts = [[g.lat, g.lon], ...links.filter((l) => !fit || fit.has(l.key)).map((l) => [l.lat, l.lon])];
    let z = 17, box;
    for (; z >= 4; z--) {
      const q = pts.map((p) => merc(p[0], p[1], z));
      box = [Math.min(...q.map((v) => v[0])), Math.min(...q.map((v) => v[1])), Math.max(...q.map((v) => v[0])), Math.max(...q.map((v) => v[1]))];
      if (box[2] - box[0] <= W - 120 && box[3] - box[1] <= H - 130) break;
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
      } catch { return reportMap(s, W, H, false, fit); }
    }
    if (!tiles) {
      x.strokeStyle = '#d5dde2'; x.lineWidth = 1;
      for (let v = 0; v < W; v += 80) { x.beginPath(); x.moveTo(v, 0); x.lineTo(v, H); x.stroke(); }
      for (let v = 0; v < H; v += 80) { x.beginPath(); x.moveTo(0, v); x.lineTo(W, v); x.stroke(); }
    }
    const P = (lat, lon) => { const m = merc(lat, lon, z); return [m[0] - ox, m[1] - oy]; };
    const [mx, my] = P(g.lat, g.lon);
    // marker places, pushed apart where they would overlap each other or the meter
    const R = 17, marks = links.map((l) => { const [px, py] = P(l.lat, l.lon); return { l, px, py, x: px, y: py }; });
    for (let it = 0; it < 80; it++) {
      let moved = false;
      for (let i = 0; i < marks.length; i++) {
        const a = marks[i];
        for (let j = i + 1; j < marks.length; j++) {
          const b = marks[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01, need = 2 * R + 6;
          if (d < need) { const k = (need - d) / 2 / d; a.x -= dx * k; a.y -= dy * k; b.x += dx * k; b.y += dy * k; moved = true; }
        }
        const dx = a.x - mx, dy = a.y - my, d = Math.hypot(dx, dy) || 0.01, need = R + 34;
        if (d < need) { a.x += dx / d * (need - d); a.y += dy / d * (need - d); moved = true; }
      }
      if (!moved) break;
    }
    [...marks].reverse().forEach(({ l, px, py }) => {          // weakest first, so the strong links stay on top
      const st = linkStyle(l);
      x.strokeStyle = st.color; x.lineWidth = l.primary ? 7 : 3; x.setLineDash(st.dash);
      x.beginPath(); x.moveTo(mx, my); x.lineTo(px, py); x.stroke(); x.setLineDash([]);
    });
    [...marks].reverse().forEach((m) => {
      const st = linkStyle(m.l), n = num.get(m.l.key);
      if (Math.hypot(m.x - m.px, m.y - m.py) > 3) {             // moved: a thin line to the true place
        x.strokeStyle = INK.ink; x.lineWidth = 1.5; x.beginPath(); x.moveTo(m.px, m.py); x.lineTo(m.x, m.y); x.stroke();
        x.fillStyle = INK.ink; x.beginPath(); x.arc(m.px, m.py, 3, 0, 2 * Math.PI); x.fill();
      }
      x.fillStyle = st.color; x.strokeStyle = '#fff'; x.lineWidth = m.l.primary ? 5 : 3;
      x.beginPath(); x.arc(m.x, m.y, m.l.primary ? R + 3 : R, 0, 2 * Math.PI); x.fill(); x.stroke();
      if (m.l.primary) { x.strokeStyle = INK.ink; x.lineWidth = 2; x.beginPath(); x.arc(m.x, m.y, R + 6, 0, 2 * Math.PI); x.stroke(); }
      x.font = `800 ${n > 9 ? 17 : 20}px ${SANS}`; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillStyle = m.l.age === 'OLD' || st.color === SIG.mid ? INK.ink : '#fff'; x.fillText(String(n), m.x, m.y + 1);
    });
    // the meter last, on top of everything, with its name in a white box
    x.fillStyle = INK.blue; x.strokeStyle = '#fff'; x.lineWidth = 5;
    x.beginPath(); x.arc(mx, my, 13, 0, 2 * Math.PI); x.fill(); x.stroke();
    x.strokeStyle = INK.blue; x.lineWidth = 2; x.beginPath(); x.arc(mx, my, 18, 0, 2 * Math.PI); x.stroke();
    x.font = `800 19px ${SANS}`;
    const mw = x.measureText(T('Contor')).width + 14, mh = 26;
    // the label goes on the side of the meter where it covers no marker and no line end
    let mlx = 0, mly = 0, bestFree = -1;
    for (const [dx, dy] of [[0, -1], [0, 1], [1, 0], [-1, 0], [1, -1], [-1, -1], [1, 1], [-1, 1]]) {
      const cx = mx + dx * (mw / 2 + 28), cy = my + dy * 34;
      const lx = Math.max(4, Math.min(W - mw - 4, cx - mw / 2)), ly = Math.max(4, Math.min(H - mh - 44, cy - mh / 2));
      const free = Math.min(999, ...marks.map((m) => {
        const qx = Math.max(lx, Math.min(lx + mw, m.x)), qy = Math.max(ly, Math.min(ly + mh, m.y));
        return Math.hypot(m.x - qx, m.y - qy) - R;
      }));
      if (free > bestFree + 0.5) { bestFree = free; mlx = lx; mly = ly; }
      if (free > 12) break;
    }
    x.fillStyle = 'rgba(255,255,255,0.95)'; x.strokeStyle = INK.blue; x.lineWidth = 2;
    x.beginPath(); x.roundRect(mlx, mly, mw, mh, 6); x.fill(); x.stroke();
    x.fillStyle = INK.blue; x.textAlign = 'left'; x.textBaseline = 'middle'; x.fillText(T('Contor'), mlx + 7, mly + 14);
    c.crowded = marks.some((m) => Math.hypot(m.x - m.px, m.y - m.py) > 3);
    // legend, scale, north, attribution
    const legend = [[linkColor(-50), T('bun')], [linkColor(-100), T('la limită')], [linkColor(-130), T('slab')]];
    if (s.session.status === 'CHECK') legend.push([OLD_GRAY, T('peste 8 ore')]);
    x.font = `600 17px ${SANS}`; x.textBaseline = 'middle'; x.textAlign = 'left';
    let lx = 14;
    const kinds = [[7, [], T('principal')], [3, [8, 6], T('ceilalți')]];
    let need = 14;
    for (const [, name] of legend) need += 44 + x.measureText(name).width;
    for (const [, , name] of kinds) need += 44 + x.measureText(name).width;
    x.fillStyle = 'rgba(255,255,255,0.88)'; x.fillRect(6, H - 38, need, 32);
    for (const [col, name] of legend) {            // the same line samples as on the map
      x.strokeStyle = col; x.lineWidth = 5; x.setLineDash(col === OLD_GRAY ? [2, 5] : []);
      x.beginPath(); x.moveTo(lx, H - 22); x.lineTo(lx + 26, H - 22); x.stroke(); x.setLineDash([]);
      x.fillStyle = INK.ink; x.fillText(name, lx + 32, H - 22); lx += 44 + x.measureText(name).width;
    }
    for (const [w, dash, name] of kinds) {
      x.strokeStyle = INK.gray; x.lineWidth = w; x.setLineDash(dash);
      x.beginPath(); x.moveTo(lx, H - 22); x.lineTo(lx + 26, H - 22); x.stroke(); x.setLineDash([]);
      x.fillStyle = INK.ink; x.fillText(name, lx + 32, H - 22); lx += 44 + x.measureText(name).width;
    }
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
  const REPORT_VERSION = '0.2';   // the report's own layout; changes without a new app version
  const isStale = (q) => q.ageMin !== null && q.ageMin !== undefined && q.ageMin > REPORT_MAX_AGE_H * 60;

  const REPORT_SITES = 3;
  async function buildReport(s) {
    const staleCount = s.receivers.filter(isStale).length;
    const shown = s.receivers.filter((q) => !isStale(q));
    // On paper only the links that can carry the data: the primary, and the others down to the
    // usable limit with contact within the history window. Of those, one per site and at most
    // REPORT_SITES sites: the best signal first, the most recent contact when signals are close.
    // The rest is counted, not listed, so many weak links never look like good coverage.
    const useDbm = (cfg.thresholds || {}).usableDbm || -120;
    const carry = shown.filter((q) => q.relation === 'PRIMARY' || (q.bestRssi >= useDbm && q.age !== 'OLD'));
    const seen = (q) => Date.parse(q.observedUtc || '') || 0;
    const better = (a, b) => (a.relation === 'PRIMARY') !== (b.relation === 'PRIMARY') ? (a.relation === 'PRIMARY' ? -1 : 1)
      : Math.abs(a.bestRssi - b.bestRssi) >= 3 ? b.bestRssi - a.bestRssi : (seen(b) - seen(a)) || (b.bestRssi - a.bestRssi);
    const bySite = new Map();
    for (const q of [...carry].sort(better)) { const k = q.siteCode || q.serial; if (!bySite.has(k)) bySite.set(k, q); }
    const useful = [...bySite.values()].slice(0, REPORT_SITES);
    const weakHidden = shown.length - carry.length, moreHidden = carry.length - useful.length;
    const W = 1080, P = 56, big = document.createElement('canvas');
    big.width = W; big.height = 5400;
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
    const breaks = [];                          // places where a printed page may end (never inside a map or a line)
    let keep = false;                           // a heading stays with what follows it
    const brk = () => { if (keep) { keep = false; return; } breaks.push(Math.round(y) + 14); };   // below the descenders of the line above
    const mark = (yy) => { if (keep) { keep = false; return; } breaks.push(Math.round(yy) + 14); };
    const section = (title) => { brk(); keep = true; y += 36; x.fillStyle = INK.light; x.fillRect(P, y, W - 2 * P, 2); y += 50; font(700, 30); text(title, P, y, INK.navy); y += 10; };
    const row = (label, value, color = INK.ink) => {
      brk();
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
    const fsx = fsFor(String(s.session.meterSerial).replace(/\D/g, ''));
    const shownAddr = fsx && fsx.answer === 'yes' && fsFull(fsx) ? fsFull(fsx) : s.session.address;
    if (shownAddr) row(T('Adresă'), shownAddr);
    if (fsx || !s.session.demo) { const [fc, ft] = fsReportLine(fsx); row('VVS-dialog', ft, fc); }
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

    if (!isCheck) {
      // the El og syn fields, so the separate KMD form is not needed; the last two are filled by the app itself
      const es = (ui.vvs && ui.vvs.meter === s.session.meterSerial && ui.vvs.es) || {};
      const vals = Object.fromEntries(filledReadings().filter((r) => r.value).map((r) => [r.k, true]));
      const all3 = ['E1', 'V1', 'HR'].every((k) => vals[k]);
      const nPh = instPhotos.count(), nUnit = instPhotos.countOf('unit');
      section(T('El og syn'));
      const miss = (v) => v || T('necompletat');
      row('Anlæg', miss(es.anlaeg), es.anlaeg ? INK.ink : INK.gray);
      row('Vandvarmer', miss(es.vv), es.vv ? INK.ink : INK.gray);
      if (es.unit || es.vv === 'Unit') row('Unit', miss(es.unit), es.unit ? INK.ink : INK.gray);
      if (es.model) row('Model', es.model);
      row('Hovedhaner lukket', miss(es.haner), es.haner ? INK.ink : INK.gray);
      row('Plomberet', miss(es.plomb), es.plomb === 'Ja' ? INK.green : es.plomb ? INK.amber : INK.gray);
      row(T('Cele 3 registre citite'), all3 ? T('Da: E1, V1 și HR') : T('Nu: lipsește {0}', ['E1', 'V1', 'HR'].filter((k) => !vals[k]).join(', ')), all3 ? INK.green : INK.amber);
      row(T('Foto'), nPh ? T('Da: {0} poze', nPh) + (nUnit ? '' : ' · ' + T('fără vandvarmer / unit')) : T('Nu'), nPh && nUnit ? INK.green : INK.amber);
    }

    y = await drawReadings(x, P, W, y, (t) => { section(t); return y; }, font, text, mark);
    keep = false;
    y = drawVvsSection(x, P, W, y, (t) => { section(t); return y; }, font, text);
    keep = false;                               // the VVS lines have no breaks of their own

    const sm = { ...s, receivers: useful };
    const mapCanvas = await reportMap(sm, W - 2 * P, 620);
    if (mapCanvas) {
      section(T('Hartă'));
      y += 34; font(700, 22); text(T('Toate site-urile'), P, y, INK.gray); y += 12;
      x.drawImage(mapCanvas, P, y);
      x.strokeStyle = INK.light; x.lineWidth = 2; x.strokeRect(P, y, W - 2 * P, 620);
      y += 620;
      keep = false;
      const sites = siteLinks(sm);
      // sites crowd together near the meter: a second map, close up, with the nearest ones
      const near = sites.filter((l) => l.distanceM !== null).sort((a, b) => a.distanceM - b.distanceM);
      if (mapCanvas.crowded && near.length >= 2) {
        const fit = new Set(near.slice(0, Math.min(5, near.length)).map((l) => l.key));
        const close = fit.size < near.length ? await reportMap(sm, W - 2 * P, 460, true, fit) : null;   // same sites: same map
        if (close) {
          brk();
          y += 44; font(700, 22); text(T('Mărit: cele {0} site-uri cele mai apropiate de contor', fit.size), P, y, INK.gray); y += 12;
          x.drawImage(close, P, y); x.strokeStyle = INK.light; x.lineWidth = 2; x.strokeRect(P, y, W - 2 * P, 460);
          y += 460;
        }
      }
      // the numbers on the map
      y += 22;
      const REL = { PRIMARY: T('principal'), SAME_SITE: T('același site'), DISTINCT_SITE: T('alt site'), UNKNOWN_SITE: T('site necunoscut') };
      brk();
      brk();                                    // the short list stays together, under its heading
      y += 24; font(700, 22); text(T('Numerele de pe hărți'), P, y + 14, INK.gray); y += 30;
      sites.forEach((l, i) => {
        if (y > big.height - 400) return;
        const col = linkStyle(l).color, rel = s.receivers.find((q) => q.serial === l.serial);
        x.fillStyle = col; x.beginPath(); x.arc(P + 16, y + 2, 15, 0, 2 * Math.PI); x.fill();
        font(800, 17); x.fillStyle = l.age === 'OLD' || col === SIG.mid ? INK.ink : '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(i + 1), P + 16, y + 3);
        x.textBaseline = 'alphabetic';
        font(l.primary ? 800 : 700, 21);
        text(`${dbm(l.best)}${l.distanceM !== null ? ' · ' + meters(l.distanceM) : ''}${rel && REL[rel.relation] ? ' · ' + REL[rel.relation] : ''}${l.count > 1 ? ' · ' + T('{0} concentratoare', l.count) : ''}`, P + 44, y + 8, INK.ink);
        font(500, 19);
        const where = [l.name, (l.address || '').split(',').slice(0, 2).join(',')].filter(Boolean).join(', ') || l.serial;
        text(where.slice(0, 80), P + 44, y + 34, INK.gray);
        y += 58;
      });
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
    const p1 = useful.find((q) => q.relation === 'PRIMARY');
    row(T('Receptor principal'), p1 ? [p1.serial, dbm(p1.bestRssi), where(p1)].filter(Boolean).join(' · ') : '–');
    const b = s.backup;
    const occasional = b && b.age && b.age !== 'CURRENT';
    row(T('Rezervă'), b ? [b.serial, dbm(b.bestRssi), T(RELATION_RO[b.redundancy] || 'site necunoscut'), b.siteName,
      occasional ? T('doar ocazional – nu contează ca redundanță') : null].filter(Boolean).join(' · ') : T('niciuna'), b && !occasional ? INK.ink : INK.gray);
    y += 16;
    for (const q of useful) {
      brk();
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
    const hid = [];
    if (moreHidden) hid.push(T('{0} alte legături utilizabile (același site sau după cele mai bune {1} site-uri) nu sunt arătate.', moreHidden, REPORT_SITES));
    if (weakHidden) hid.push(T('{0} legături sub {1} dBm sau fără contact de peste 8 ore nu contează și nu sunt arătate.', weakHidden, useDbm));
    for (const h of hid) {
      brk();
      y += 36; font(600, 21);
      for (const l of wrap(h, W - 2 * P)) { text(l, P, y, INK.gray); y += 30; }
      y -= 30;
    }
    if (staleCount) {
      brk();
      y += 34; font(500, 20);
      text(T(staleCount === 1 ? '1 concentrator văzut ultima dată acum peste {1} ore nu este inclus în raport.' : '{0} concentratoare văzute ultima dată acum peste {1} ore nu sunt incluse în raport.', staleCount, REPORT_MAX_AGE_H), P, y, INK.gray);
    }
    brk();
    y += 18; font(500, 19);
    for (const l of wrap(limitsText(isCheck), W - 2 * P)) { y += 28; text(l, P, y, INK.gray); }
    if (s.session.note) {
      section(T('Observații'));
      font(500, 26);
      for (const l of wrap(s.session.note, W - 2 * P)) { y += 38; text(l, P, y); }
    }
    y += 70; font(400, 21);                     // the version line stays with the limits above, never alone on a page
    text(`LinkIQ Field Assistant v${VERSION} · ${T('raport')} v${REPORT_VERSION} · ${T('generat {0}', fmtTime(new Date().toISOString()))}`, P, y, INK.gray);
    y += 44;
    const out = document.createElement('canvas');
    out.width = W; out.height = y;
    out.getContext('2d').drawImage(big, 0, 0);
    out.breaks = breaks.filter((b) => b > 0 && b < y);
    return out;
  }

  // ---------------------------------------------------------------- printable pages
  // The report is one long picture on screen; on paper it is cut into A4 pages, only where a
  // section or a line starts (never through a map), with the meter number and page number on each.
  const A4W = 1080, A4H = Math.round(1080 * 297 / 210);
  function pageCanvas() {
    const c = document.createElement('canvas'); c.width = A4W; c.height = A4H;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, A4W, A4H);
    return c;
  }
  function pageFrame(c, s, n, total, first) {
    const x = c.getContext('2d');
    x.font = `500 20px ${SANS}`; x.fillStyle = INK.gray; x.textBaseline = 'alphabetic';
    if (!first) {
      x.fillStyle = INK.navy; x.fillRect(0, 0, A4W, 64);
      x.font = `700 24px ${SANS}`; x.fillStyle = '#fff'; x.textAlign = 'left';
      x.fillText(`LinkIQ · ${T('Contor')} ${s.session.meterSerial}`, 56, 41);
    }
    x.font = `500 20px ${SANS}`; x.fillStyle = INK.gray; x.textAlign = 'right';
    x.fillText(T('Pagina {0} din {1}', n, total), A4W - 56, A4H - 26);
    x.textAlign = 'left';
    x.fillText(`${T('Contor')} ${s.session.meterSerial} · ${fmtTime(new Date().toISOString())}`, 56, A4H - 26);
  }
  function paginate(report, s, extra) {
    const foot = 64, head = 84, pages = [];
    let start = 0;
    while (start < report.height - 4) {
      const avail = A4H - foot - (pages.length ? head : 0);
      let end = start + avail;
      if (end >= report.height) end = report.height;
      else {
        const fit = (report.breaks || []).filter((b) => b > start + avail * 0.25 && b <= end);
        if (fit.length) end = fit[fit.length - 1];
      }
      pages.push([start, end]);
      start = end;
    }
    const total = pages.length + extra.length;
    const out = pages.map(([a, b], i) => {
      const c = pageCanvas(), x = c.getContext('2d');
      x.drawImage(report, 0, a, A4W, b - a, 0, i ? head : 0, A4W, b - a);
      pageFrame(c, s, i + 1, total, i === 0);
      return c;
    });
    extra.forEach((ph, k) => {                  // a photo on its own page, as large as it fits
      const c = pageCanvas(), x = c.getContext('2d');
      const n = out.length + 1, top = head + 50, maxW = A4W - 112, maxH = A4H - top - 100;
      const sc = Math.min(maxW / ph.canvas.width, maxH / ph.canvas.height);
      const w = Math.round(ph.canvas.width * sc), h = Math.round(ph.canvas.height * sc);
      x.font = `700 28px ${SANS}`; x.fillStyle = INK.navy; x.textAlign = 'left'; x.fillText(ph.title, 56, head + 34);
      x.drawImage(ph.canvas, (A4W - w) / 2, top, w, h);
      x.strokeStyle = INK.light; x.lineWidth = 2; x.strokeRect((A4W - w) / 2, top, w, h);
      pageFrame(c, s, n, total, false);
      out.push(c);
    });
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
      del: async (k) => { const db = await open(); return new Promise((ok, fail) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').delete(k); t.oncomplete = () => ok(); t.onerror = () => fail(t.error); }); },
      keys: async () => { const db = await open(); return new Promise((ok, fail) => { const r = db.transaction('kv').objectStore('kv').getAllKeys(); r.onsuccess = () => ok(r.result.map(String)); r.onerror = () => fail(r.error); }); },
    };
  })();
  // Retention: installation photos of a session that was never finished go after 30 days.
  const PHOTO_KEEP_DAYS = 30;
  // ---------------------------------------------------------------- start picture
  // Shown for a moment at start (at least 0.9 s, never more than the start itself needs). The
  // picture is splash.svg, or one chosen under Mere, kept on this device only.
  let splashUrl = null;
  async function splashSetup() {
    $('splash-ver').textContent = 'v' + VERSION;
    const on = store.get('splashOn', true) !== false;
    $('splash-on').checked = on;
    if (!on) { $('splash').hidden = true; }
    let custom = null;
    try { custom = await kv.get('splashImg'); } catch { /* */ }
    if (splashUrl) URL.revokeObjectURL(splashUrl);
    splashUrl = custom ? URL.createObjectURL(custom) : null;
    if (splashUrl && on) $('splash-img').src = splashUrl;
    $('splash-prev').src = splashUrl || 'splash.svg';
    $('splash-reset').hidden = !custom;
  }
  function splashDone() {
    const sp = $('splash');
    if (sp.hidden) return;
    const wait = Math.max(0, 900 - performance.now());
    setTimeout(() => { sp.classList.add('out'); setTimeout(() => { sp.hidden = true; }, 400); }, wait);
  }
  $('splash-file').onchange = async (ev) => {
    const f = ev.target.files[0]; ev.target.value = '';
    if (!f) return;
    try {
      const bmp = await createImageBitmap(f), k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      await kv.set('splashImg', await canvasBlob(c, 'image/jpeg'));
    } catch { /* not a picture */ }
    splashSetup();
  };
  $('splash-reset').onclick = async () => { try { await kv.del('splashImg'); } catch { /* */ } $('splash-img').src = 'splash.svg'; splashSetup(); };
  $('splash-on').onchange = () => store.set('splashOn', $('splash-on').checked);

  async function sweepPhotos() {
    try {
      for (const k of (await kv.keys()).filter((x) => x.startsWith('iph:'))) {
        const v = await kv.get(k);
        const newest = Array.isArray(v) && v.length ? Math.max(...v.map((p) => Date.parse(p.at) || 0)) : 0;
        if (Date.now() - newest > PHOTO_KEEP_DAYS * 864e5) await kv.del(k);
      }
    } catch { /* storage not available: nothing kept either */ }
  }

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
    const cam = $('perm-cam'), dir = $('dir-allow'), loc = $('perm-loc');
    loc.hidden = locPerm !== 'prompt';
    if (locPerm === 'denied' && !gps) $('gps-info').textContent = T(OFF_TXT);
    cam.hidden = camPerm === 'granted' || !navigator.mediaDevices;
    cam.querySelector('button').hidden = camPerm === 'denied';
    cam.querySelector('.pl').textContent = camPerm === 'denied' ? T('Camera este blocată: permite-o din setările browserului (lacătul de lângă adresă).') : T('Camera');
    $('perm-card').hidden = cam.hidden && dir.hidden && loc.hidden;
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
      li.onclick = async () => { try { viewer.open([{ name: f.name, blob: await f.h.getFile() }]); } catch { /* removed meanwhile */ } };
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
    if (S && /\.(pdf|png)$/i.test(name)) await vqUpsert(saved || name, blob);
    return saved || name;
  }
  const fileStamp = (t) => {
    const d = new Date(t || Date.now()), two = (v) => String(v).padStart(2, '0');
    return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`;
  };
  /** The whole history goes to the case with the report: the report as a picture too, the antenna
   *  photo and every installation photo, each under a name that says what it is and when. */
  async function vqHistory(report, savedName) {
    if (!S) return;
    const base = savedName.replace(/\.[a-z0-9]+$/i, ''), m = safeName(S.session.meterSerial), extra = [];
    if (!/\.png$/i.test(savedName)) extra.push({ name: base + '.png', blob: await canvasBlob(report, 'image/png') });
    const internal = ui.install && ui.install.antennaType === 'internal';
    if (lastPhoto && S.session.status !== 'CHECK' && !internal) extra.push({ name: `${m}_antenne_${fileStamp()}.jpg`, blob: await canvasBlob(lastPhoto, 'image/jpeg') });
    extra.push(...await instPhotos.vvsFiles());
    await vqSetExtras(savedName, extra);
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

  $('report-btn').onclick = () => S && instPhotos.ask(() => askReadings(savePng));
  async function savePng() {
    if (!S) return;
    try {
      const report = await buildReport(S);
      const saved = await saveBlob(await canvasBlob(report, 'image/png'), reportName(S) + '.png', 'Raportul a fost salvat ca {0}.');
      await vqHistory(report, saved);
    }
    catch (e) { showError('align-error', T('Nu am putut crea fișierul: {0}', e.message)); }
  }
  $('report-pdf-btn').onclick = () => S && instPhotos.ask(() => askReadings(savePdf));
  async function savePdf() {
    if (!S) return;
    try {
      const report = await buildReport(S);
      const internal = ui.install && ui.install.antennaType === 'internal';
      const photos = [];
      if (lastPhoto && S.session.status !== 'CHECK' && !internal) photos.push({ canvas: lastPhoto, title: T('Antena') });
      const inst = await instPhotos.pages();
      photos.push(...inst);
      const pages = paginate(report, S, photos);
      const saved = await saveBlob(pdfFromCanvases(pages), reportName(S) + '.pdf', inst.length ? 'Raportul PDF, cu pozele instalației, a fost salvat ca {0}.' : pages.length > 1 ? 'Raportul PDF, cu fotografia antenei, a fost salvat ca {0}.' : 'Raportul PDF a fost salvat ca {0}.', null);
      await vqHistory(report, saved);
    } catch (e) { showError('align-error', T('Nu am putut crea fișierul: {0}', e.message)); }
  }
  $('photo-file').onchange = async (ev) => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file || !S) return;
    try {
      lastPhoto = await stampPhoto(file, S);
      await saveBlob(await canvasBlob(lastPhoto, 'image/jpeg'), safeName(S.session.meterSerial) + '_antenne.jpg', 'Fotografia cu datele măsurătorii a fost salvată ca {0}.');
      renderLeave();
    } catch (e) { showError('align-error', T('Nu am putut crea fișierul: {0}', e.message)); }
  };

  // Every photo button can also take a picture from the gallery: in poor light the phone's own
  // camera app (flash, night mode) often does better, and the picture is then picked here.
  document.querySelectorAll('[data-gallery]').forEach((b) => {
    b.onclick = () => {
      const target = $(b.dataset.gallery), inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*';
      inp.onchange = () => { if (inp.files[0] && target.onchange) target.onchange({ target: inp }); };
      inp.click();
    };
  });

  // ---------------------------------------------------------------- viewer for saved files
  // Reports and photos open inside the app, so the installer never has to leave it to check what
  // was saved. LinkIQ's own PDFs hold one JPEG per page: those pages are shown as pictures.
  function pdfPages(buf) {
    const b = new Uint8Array(buf), t = new TextDecoder('latin1').decode(b), out = [];
    const re = /\/Filter \/DCTDecode \/Length (\d+) >>\nstream\n/g;
    for (let m = re.exec(t); m; m = re.exec(t)) {
      const at = m.index + m[0].length, n = Number(m[1]);
      if (at + n <= b.length) out.push(new Blob([b.slice(at, at + n)], { type: 'image/jpeg' }));
    }
    return out;
  }
  const viewer = (() => {
    let items = [], at = 0, url = null, pushed = false;
    async function expand(list) {
      const out = [];
      for (const f of list) {
        const pdf = /\.pdf$/i.test(f.name) || f.blob.type === 'application/pdf';
        if (pdf) {
          let pages = [];
          try { pages = pdfPages(await f.blob.arrayBuffer()); } catch { pages = []; }
          if (pages.length) pages.forEach((p, k) => out.push({ title: pages.length > 1 ? `${f.name} · ${k + 1}/${pages.length}` : f.name, blob: p, src: f }));
          else out.push({ title: f.name, blob: null, src: f });
        } else out.push({ title: f.name, blob: /^image\//.test(f.blob.type) || /\.(png|jpe?g|webp)$/i.test(f.name) ? f.blob : null, src: f });
      }
      return out;
    }
    function show() {
      const it = items[at];
      if (url) { URL.revokeObjectURL(url); url = null; }
      $('vw-title').textContent = it.title;
      $('vw-count').textContent = items.length > 1 ? `${at + 1} / ${items.length}` : '';
      if (it.blob) { url = URL.createObjectURL(it.blob); $('vw-img').src = url; $('vw-img').hidden = false; $('vw-empty').hidden = true; }
      else { $('vw-img').hidden = true; $('vw-img').removeAttribute('src'); $('vw-empty').textContent = T('Fișierul nu se poate arăta aici.'); $('vw-empty').hidden = false; }
      $('vw-ext').hidden = !!it.blob;
      $('vw-prev').disabled = at === 0; $('vw-next').disabled = at >= items.length - 1;
    }
    async function open(list, start = 0) {
      if (!list.length) return;
      const ex = await expand(list);
      const first = ex.findIndex((x) => x.src === list[start]);
      items = ex; at = Math.max(0, first);
      $('viewer').hidden = false;
      try { history.pushState({ v: currentView, ov: 'viewer' }, ''); pushed = true; } catch { pushed = false; }
      show();
    }
    function close(button) {
      if ($('viewer').hidden) return;
      $('viewer').hidden = true;
      if (url) { URL.revokeObjectURL(url); url = null; }
      $('vw-img').removeAttribute('src');
      items = [];
      if (button && pushed) { pushed = false; history.back(); } else pushed = false;
    }
    $('vw-close').onclick = () => close(true);
    $('vw-prev').onclick = () => { if (at > 0) { at--; show(); } };
    $('vw-next').onclick = () => { if (at < items.length - 1) { at++; show(); } };
    $('vw-ext').onclick = () => { const it = items[at]; if (it && it.src) window.open(URL.createObjectURL(it.src.blob), '_blank'); };
    let x0 = null;                              // swipe left / right between pages and photos
    $('viewer').addEventListener('touchstart', (e) => { x0 = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
    $('viewer').addEventListener('touchend', (e) => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0; x0 = null;
      if (dx < -60) $('vw-next').click(); else if (dx > 60) $('vw-prev').click();
    }, { passive: true });
    return { open, close };
  })();

  // ---------------------------------------------------------------- before you leave
  // What the installer must have before leaving the site, each line opening what was saved.
  async function renderLeave() {
    const ul = $('leave-list');
    if (!ul || !S || $('report-box').hidden) return;
    const internal = ui.install && ui.install.antennaType === 'internal', check = S.session.status === 'CHECK';
    let entry = null;
    try { entry = (await vqLoad()).find((e) => e.id === vqId()) || null; } catch { /* */ }
    const pdf = entry && entry.files.find((f) => /\.pdf$/i.test(f)), png = entry && entry.files.find((f) => /\.png$/i.test(f));
    const files = async () => {
      const out = [];
      for (const f of entry ? entry.files : []) { try { const b = await kv.get('vvsf:' + entry.id + ':' + f); if (b) out.push({ name: f, blob: b }); } catch { /* */ } }
      return out;
    };
    const rows = [];
    rows.push({ ok: !!(pdf || png), label: T('Raportul salvat'), sub: pdf || png || T('Apasă „Descarcă raportul (PDF)”.'), open: pdf || png ? async () => viewer.open(await files()) : null });
    if (!check) {
      const n = instPhotos.count();
      rows.push({ ok: n > 0, label: T('Poze cu instalația'), sub: n === 1 ? T('1 poză') : n ? T('{0} poze', n) : T('Nicio poză încă.'), open: n ? async () => viewer.open(await instPhotos.files()) : null });
      const nu = instPhotos.countOf('unit');
      rows.push({ ok: nu > 0, label: T('Poza cu vandvarmer / unit'), sub: nu ? T('făcută') : T('plăcuța de tip: ce unitate e montată') });
      const es = (ui.vvs && ui.vvs.es) || {}, esMiss = ['anlaeg', 'vv', 'haner', 'plomb'].filter((k) => !es[k]).length;
      rows.push({ ok: !esMiss, label: T('Instalația (El og syn)'), sub: esMiss ? T('{0} câmpuri necompletate', esMiss) : elsynLine(es).replace(/^Installation: /, ''), open: () => { showView('align'); $('elsyn-card').scrollIntoView({ block: 'center' }); } });
      if (!internal) rows.push({ ok: !!lastPhoto, opt: true, label: T('Poza antenei'), sub: lastPhoto ? T('făcută') : T('opțională'), open: lastPhoto ? async () => viewer.open([{ name: T('Poza antenei'), blob: await canvasBlob(lastPhoto, 'image/jpeg') }]) : null });
    }
    const rd = (ui.readings || []).filter((r) => r.value);
    rows.push({ ok: rd.length > 0, opt: true, label: T('Citirile contorului'), sub: rd.length ? rd.map((r) => `${r.k === '*' ? (r.label || '?') : r.k} ${r.value}`).join(' · ') : T('opționale'),
      open: rd.some((r) => r.img) ? () => viewer.open(rd.filter((r) => r.img).map((r) => ({ name: `${r.k === '*' ? (r.label || '?') : r.k} ${r.value}`, blob: dataUrlBlob(r.img) }))) : null });
    const sent = entry && entry.state === 'sent';
    rows.push({ ok: sent, label: T('Pe caz în VVS-dialog'), sub: sent ? T('✓ pe caz {0}', entry.cc || '') : entry ? T('așteaptă: apasă „Trimite la VVS-dialog”') : T('încă nu'),
      open: () => showView('sync') });
    ul.replaceChildren();
    for (const r of rows) {
      const li = document.createElement('li');
      li.className = r.ok ? 'ok' : r.opt ? 'opt' : 'no';
      const mk = document.createElement('span'); mk.className = 'mk'; mk.textContent = r.ok ? '✓' : r.opt ? '○' : '!';
      const tx = document.createElement('span'); tx.textContent = r.label;
      const sm = document.createElement('small'); sm.textContent = r.sub; tx.append(sm);
      const go = document.createElement('span'); go.className = 'go'; go.textContent = r.open ? '›' : '';
      li.append(mk, tx, go);
      if (r.open) { li.setAttribute('role', 'button'); li.tabIndex = 0; li.onclick = r.open; }
      ul.append(li);
    }
  }
  function dataUrlBlob(d) {
    const [head, body] = String(d).split(','), bin = atob(body || ''), b = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    return new Blob([b], { type: (head.match(/data:([^;]+)/) || [])[1] || 'image/jpeg' });
  }

  // ---------------------------------------------------------------- installation photos
  // Every installation, whatever the antenna: photos taken at mounting and at commissioning,
  // stamped with meter, moment, time and place, kept with the session (IndexedDB) until the
  // report is made, and added to the PDF as history and proof of a correct installation.
  const instPhotos = (() => {
    const MAX = 8, STAGES = { mount: 'La montaj', start: 'La punerea în funcțiune', unit: 'Vandvarmer / unit' }, FILE = { mount: 'montage', start: 'idrift', unit: 'unit' };
    let key = null, list = [], loading = null, asked = false;
    const keyOf = (s) => 'iph:' + (s.session.id || s.session.meterSerial);
    async function sync() {
      if (!S) return;
      const k = keyOf(S);
      if (k === key) return loading;
      key = k; list = []; asked = false;
      loading = kv.get(k).then((v) => { if (key === k) { list = Array.isArray(v) ? v : []; draw(); } }).catch(() => {});
      return loading;
    }
    const keep = () => kv.set(key, list.map((p) => ({ stage: p.stage, at: p.at, blob: p.blob }))).catch(() => {});
    async function stamp(file, s, stage) {
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      const x = c.getContext('2d'), W = c.width, H = c.height;
      x.drawImage(bmp, 0, 0, W, H);
      const u = Math.max(14, Math.round(W / 46)), bh = Math.round(u * 5.6);
      const g = x.createLinearGradient(0, H - bh * 1.4, 0, H);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.35, 'rgba(0,0,0,0.7)'); g.addColorStop(1, 'rgba(0,0,0,0.85)');
      x.fillStyle = g; x.fillRect(0, H - bh * 1.4, W, bh * 1.4);
      const gps = s.session.gps && s.session.gps.lat !== null ? `${s.session.gps.lat.toFixed(5)}, ${s.session.gps.lon.toFixed(5)}` : null;
      const lines = [
        [`700 ${Math.round(u * 1.45)}px ${SANS}`, `${s.session.meterSerial} · ${T(STAGES[stage])}`],
        [`500 ${u}px ${SANS}`, [fmtTime(new Date(file.lastModified || Date.now()).toISOString()), s.session.technician].filter(Boolean).join(' · ')],
        [`400 ${Math.round(u * 0.8)}px ${SANS}`, [s.session.install ? installShort(s.session.install) : null, gps, `LinkIQ v${VERSION}`].filter(Boolean).join(' · ')],
      ];
      x.textAlign = 'left'; x.textBaseline = 'alphabetic'; x.fillStyle = '#fff';
      x.shadowColor = 'rgba(0,0,0,0.8)'; x.shadowBlur = u * 0.3;
      let y = H - bh + u * 1.2;
      for (const [f, t] of lines) { x.font = f; x.fillText(t, u, y, W - 2 * u); y += u * 1.75; }
      return canvasBlob(c, 'image/jpeg');
    }
    function draw() {
      const ul = $('iphoto-list');
      if (!ul) return;
      ul.replaceChildren();
      list.forEach((p, i) => {
        const li = document.createElement('li');
        const img = document.createElement('img');
        img.src = p.url || (p.url = URL.createObjectURL(p.blob)); img.alt = T(STAGES[p.stage]);
        const cap = document.createElement('small'); cap.textContent = T(STAGES[p.stage]) + ' · ' + fmtTime(p.at).split(' ').pop();
        const del = document.createElement('button'); del.type = 'button'; del.textContent = '×'; del.setAttribute('aria-label', T('Șterge poza'));
        del.onclick = () => { if (!confirm(T('Ștergi poza?'))) return; URL.revokeObjectURL(p.url); list.splice(i, 1); keep(); draw(); renderLeave(); };
        li.append(img, cap, del); ul.append(li);
      });
      const nm = list.filter((p) => p.stage === 'mount').length, ns = list.filter((p) => p.stage === 'start').length, nu = list.filter((p) => p.stage === 'unit').length;
      $('iphoto-n').textContent = list.length ? T('({0} la montaj, {1} la punerea în funcțiune, {2} vandvarmer/unit)', nm, ns, nu) : '';
      $('iphoto-card').classList.toggle('need', !list.length && !!S && S.session.status !== 'CHECK' && S.session.status !== 'ACTIVE');
      for (const id of ['iphoto-mount', 'iphoto-start', 'iphoto-unit']) $(id).parentElement.classList.toggle('disabled', list.length >= MAX);
    }
    async function add(file, stage) {
      if (!file || !S) return;
      await sync();
      const msg = $('iphoto-msg');
      if (list.length >= MAX) { msg.textContent = T('Sunt deja {0} poze. Șterge una ca să adaugi alta.', MAX); msg.hidden = false; return; }
      try {
        const blob = await stamp(file, S, stage);
        const n = list.filter((p) => p.stage === stage).length + 1;
        list.push({ stage, at: new Date(file.lastModified || Date.now()).toISOString(), blob });
        await keep(); draw(); renderLeave();
        let saved = null;                    // a copy in the report folder, when there is one; never a pile of downloads
        if (await dirReady(false)) { try { saved = await writeToDir(blob, `${safeName(S.session.meterSerial)}_${FILE[stage]}_${n}.jpg`); refreshReportDir(); } catch { saved = null; } }
        msg.textContent = (saved ? T('Poza e salvată în dosarul „{0}” ca {1}.', reportDir.name, saved) + ' ' : '') + T('Poza intră în raportul PDF.');
        msg.hidden = false;
      } catch (e) { msg.textContent = T('Nu am putut citi fotografia: {0}', e.message); msg.hidden = false; }
    }
    $('iphoto-mount').onchange = (ev) => { const f = ev.target.files[0]; ev.target.value = ''; add(f, 'mount'); };
    $('iphoto-start').onchange = (ev) => { const f = ev.target.files[0]; ev.target.value = ''; add(f, 'start'); };
    $('iphoto-unit').onchange = (ev) => { const f = ev.target.files[0]; ev.target.value = ''; add(f, 'unit'); };
    return {
      // while measuring: under the installation card; at the end: in the report card, above "save"
      place(s, kind) {
        const card = $('iphoto-card');
        card.hidden = !s;
        if (!s) return;
        sync();
        const end = kind === 'done' || kind === 'check';
        const ref = end ? $('readings-card') : $('align-error');
        if (card.nextElementSibling !== ref) ref.parentNode.insertBefore(card, ref);
        card.classList.toggle('inside', end);
        draw();
      },
      count: () => list.length,
      async vvsFiles() {                       // for the case in VVS-dialog: e.g. 84751491_unit_1_20261126-1549.jpg
        await sync();
        const m = safeName(S.session.meterSerial), out = [];
        for (const st of ['mount', 'start', 'unit']) {
          list.filter((p) => p.stage === st).forEach((p, i) => out.push({ name: `${m}_${FILE[st]}_${i + 1}_${fileStamp(p.at)}.jpg`, blob: p.blob }));
        }
        return out;
      },
      countOf: (st) => list.filter((p) => p.stage === st).length,
      async files() {
        await sync();
        const name = { mount: T('La montaj'), start: T('La punerea în funcțiune'), unit: T('Vandvarmer / unit') };
        return list.map((p, i) => ({ name: `${name[p.stage]} ${i + 1}`, blob: p.blob }));
      },
      async pages() {
        await sync();
        const out = [];
        for (const st of ['mount', 'start', 'unit']) {
          list.filter((q) => q.stage === st).forEach((p) => out.push(p));
        }
        const res = [];
        for (const p of out) {
          try {
            const bmp = await createImageBitmap(p.blob), c = document.createElement('canvas');
            c.width = bmp.width; c.height = bmp.height; c.getContext('2d').drawImage(bmp, 0, 0);
            const same = out.filter((q) => q.stage === p.stage);
            res.push({ canvas: c, title: T(STAGES[p.stage]) + (same.length > 1 ? ` ${same.indexOf(p) + 1}` : '') });
          } catch { /* unreadable: left out */ }
        }
        return res;
      },
      // asked once per session before a report is saved without any installation photo
      async ask(then) {
        await sync();
        const noUnit = !list.some((p) => p.stage === 'unit');
        if (asked || (list.length && !noUnit) || !S || S.session.status === 'CHECK') { then(); return; }
        asked = true;
        $('iask-title').textContent = T(list.length ? 'Lipsește poza cu vandvarmer / unit' : 'Nu ai nicio poză cu instalația');
        $('iask-text').textContent = T(list.length ? 'Poza cu plăcuța de tip arată ce unitate e montată la adresă. Fă una înainte de raport.'
          : 'Pozele de la montaj și de la punerea în funcțiune arată cum a fost lăsată instalația. Fă cel puțin una înainte de raport, și una cu vandvarmer / unit.');
        $('iphoto-ask').hidden = false;
        $('iask-no').onclick = () => { $('iphoto-ask').hidden = true; then(); };
        $('iask-yes').onclick = () => {
          $('iphoto-ask').hidden = true;
          const card = $('iphoto-card');
          card.scrollIntoView({ behavior: 'smooth', block: 'start' });
          card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash');
        };
      },
      forget() {
        if (key) kv.del(key).catch(() => {});
        for (const p of list) if (p.url) URL.revokeObjectURL(p.url);
        key = null; list = []; asked = false;
      },
    };
  })();

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
  // a value needs at least one digit: dashes alone ("---" on a display that is changing) are no reading
  const cleanValue = (v) => { const c = String(v || '').replace(/,/g, '.').replace(/[^0-9.\-]/g, '').slice(0, 16); return /\d/.test(c) ? c : ''; };

  function renderReadings() {
    setTimeout(renderLeave, 0);
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
      $('lcd-tip').textContent = T('Arată {0} pe contor și ține tot afișajul în chenar, cam la 15 cm. Prea aproape, camera nu mai focalizează: folosește zoomul.', r.k === '*' ? T('registrul') : r.k);
      $('lcd-live').textContent = '…';
      $('lcd-frame').className = 'lcd-frame';
      $('lcd-error').hidden = true; $('lcd-torch').hidden = true; $('lcd-bright').hidden = true; $('lcd-dark').hidden = true;
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
        // Zoom, so the phone stays far enough for the camera to focus (a meter display is small).
        // The camera's own zoom when it has one (more detail); otherwise the picture is enlarged.
        zoomHw = caps.zoom && caps.zoom.max > caps.zoom.min ? caps.zoom : null;
        zoomTrack = track;
        // start at 2× with the camera's zoom; an enlarged picture starts at 1× (the installer can zoom)
        await setZoom(Number(store.get(zoomHw ? 'lcdZoom' : 'lcdZoomSw', zoomHw ? 2 : 1)) || 1);
        // brighter / darker picture where the camera allows it (dim cellars, or glare on the glass)
        if (caps.exposureCompensation && caps.exposureCompensation.max > caps.exposureCompensation.min) {
          $('lcd-bright').hidden = false; $('lcd-dark').hidden = false;
          if (caps.exposureMode && caps.exposureMode.includes('continuous')) track.applyConstraints({ advanced: [{ exposureMode: 'continuous' }] }).catch(() => {});
        }
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
          // a row of only 1s is what the edge of a cut-off display looks like: never taken as a reading
          const ok = res.text && /\d/.test(res.text) && res.text.indexOf('?') < 0 && !/^1{5,}$/.test(res.text.replace(/[^0-9]/g, ''));
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
      const v = res && res.text ? cleanValue(res.text) : '';
      if (v) { r.value = v; r.read = v; r.src = how; }
      else if (!r.value) r.src = null;                 // nothing readable: the picture only
      if (res && res.img) r.img = res.img;
      r.ts = new Date().toISOString();
      saveReadings(); renderReadings();
      if (navigator.vibrate && v) navigator.vibrate(80);
    }
    function close() {
      clearTimeout(timer);
      if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
      $('lcd-video').srcObject = null; $('lcd-video').style.transform = '';
      $('lcd-reader').hidden = true;
    }
    $('lcd-close').onclick = close;
    $('lcd-use').onclick = () => {
      if (best) { finish(best, 'camera'); return; }
      const v = $('lcd-video');
      finish(v.videoWidth ? { text: '', img: snapshot(v, frameRegion(v)) } : null, 'manual');
    };
    let zoomHw = null, zoomTrack = null, zoom = 1;
    async function setZoom(z) {
      const lo = zoomHw ? Math.max(1, zoomHw.min) : 1, hi = zoomHw ? Math.min(zoomHw.max, 6) : 3;
      zoom = Math.round(Math.min(hi, Math.max(lo, z)) * 2) / 2;
      if (zoomHw && zoomTrack) {
        try { await zoomTrack.applyConstraints({ advanced: [{ zoom }] }); $('lcd-video').style.transform = ''; }
        catch { $('lcd-video').style.transform = `scale(${zoom})`; }
      } else $('lcd-video').style.transform = zoom > 1 ? `scale(${zoom})` : '';
      $('lcd-zoom-l').textContent = `Zoom ${String(zoom).replace('.', ',')}×`;
      $('lcd-zout').disabled = zoom <= lo; $('lcd-zin').disabled = zoom >= hi;
      store.set(zoomHw ? 'lcdZoom' : 'lcdZoomSw', zoom);
      if (voter) { voter = new window.LinkIQLcd.Voter(3, 10); best = null; setUse(); }   // count again on the new picture
    }
    $('lcd-zin').onclick = () => setZoom(zoom + 0.5);
    $('lcd-zout').onclick = () => setZoom(zoom - 0.5);
    async function exposure(dir) {
      if (!stream) return;
      const track = stream.getVideoTracks()[0], c = track.getCapabilities().exposureCompensation;
      const now = track.getSettings().exposureCompensation || 0, step = Math.max(c.step || 0, (c.max - c.min) / 8);
      const next = Math.min(c.max, Math.max(c.min, now + dir * step));
      try { await track.applyConstraints({ advanced: [{ exposureCompensation: next }] }); } catch { /* not supported after all */ }
      voter = new window.LinkIQLcd.Voter(3, 10); best = null; setUse();   // start counting again with the new picture
    }
    $('lcd-bright').onclick = () => exposure(1);
    $('lcd-dark').onclick = () => exposure(-1);
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
            const score = res.text && /\d/.test(res.text) && res.text.indexOf('?') < 0 ? res.quality + digitCount(res.text) / 10 : 0;
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
  async function drawReadings(x, P, W, y, section, font, text, mark = () => {}) {
    const list = filledReadings();
    if (!list.length) return y;
    y = section(T('Citirile contorului'));
    for (const r of list) {
      mark(y);
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
    const inst = elsynLine(v.es);
    if (inst) lines.push(inst);
    if (v.comment && v.comment.trim()) lines.push(VT.commentPrefix + v.comment.trim().replace(/\s+/g, ' '));
    return lines.join('\n');
  }
  const ES = { anlaeg: ['Direkte', 'Indirekte', 'Direkte med bladesløjfe'], vv: ['Veksler', 'Beholder', 'Unit'],
    unit: ['APV', 'Gemina Termix', 'Hoval', 'Metrotherm', 'Redan', 'Wavin'], yn: ['Ja', 'Nej'] };
  function elsynState() {
    const v = vvsState();
    if (!v.es) v.es = { anlaeg: null, vv: null, unit: null, model: '', haner: null, plomb: null };
    return v.es;
  }
  // one line in Ny aktivitet, never with the result words the robot looks for
  function elsynLine(es) {
    if (!es) return '';
    const p = [];
    if (es.anlaeg) p.push('Anlæg ' + es.anlaeg);
    if (es.vv) p.push('Vandvarmer ' + es.vv);
    if (es.unit) p.push('Unit ' + es.unit);
    if (es.model && es.model.trim()) p.push('Model ' + es.model.trim().replace(/\s+/g, ' '));
    if (es.haner) p.push('Hovedhaner lukket ' + es.haner);
    if (es.plomb) p.push('Plomberet ' + es.plomb);
    return p.length ? 'Installation: ' + p.join(', ') : '';
  }
  function renderElsyn() {
    if (!S) return;
    $('elsyn-card').hidden = S.session.status === 'CHECK';
    const es = elsynState(), save = () => { store.set('ui', ui); renderElsyn(); renderVvs(); vvsQueueTouch(); };
    const one = (id, key, opts) => chipRow($(id), opts.map((o) => [o, o]), es[key], (o) => { es[key] = es[key] === o ? null : o; save(); });
    one('ch-es-anlaeg', 'anlaeg', ES.anlaeg); one('ch-es-vv', 'vv', ES.vv); one('ch-es-unit', 'unit', ES.unit);
    one('ch-es-haner', 'haner', ES.yn); one('ch-es-plomb', 'plomb', ES.yn);
    const showUnit = !es.vv || es.vv === 'Unit';      // brand row only matters for a unit
    $('ch-es-unit').hidden = !showUnit; $('ch-es-unit').previousElementSibling.hidden = !showUnit;
    if (!showUnit && es.unit) es.unit = null;
    if (document.activeElement !== $('es-model')) $('es-model').value = es.model || '';
    $('es-model').onchange = () => { es.model = $('es-model').value.trim().slice(0, 60); save(); };
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
    if (S.session.address) e.addr = S.session.address;
    if (fileName && blob) {
      const ext = (fileName.match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase();
      const old = e.files.find((f) => f.toLowerCase().endsWith(ext));
      if (old) { e.files = e.files.filter((f) => f !== old); try { await kv.set('vvsf:' + id + ':' + old, null); } catch { /* */ } }
      e.files.push(fileName);
      try { await kv.set('vvsf:' + id + ':' + fileName, blob); } catch { /* */ }
    }
    await vqSave(q);
  }
  /** Keep the report just saved (and the PDF, if there is one); every other file of this visit is
   *  replaced by the current set, so a deleted photo does not reach the case. */
  async function vqSetExtras(mainName, extra) {
    const id = vqId(), q = await vqLoad(), e = q.find((x) => x.id === id);
    if (!e) return;
    const keepF = e.files.filter((f) => f === mainName || /\.pdf$/i.test(f));
    for (const f of e.files) if (!keepF.includes(f)) { try { await kv.set('vvsf:' + id + ':' + f, null); } catch { /* */ } }
    e.files = keepF;
    for (const x of extra) {
      if (e.files.includes(x.name)) continue;
      try { await kv.set('vvsf:' + id + ':' + x.name, x.blob); e.files.push(x.name); } catch { /* storage full: the report itself is kept */ }
    }
    if (e.state === 'sent') e.state = 'pending';
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
        await rememberSent([e]);
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
    $('pending-card').hidden = !waiting.length;
    $('tab-badge').hidden = !waiting.length; $('tab-badge').textContent = waiting.length;
    $('sync-sum').textContent = sum;
    syncImportLabels();
    $('vvsq-send').hidden = !waiting.length;
    $('vvsq-send').textContent = T('Trimite cele care așteaptă ({0})', waiting.length);
    const done = q.filter((e) => e.state === 'sent' && !e.cleaned && e.files.length);
    const nFiles = done.reduce((n, e) => n + e.files.length, 0);
    $('sync-clean').hidden = !nFiles;
    $('sync-clean').textContent = reportDir ? T('Șterge din „{0}” fișierele care sunt deja pe caz ({1})', reportDir.name, nFiles)
      : T('Șterge din aplicație copiile care sunt deja pe caz ({0})', nFiles);
    const list = $('sync-list');
    list.replaceChildren();
    let day = null;
    for (const e of q) {
      const d = (e.imported && e.state !== 'sent' ? e.created : e.updated || e.created).slice(0, 10);
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
      meta.textContent = [fmtTime(e.imported && e.state !== 'sent' ? e.created : e.updated || e.created), e.imported ? T('din dosar') : '', e.status || '', e.files.length ? (e.cleaned ? T('fișierele șterse de pe telefon') : '') : T('fără fișiere')].filter(Boolean).join(' · ');
      card.append(meta);
      if (e.files.length && !e.cleaned) {
        const fl = document.createElement('div');
        for (const f of e.files) {
          const b = document.createElement('button'); b.type = 'button'; b.className = 'file-link'; b.textContent = f;
          b.onclick = async () => {
            const blobs = [];
            for (const g of e.files) { try { const x = await kv.get('vvsf:' + e.id + ':' + g); if (x) blobs.push({ name: g, blob: x }); } catch { /* */ } }
            viewer.open(blobs, Math.max(0, blobs.findIndex((x) => x.name === f)));
          };
          fl.append(b);
        }
        card.append(fl);
      }
      if (e.imported && e.state !== 'sent') card.append(importForm(e));
      else if (e.text) { const pre = document.createElement('pre'); pre.textContent = e.text; card.append(pre); }
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
    renderLeave();
  }
  // A report added from the folder has no session behind it: the installer picks the fixed words
  // and the status here. Nothing chosen: li only puts the file on the case.
  function importForm(e) {
    const v = e.v || (e.v = { result: null, faults: [], status: VT.statuses[0] || null, comment: '' });
    const box = document.createElement('div'); box.className = 'mini';
    const save = async () => {
      e.text = vvsText(v); e.status = v.status; e.updated = new Date().toISOString();
      const q = await vqLoad(), x = q.find((y) => y.id === e.id);
      if (x) { x.v = v; x.text = e.text; x.status = e.status; x.updated = e.updated; await vqSave(q); }
    };
    const q1 = document.createElement('p'); q1.className = 'q'; q1.textContent = T('Rezultat');
    const res = document.createElement('div'); res.className = 'chips';
    chipRow(res, VT.results.map((r) => [r, r]), v.result, (r) => { v.result = v.result === r ? null : r; if (v.result === VT.results[0]) v.faults = []; save(); });
    box.append(q1, res);
    if (v.result !== VT.results[0]) {
      const q2 = document.createElement('p'); q2.className = 'q'; q2.textContent = T('Erori');
      const fr = document.createElement('div'); fr.className = 'chips';
      for (const f of VT.faults) {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = f;
        const on = v.faults.includes(f); b.className = on ? 'on' : ''; b.setAttribute('aria-pressed', String(on));
        b.onclick = () => { v.faults = on ? v.faults.filter((y) => y !== f) : [...v.faults, f]; if (v.faults.length && !v.result) v.result = 'Fejl'; save(); };
        fr.append(b);
      }
      box.append(q2, fr);
    }
    const q3 = document.createElement('p'); q3.className = 'q'; q3.textContent = T('Statusul cazului');
    const st = document.createElement('div'); st.className = 'chips';
    chipRow(st, VT.statuses.map((x) => [x, x]), v.status, (x) => { v.status = x; save(); });
    const cm = document.createElement('input'); cm.type = 'text'; cm.maxLength = 500; cm.value = v.comment || ''; cm.placeholder = T('Comentariu (opțional)');
    cm.onchange = () => { v.comment = cm.value; save(); };
    const pre = document.createElement('pre'); pre.textContent = e.text || T('Fără rezultat ales: li pune doar fișierul pe caz.');
    box.append(q3, st, cm, pre);
    return box;
  }

  // File names that VVS-dialog has confirmed, kept longer than the list itself, so a folder
  // scan does not offer again what is already on a case.
  async function rememberSent(entries) {
    let names = [];
    try { names = (await kv.get('vvssent')) || []; } catch { /* */ }
    const set = new Set(names);
    for (const e of entries) for (const f of e.files || []) set.add(f.toLowerCase());
    try { await kv.set('vvssent', [...set].slice(-3000)); } catch { /* */ }
  }

  // Reports in the folder (or picked as files) can be added to the list, so a day that was
  // never sent is not lost: one report per meter, the newest, PDF before image.
  const REPORT_FILE = /^(\d{6,12})(_status)?[^.\/]*\.(pdf|png)$/i;
  async function importCandidates(files) {
    const q = await vqLoad();
    let sent = [];
    try { sent = (await kv.get('vvssent')) || []; } catch { /* */ }
    const known = new Set([...sent, ...q.flatMap((e) => e.files.map((f) => f.toLowerCase()))]);
    const best = new Map();
    for (const f of files) {
      const m = f.name.match(REPORT_FILE);
      if (!m) continue;
      const k = m[1] + (m[2] ? '_status' : ''), pdf = m[3].toLowerCase() === 'pdf', old = best.get(k);
      const day = (t) => new Date(t).toDateString();
      if (!old || (day(f.lastModified) === day(old.file.lastModified) ? pdf && !old.pdf : f.lastModified > old.file.lastModified)) best.set(k, { meter: m[1], file: f, pdf });
    }
    const limit = Date.now() - 30 * 864e5;
    return [...best.values()].sort((a, b) => b.file.lastModified - a.file.lastModified)
      .map((c) => ({ ...c, known: known.has(c.file.name.toLowerCase()), tick: !known.has(c.file.name.toLowerCase()) && c.file.lastModified > limit }));
  }
  function showImport(cands) {
    const msg = $('sync-import-msg');
    if (!cands.length) { msg.textContent = T('Nu am găsit rapoarte. Numele fișierului trebuie să înceapă cu seria contorului.'); msg.hidden = false; return; }
    const list = $('import-list');
    list.replaceChildren();
    const boxes = cands.map((c) => {
      const l = document.createElement('label'); if (c.known) l.className = 'known';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = c.tick;
      const t = document.createElement('span');
      t.textContent = c.meter;
      const sm = document.createElement('small');
      sm.textContent = [fmtTime(new Date(c.file.lastModified).toISOString()), c.file.name, c.known ? T('deja în listă sau pe caz') : null].filter(Boolean).join(' · ');
      t.append(sm); l.append(cb, t); list.append(l);
      return cb;
    });
    const count = () => { $('import-ok').textContent = T('Adaugă în listă ({0})', boxes.filter((b) => b.checked).length); };
    boxes.forEach((b) => { b.onchange = count; }); count();
    $('import-sheet').hidden = false;
    $('import-cancel').onclick = () => { $('import-sheet').hidden = true; };
    $('import-ok').onclick = async () => {
      $('import-sheet').hidden = true;
      const q = await vqLoad();
      let n = 0;
      for (let i = cands.length - 1; i >= 0; i--) {
        if (!boxes[i].checked) continue;
        const c = cands[i], id = 'imp-' + c.meter + '-' + c.file.lastModified;
        if (q.some((e) => e.id === id)) continue;
        try { await kv.set('vvsf:' + id + ':' + c.file.name, new Blob([await c.file.arrayBuffer()], { type: c.file.type || (c.pdf ? 'application/pdf' : 'image/png') })); }
        catch { continue; }
        q.unshift({ id, meter: c.meter, created: new Date(c.file.lastModified).toISOString(), updated: new Date().toISOString(),
          files: [c.file.name], state: 'pending', imported: true, text: '', status: '' });
        n++;
      }
      await vqSave(q);
      msg.textContent = n ? T('{0} rapoarte adăugate. Alege rezultatul pe fiecare, apoi trimite.', n) : T('Nimic nou de adăugat.');
      msg.hidden = false;
    };
  }
  $('sync-import').onclick = async () => {
    if (reportDir && canPickDir) {
      if (!(await askDir())) { $('sync-files').click(); return; }
      const files = [];
      try { for await (const h of reportDir.values()) if (h.kind === 'file' && REPORT_FILE.test(h.name)) files.push(await h.getFile()); }
      catch { /* folder gone */ }
      showImport(await importCandidates(files));
    } else $('sync-files').click();
  };
  $('sync-import2').onclick = () => $('sync-files').click();
  $('sync-files').onchange = async (ev) => {
    const files = [...ev.target.files];
    ev.target.value = '';
    if (files.length) showImport(await importCandidates(files));
  };
  function syncImportLabels() {
    const dir = reportDir && canPickDir;
    $('sync-import').textContent = dir ? T('Caută rapoarte în dosarul „{0}”', reportDir.name) : T('Adaugă rapoarte din fișiere');
    $('sync-import2').hidden = !dir;
  }

  // Files that VVS-dialog has confirmed: offered for deletion (folder and the app's own copy).
  $('sync-clean').onclick = async () => {
    const q = await vqLoad(), done = q.filter((e) => e.state === 'sent' && !e.cleaned && e.files.length);
    if (!done.length) return;
    let gone = 0, kept = 0;
    const folder = reportDir && (await askDir());
    for (const e of done) {
      for (const f of e.files) {
        try { await kv.set('vvsf:' + e.id + ':' + f, null); } catch { /* */ }
        if (folder) { try { await reportDir.removeEntry(f); gone++; } catch { kept++; } }
      }
      e.cleaned = true;
    }
    await vqSave(q);
    const msg = $('sync-clean-msg');
    msg.textContent = folder ? T('Șterse: {0} fișiere din „{1}”.', gone, reportDir.name) + (kept ? ' ' + T('{0} nu mai erau în dosar.', kept) : '')
      : T('Copiile din aplicație sunt șterse. Fișierele din Descărcări le ștergi din aplicația Fișiere: au seria contorului în nume.');
    msg.hidden = false;
    refreshReportDir();
  };
  $('vvsq-open').onclick = () => showView('sync');
  $('sync-back').onclick = () => showView(lastView || 'start');

  // Hand-over to "li": LinkIQ opens VVS-dialog itself, so the page there can ask LinkIQ
  // (window.opener) for the waiting reports and answer with the result of each one.
  // When that link is lost (phone apps), the meter, text and status travel in the tab name,
  // and the installer picks the files in the panel.
  const VVS_ORIGIN = 'https://vvsdialog.kmd.dk';
  let vvsWin = null, vvsOffer = [], vvsFs = null;
  // The work for li travels three ways: window.opener (with the files), the tab name, and the
  // address (?liq=…). On Android the installed app would open VVS-dialog in a small in-app
  // browser without bookmarks; an intent: address opens it straight in Chrome instead.
  const isAndroidApp = () => /Android/i.test(navigator.userAgent) && !/EdgA\//.test(navigator.userAgent) && window.matchMedia('(display-mode: standalone)').matches;
  // How the installed app on Android hands VVS-dialog to the real Chrome (with address bar and
  // bookmarks). Phones differ, so the installer can try the ways in the li sheet; the one that
  // works is remembered.
  const openWay = () => store.get('vvsOpen', 'intent');
  function androidUrl(way, url) {
    const u = new URL(url), rest = u.host + u.pathname + u.search;
    if (way === 'gc') return 'googlechrome://navigate?url=' + encodeURIComponent(url);
    if (way === 'intent2') return 'intent://' + rest + '#Intent;scheme=https;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;launchFlags=0x10000000;end';
    return 'intent://' + rest + '#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=' + encodeURIComponent(url) + ';end';
  }
  for (const [id, way] of [['open-a', 'intent'], ['open-b', 'intent2'], ['open-c', 'gc'], ['open-d', 'tab']]) {
    const b = $(id);
    if (!b) continue;
    b.onclick = () => {
      store.set('vvsOpen', way);
      $('open-msg').textContent = T('Metoda {0} e salvată. Ai acum Chrome cu bara de adrese?', b.textContent.trim());
      $('open-msg').hidden = false;
      if (way === 'tab') window.open(VVS_HOME, '_blank'); else location.href = androidUrl(way, VVS_HOME);
    };
  }

  async function openVvs(items) {
    vvsOffer = items.map((e) => e.id); vvsFs = null;
    const first = items[0], b = location.origin + location.pathname;
    const work = b64url(new TextEncoder().encode(JSON.stringify(items.slice(0, 30).map((e, i) => ({ m: e.meter, s: e.status || '', t: e.text || '', id: e.id, ...(i ? {} : { b }) })))));
    const path = 'Home.aspx?liq=' + work;
    if (isAndroidApp() && openWay() !== 'tab') {
      location.href = androidUrl(openWay(), VVS_ORIGIN + '/' + path);
      copyText('LIQ1:' + work);                                // also for li after a login (the address is lost then)
      return;
    }
    // Android freezes the LinkIQ tab while VVS-dialog is shown, so li cannot ask it for anything:
    // the report files and li's own code travel in the tab name (read quickly, the tap still counts).
    let files = '';
    try {
      const map = {}; let size = 0;
      for (const e of items) {
        for (const f of e.files || []) {
          const blob = await kv.get('vvsf:' + e.id + ':' + f);
          if (!blob || (size += blob.size) > 6e6) continue;
          const bytes = new Uint8Array(await blob.arrayBuffer());
          let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
          (map[e.id] = map[e.id] || []).push({ n: f, t: blob.type || '', d: btoa(bin) });
        }
      }
      if (Object.keys(map).length) files = '|LIQFILES:' + b64url(new TextEncoder().encode(JSON.stringify(map)));
    } catch { files = ''; }
    vvsWin = window.open(VVS_ORIGIN + '/' + path + '#linkiq=' + first.meter,
      'linkiq_j' + work + files + '|LIQBACK:' + encodeURIComponent(location.origin + location.pathname) +
      '|LIQCODE:' + encodeURIComponent(window.LINKIQ_VVS_CODE || ''));   // the short li finds its code here
  }
  window.addEventListener('message', async (ev) => {
    if (ev.origin !== VVS_ORIGIN || !ev.data || typeof ev.data !== 'object' || !ev.data.liq) return;
    if (vvsWin && ev.source !== vvsWin) return;
    const q = await vqLoad();
    if (ev.data.liq === 'code') {                       // the short li asks for the real code
      ev.source.postMessage({ liq: 'code', code: window.LINKIQ_VVS_CODE || '' }, VVS_ORIGIN);
      return;
    }
    if (ev.data.liq === 'hello' && vvsFs) {             // li asks for work: only the address of this meter
      ev.source.postMessage({ liq: 'items', items: [{ id: 'fs-' + vvsFs, meter: vvsFs, kind: 'fs' }] }, VVS_ORIGIN);
      vvsFs = null;
      return;
    }
    if (ev.data.liq === 'fs') { fsSave(ev.data); return; }
    if (ev.data.liq === 'hello') {
      const items = [];
      for (const e of q.filter((x) => vvsOffer.includes(x.id))) {
        const files = [];
        for (const f of e.files) { try { const b = await kv.get('vvsf:' + e.id + ':' + f); if (b) files.push({ name: f, blob: b }); } catch { /* */ } }
        items.push({ id: e.id, meter: e.meter, status: e.status, text: e.text, files, addr: e.addr || '' });
      }
      ev.source.postMessage({ liq: 'items', items }, VVS_ORIGIN);
    } else if (ev.data.liq === 'result') {
      const e = q.find((x) => x.id === ev.data.id);
      if (!e) return;
      e.state = ev.data.ok ? 'sent' : 'error'; e.msg = ev.data.msg || ''; e.cc = ev.data.cc || e.cc;
      e.updated = new Date().toISOString();
      if (e.state === 'sent') await rememberSent([e]);
      await vqSave(q);
    }
  });
  // li could not reach LinkIQ (Android freezes the tab): it sends the installer back here with the results.
  async function vvsResultsFromAddress() {
    const m = location.hash.match(/liqdone=([\w-]+)/);
    if (!m) return false;
    history.replaceState(null, '', location.pathname + location.search);
    let res = [];
    try { res = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)))); } catch { return false; }
    const q = await vqLoad();
    for (const r of res) {
      const e = q.find((x) => x.id === r.id);
      if (!e) continue;
      e.state = r.ok ? 'sent' : 'error'; e.msg = r.msg || ''; e.cc = r.cc || e.cc; e.updated = new Date().toISOString();
    }
    await rememberSent(q.filter((e) => e.state === 'sent'));
    await vqSave(q);
    showView('sync');
    return true;
  }
  // ---------------------------------------------------------------- Forbrugssted from VVS-dialog
  // After the meter number is known, li reads the consumption site (Forbrugssted) of the meter in
  // VVS-dialog - not the customer's own address, which can be a company seat elsewhere - and the
  // installer confirms on site that this is where he stands. No match by text: addresses are
  // written in many ways; the installer decides. No case in VVS-dialog is noted in the report.
  const fsAll = () => store.get('fsaddr', {}) || {};
  const fsMeter = () => String(S ? S.session.meterSerial : $('meter').value).replace(/\D/g, '');
  function fsFor(m) { return m ? fsAll()[m] || null : null; }
  function fsFull(x) { return [x.a, x.b].filter(Boolean).join(', '); }
  function fsSave(d) {
    const m = String(d.m || '').replace(/\D/g, '');
    if (!/^\d{6,12}$/.test(m)) return;
    const all = fsAll();
    all[m] = { m, f: !!d.f, a: String(d.a || '').slice(0, 120), b: String(d.b || '').slice(0, 80), n: Number(d.n) || 0,
      ty: String(d.ty || '').slice(0, 120), err: d.err ? String(d.err).slice(0, 160) : '', at: new Date().toISOString(), answer: null };
    for (const k of Object.keys(all).sort((x, y) => (all[y].at || '').localeCompare(all[x].at || '')).slice(50)) delete all[k];
    store.set('fsaddr', all);
    if (!S && !$('meter').value.trim()) $('meter').value = m;
    renderFs();
    $('fs-box').scrollIntoView({ block: 'center' });
  }
  function fsAnswer(ans) {
    const all = fsAll(), x = all[fsMeter()];
    if (!x) return;
    x.answer = ans; x.answeredAt = new Date().toISOString();
    store.set('fsaddr', all);
    if (ans === 'yes' && !S) $('addr').value = fsFull(x);
    renderFs();
  }
  /** [colour, text] for the report. */
  function fsReportLine(x) {
    if (!x) return [INK.gray, T('neverificat')];
    const when = fmtTime(x.at);
    if (x.err) return [INK.amber, T('nu s-a putut verifica ({0})', when)];
    if (!x.f) return [INK.red, T('Contorul nu există în VVS-dialog (verificat {0}).', when)];
    const where = fsFull(x) || T('adresa nu a fost găsită pe pagină');
    const cases = x.n ? '' : ' · ' + T('niciun caz deschis în VVS-dialog ({0})', when);
    if (x.answer === 'yes') return [cases ? INK.amber : INK.green, T('locul de consum confirmat de montor') + cases];   // the address row above shows it
    if (x.answer === 'no') return [INK.red, T('locul de consum: {0}', where) + ' · ' + T('montorul: NU este această adresă') + cases];
    return [INK.amber, T('locul de consum: {0}', where) + ' · ' + T('neconfirmat') + cases];
  }
  function renderFs() {
    const box = $('fs-box'), m = fsMeter(), x = fsFor(m);
    const target = S ? $('elsyn-card') : $('addr-hint');          // at the start under the address; in a visit, in the report box
    if (S) { if (box.nextElementSibling !== target) target.parentNode.insertBefore(box, target); }
    else if (box.previousElementSibling !== target) target.after(box);
    box.hidden = !/^\d{6,12}$/.test(m);
    box.classList.remove('ok', 'bad');
    $('fs-ask').hidden = true; $('fs-text').hidden = !x;
    $('fs-btn').textContent = T(x ? 'Ia din nou din VVS-dialog' : 'Ia adresa din VVS-dialog');
    if (!x) { $('fs-sub').textContent = T('Citește locul de consum al contorului {0} din VVS-dialog și confirmă că ești acolo.', m); return; }
    if (x.err) {
      $('fs-text').textContent = T('VVS-dialog nu a putut fi citit.');
      $('fs-sub').textContent = x.err === 'LOGIN' ? T('Autentifică-te în VVS-dialog și încearcă din nou.') : x.err;
      return;
    }
    if (!x.f) {
      box.classList.add('bad');
      $('fs-text').textContent = T('Contorul nu există în VVS-dialog.');
      $('fs-sub').textContent = T('În raport se notează că nu există caz în VVS-dialog la data raportului.');
      return;
    }
    $('fs-text').textContent = fsFull(x) || T('adresa nu a fost găsită pe pagină');
    const cases = x.n ? T('{0} caz(uri) deschise: {1}', x.n, x.ty || '–') : T('Niciun caz deschis pentru contor în VVS-dialog: se notează în raport.');
    if (x.answer === 'yes') { box.classList.add(x.n ? 'ok' : 'bad'); $('fs-sub').textContent = T('Confirmat: ești la această adresă.') + ' ' + cases; }
    else if (x.answer === 'no') { box.classList.add('bad'); $('fs-sub').textContent = T('Ai răspuns că NU ești la această adresă. Verifică cazul înainte de montaj.') + ' ' + cases; }
    else { $('fs-sub').textContent = T('Ești la această adresă?') + ' ' + cases; $('fs-ask').hidden = false; }
  }
  function openFs(m) {
    const b = location.origin + location.pathname;
    const work = b64url(new TextEncoder().encode(JSON.stringify([{ m, k: 'fs', id: 'fs-' + m, b }])));
    const path = 'Home.aspx?liq=' + work;
    vvsOffer = []; vvsFs = m;
    $('fs-sub').textContent = T('În VVS-dialog apasă li. Adresa vine înapoi aici.');
    if (isAndroidApp() && openWay() !== 'tab') { location.href = androidUrl(openWay(), VVS_ORIGIN + '/' + path); copyText('LIQ1:' + work); return; }
    vvsWin = window.open(VVS_ORIGIN + '/' + path + '#linkiq=' + m, 'linkiq_j' + work + '|LIQBACK:' + encodeURIComponent(b) +
      '|LIQCODE:' + encodeURIComponent(window.LINKIQ_VVS_CODE || ''));
  }
  function fsFromAddress() {                       // li sent the installer back with the address in the link
    const h = location.hash.match(/liqfs=([\w-]+)/);
    if (!h) return;
    history.replaceState(null, '', location.pathname + location.search);
    try { fsSave(JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(h[1].replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))))); } catch { /* broken link */ }
  }
  $('fs-btn').onclick = () => { const m = fsMeter(); if (/^\d{6,12}$/.test(m)) openFs(m); };
  $('fs-yes').onclick = () => fsAnswer('yes');
  $('fs-no').onclick = () => fsAnswer('no');
  $('meter').addEventListener('input', () => { if (!S) renderFs(); });

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
    if (isAndroidApp()) return;
    copyText(m).then((ok) => {
      $('vvs-msg').textContent = ok
        ? T('Seria {0} este copiată. În VVS-dialog scrie li în bara de adrese și alege bookmark-ul cu steluță.', m)
        : T('În VVS-dialog scrie li în bara de adrese și alege bookmark-ul cu steluță. Seria contorului: {0}.', m);
    });
  };
  // The bookmark itself is short (Android Chrome cuts long ones); it gets the real code from LinkIQ.
  const vvsCode = window.LINKIQ_VVS_LOADER || window.LINKIQ_VVS_BOOKMARK || '';
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
  $('vvs-copy2').onclick = async () => {
    const ok = await copyText('LIQCODE:' + (window.LINKIQ_VVS_CODE || ''));
    $('vvs-setup-msg').textContent = ok ? T('Codul complet e copiat. Deschide VVS-dialog în Chrome și apasă li: îl ia din clipboard și îl ține minte.') : T('Nu am putut copia.');
    $('vvs-setup-msg').hidden = false;
  };
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
    updateLocPerm().then(() => { if (locPerm === 'granted' && !gps) locate(true); });
    vqPrune();
    const back = vvsResultsFromAddress();       // results from li: the sync page is shown once boot is done
    fsFromAddress();
    sweepPhotos();
    splashSetup().catch(() => {});
    setTimeout(splashDone, 2500);                // never longer, whatever the start does
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
        if (s.session.status === 'ACTIVE') { enterSession(s); if (await back) showView('sync'); splashDone(); return; }
      } catch { /* fall through */ }
      store.del('session');
    }
    showStart(pairedName);
    if (await back) showView('sync');
    splashDone();
  })();
})();
