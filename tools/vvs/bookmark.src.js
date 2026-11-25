// LinkIQ "li" bookmark for VVS-dialog (runs on vvsdialog.kmd.dk, as the installer who is logged in).
// 1. Gets the work from LinkIQ: the waiting reports (files, text, status) through window.opener,
//    or meter, text and status from the tab name; otherwise it asks for the meter number.
// 2. Finds the open case of the meter (not "Afsluttet"/"Lukket"); several open: the installer picks.
// 3. Uploads the report files that are not on the case yet, writes "Ny aktivitet" with the fixed
//    text and the chosen case status (VVS-dialog's own "Gem" in its status window).
// 4. Reports the result back to LinkIQ and shows the case.
(async function () {
  var CLOSED = ['afsluttet', 'lukket'];
  var HOST = 'vvsdialog.kmd.dk';
  var NEW_LOG = 'ctl00$DefaultContent$CaseNewLogUC$';
  if (location.hostname !== HOST) { alert('LinkIQ: Åbn VVS-dialog og log ind først.'); return; }

  // ---------- panel
  var old = document.getElementById('linkiq-box');
  if (old) { old.remove(); }
  var box = document.createElement('div');
  box.id = 'linkiq-box';
  box.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:99999;background:#1f5e4f;color:#fff;' +
    'font:17px/1.4 Arial,sans-serif;padding:14px;max-height:100%;overflow:auto;box-shadow:0 2px 10px rgba(0,0,0,.5)';
  document.body.appendChild(box);
  function line(t, bold) {
    var p = document.createElement('div');
    p.textContent = t; p.style.margin = '0 0 8px'; p.style.whiteSpace = 'pre-wrap';
    if (bold) { p.style.fontWeight = 'bold'; }
    box.appendChild(p); return p;
  }
  function button(t, fn, main) {
    var b = document.createElement('button');
    b.type = 'button'; b.textContent = t;
    b.style.cssText = 'display:block;width:100%;margin:0 0 8px;padding:12px;font:16px Arial,sans-serif;text-align:left;border:0;border-radius:6px;' +
      (main ? 'background:#ffd23f;color:#111;font-weight:bold' : 'background:#fff;color:#111');
    b.onclick = fn; box.appendChild(b); return b;
  }
  function reset(t) { box.textContent = ''; line(t, true); }
  function closeBtn() { button('Luk', function () { box.remove(); }); }
  function choose(title, options) {          // options: [{label, value}] -> Promise(value)
    return new Promise(function (ok) {
      reset(title);
      options.forEach(function (o) { button(o.label, function () { ok(o.value); }, o.main); });
    });
  }
  var parser = new DOMParser();
  var wait = function (ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); };
  async function retry(fn) {                // poor mobile connections: try three times
    var last;
    for (var i = 0; i < 3; i++) {
      try { return await fn(); } catch (e) { last = e; await wait(1500 * (i + 1)); }
    }
    throw last;
  }
  async function page(url, opts) {
    var r = await retry(function () { return fetch(url, Object.assign({ credentials: 'same-origin' }, opts || {})); });
    var html = await r.text();
    return { res: r, url: r.url, html: html, doc: parser.parseFromString(html, 'text/html') };
  }
  function loggedOut(p) { return !p.doc.querySelector('form') || /login|logon|signin/i.test(p.url); }
  // All fields of an ASP.NET form, as the browser would send them, without any submit button.
  function formFields(form, change) {
    var q = new URLSearchParams();
    Array.prototype.forEach.call(form.querySelectorAll('input,select,textarea'), function (e) {
      if (!e.name || e.disabled) { return; }
      var t = (e.type || '').toLowerCase();
      if (t === 'submit' || t === 'button' || t === 'image' || t === 'file' || t === 'reset') { return; }
      if (change && Object.prototype.hasOwnProperty.call(change, e.name)) { return; }
      if ((t === 'checkbox' || t === 'radio') && !e.hasAttribute('checked')) { return; }
      if (e.tagName === 'SELECT') {
        var o = e.querySelector('option[selected]') || e.querySelector('option');
        if (o) { q.append(e.name, o.getAttribute('value') !== null ? o.getAttribute('value') : o.textContent); }
        return;
      }
      q.append(e.name, e.tagName === 'TEXTAREA' ? e.textContent : (e.getAttribute('value') || ''));
    });
    Object.keys(change || {}).forEach(function (k) { if (change[k] !== null) { q.append(k, change[k]); } });
    return q;
  }

  // ---------- 1. the work
  async function fromOpener() {
    if (!window.opener) { return null; }
    return new Promise(function (ok) {
      var done = false;
      window.addEventListener('message', function on(ev) {
        if (ev.source !== window.opener || !ev.data || ev.data.liq !== 'items') { return; }
        done = true; window.removeEventListener('message', on); ok(ev.data.items || []);
      });
      try { window.opener.postMessage({ liq: 'hello', v: 2 }, '*'); } catch (e) { ok(null); return; }
      setTimeout(function () { if (!done) { ok(null); } }, 2500);
    });
  }
  function tell(msg) { try { if (window.opener) { window.opener.postMessage(msg, '*'); } } catch (e) { /* LinkIQ closed */ } }
  function fromName() {
    var n = String(window.name || '');
    var j = n.match(/^linkiq_j([\w-]+)$/);
    if (j) {
      try {
        var b = atob(j[1].replace(/-/g, '+').replace(/_/g, '/'));
        var d = JSON.parse(decodeURIComponent(escape(b)));
        return [{ id: d.id, meter: d.m, status: d.s, text: d.t, files: [] }];
      } catch (e) { /* fall through */ }
    }
    var m = (location.hash.match(/linkiq=(\d+)/) || [])[1] || (n.match(/^linkiq_(\d+)$/) || [])[1];
    return m ? [{ meter: m, files: [] }] : null;
  }

  // ---------- 2. the open case of a meter
  async function findCase(m) {
    var here = location.pathname.match(/ShowCase\.aspx/i) && new URLSearchParams(location.search).get('cc');
    if (here && document.body.innerText.indexOf(m) >= 0) { return here; }
    var home = await page('/Home.aspx');
    var form = home.doc.querySelector('form');
    var inputs = form ? Array.prototype.slice.call(form.querySelectorAll('input')) : [];
    var meterInput = inputs.find(function (i) { return /meternumber/i.test(i.name || ''); });
    var searchBtn = inputs.find(function (i) { return (i.type || '').toLowerCase() === 'submit' && (i.value || '').trim() === 'Søg'; });
    if (!meterInput || !searchBtn) { throw new Error('LOGIN'); }
    var ch = {}; ch[meterInput.name] = m; ch[searchBtn.name] = searchBtn.value;
    var action = new URL(form.getAttribute('action') || 'Home.aspx', location.origin + '/Home.aspx');
    var r = await page(action.href, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: formFields(form, ch).toString() });
    if (!/ShowCustomer\.aspx/i.test(r.url)) { throw new Error('Måler ' + m + ' blev ikke fundet entydigt.'); }
    var seen = {}, cases = [];
    Array.prototype.forEach.call(r.doc.querySelectorAll('[onclick*="ShowCase.aspx"]'), function (e) {
      var cc = ((e.getAttribute('onclick') || '').match(/cc=(\d+)/) || [])[1];
      if (!cc || seen[cc]) { return; }
      seen[cc] = 1;
      function cell(s) { var x = e.querySelector(s); return x ? x.textContent.trim() : ''; }
      var status = cell('.ucCHCol2');
      if (CLOSED.indexOf(status.toLowerCase()) >= 0) { return; }
      cases.push({ cc: cc, date: cell('.ucCHCol1'), status: status, type: cell('.ucCHCol3'), own: e.textContent.indexOf(m) >= 0 });
    });
    if (cases.length === 1) { return cases[0].cc; }
    if (!cases.length) { throw new Error('Ingen åben sag for måler ' + m + '.'); }
    return choose('LinkIQ: ' + cases.length + ' åbne sager for måler ' + m + '. Vælg sag:', cases.map(function (c) {
      return { label: c.date + ' · ' + c.status + ' · ' + c.type + (c.own ? ' · måler nævnt' : ''), value: c.cc };
    }).concat([{ label: 'Spring over', value: null }]));
  }

  // ---------- 3a. files: only those not on the case yet
  async function upload(cc, files) {
    if (!files.length) { return []; }
    var have = {};
    try {
      var g = await retry(function () { return fetch('/Handlers/GetFiles.ashx?caseId=' + cc, { credentials: 'same-origin' }); });
      (await g.json()).files.forEach(function (f) { have[f.name] = 1; });
    } catch (e) { /* list unknown: upload anyway */ }
    var todo = files.filter(function (f) { return !have[f.name]; });
    if (!todo.length) { return []; }
    var fd = new FormData();
    todo.forEach(function (f) { fd.append('files', f.blob, f.name); });
    fd.append('caseId', cc);
    var r = await retry(function () {
      return fetch('/Handlers/FileHandler.ashx', { method: 'POST', body: fd, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    });
    var j = r.ok ? await r.json().catch(function () { return null; }) : null;
    if (!j || !j.files) { throw new Error('Upload fejlede (HTTP ' + r.status + ')'); }
    return j.files.map(function (f) { return f.name; });
  }

  // ---------- 3b. Ny aktivitet + status, as VVS-dialog's own "Gem" in the status window
  function radioFor(doc, status) {
    var want = String(status || '').trim().toLowerCase(), hit = null;
    Array.prototype.forEach.call(doc.querySelectorAll('input[type=radio]'), function (r) {
      var lab = r.id ? doc.querySelector('label[for="' + r.id + '"]') : null;
      var t = lab ? lab.textContent : (r.nextSibling ? r.nextSibling.textContent : (r.parentNode ? r.parentNode.textContent : ''));
      if (!hit && String(t || '').trim().toLowerCase() === want) { hit = r; }
    });
    return hit;
  }
  async function writeLog(cc, text, status) {
    text = String(text || '').replace(/[\u2013\u2014]/g, '-');   // VVS-dialog turns long dashes into "|"
    var url = '/Cases/ShowCase.aspx?cc=' + cc;
    var p = await page(url);
    if (loggedOut(p)) { throw new Error('LOGIN'); }
    var form = p.doc.querySelector('form');
    var ta = p.doc.querySelector('textarea[name="' + NEW_LOG + 'LogTextTextArea"]');
    var save = p.doc.querySelector('input[name="' + NEW_LOG + 'SaveLogButton"]');
    if (!form || !ta || !save) { throw new Error('Fandt ikke feltet Ny aktivitet'); }
    // compare letters and digits only: VVS-dialog shows line breaks as <br> and changes some signs ("–" to "|")
    var norm = function (t) { return String(t || '').toLowerCase().replace(/[^0-9a-zæøåäöü()]+/g, ''); };
    var body = norm(p.doc.body.textContent), want = norm(text), at = body.indexOf(want);
    while (at >= 0) {                                         // li pressed twice; deleted ones do not count
      if (body.substr(at + want.length, 9) !== '(slettet)') { return 'exists'; }
      at = body.indexOf(want, at + 1);
    }
    var ch = {};
    ch[ta.name] = text;
    ch[save.name] = save.getAttribute('value') || 'Gem';
    if (status) {
      var radio = radioFor(p.doc, status);
      if (!radio) { throw new Error('Status „' + status + '“ findes ikke i VVS-dialog'); }
      Array.prototype.forEach.call(p.doc.querySelectorAll('input[type=radio][name="' + radio.name + '"]'), function (r) { r.removeAttribute('checked'); });
      ch[radio.name] = radio.getAttribute('value');
      // the page also sends the status drop-down of "Rediger sag" with the same value
      var dd = p.doc.querySelector('select[name$="NewStatusDropDownList"]');
      if (dd && dd.querySelector('option[value="' + radio.getAttribute('value') + '"]')) { ch[dd.name] = radio.getAttribute('value'); }
    }
    var action = new URL(form.getAttribute('action') || url, location.origin + url);
    var r = await page(action.href, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: formFields(form, ch).toString() });
    var after = norm(r.doc.body ? r.doc.body.textContent : ''), was = norm(text);
    if (was && after.indexOf(was) < 0) { throw new Error('Aktiviteten blev ikke fundet efter Gem – se sagen'); }
  }

  // ---------- 3c. no link to LinkIQ: the report folder, chosen once and remembered here
  function idb() {
    return new Promise(function (ok, fail) {
      var r = indexedDB.open('linkiq-li', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
      r.onsuccess = function () { ok(r.result); }; r.onerror = function () { fail(r.error); };
    });
  }
  async function kvGet(k) { var db = await idb(); return new Promise(function (ok) { var q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = function () { ok(q.result); }; q.onerror = function () { ok(null); }; }); }
  async function kvSet(k, v) {
    try { var db = await idb(); } catch (e) { return; }
    return new Promise(function (ok) {
      try { var t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = ok; t.onerror = ok; } catch (e) { ok(); }
    });
  }
  // Newest PDF and newest PNG/JPG whose name contains the meter number.
  async function fromFolder(dir, m) {
    var best = {};
    for await (var entry of dir.values()) {
      if (entry.kind !== 'file' || entry.name.indexOf(m) < 0) { continue; }
      var ext = (entry.name.match(/\.(pdf|png|jpe?g)$/i) || [])[1];
      if (!ext) { continue; }
      ext = ext.toLowerCase() === 'pdf' ? 'pdf' : 'img';
      var f = await entry.getFile();
      if (!best[ext] || f.lastModified > best[ext].lastModified) { best[ext] = f; }
    }
    return ['pdf', 'img'].filter(function (k) { return best[k]; }).map(function (k) { return { name: best[k].name, blob: best[k] }; });
  }
  async function folderFiles(m) {
    if (!window.showDirectoryPicker) { return null; }
    var dir = null;
    try { dir = await kvGet('dir'); } catch (e) { dir = null; }
    return new Promise(function (ok) {
      reset('LinkIQ: måler ' + m + ' – rapporten hentes fra mappen');
      async function use(d) {
        try {
          if ((await d.queryPermission({ mode: 'read' })) !== 'granted' && (await d.requestPermission({ mode: 'read' })) !== 'granted') { ok(null); return; }
          await kvSet('dir', d);
          var fs = await fromFolder(d, m);
          if (!fs.length) { reset('LinkIQ: ingen rapport med ' + m + ' i mappen „' + d.name + '“.'); await wait(2000); ok(null); return; }
          ok(fs);
        } catch (e) { ok(null); }
      }
      if (dir) { button('Brug mappen „' + dir.name + '“', function () { use(dir); }, true); }
      button(dir ? 'Vælg en anden mappe' : 'Vælg rapportmappen (én gang)', async function () {
        try { use(await window.showDirectoryPicker({ id: 'linkiq-rapporter', mode: 'read' })); } catch (e) { ok(null); }
      }, !dir);
      button('Vælg filerne selv', function () { ok(null); });
    });
  }

  // ---------- 3d. files chosen by hand
  function pickFiles(m) {
    return new Promise(function (ok) {
      reset('LinkIQ: måler ' + m + ' – vælg rapporten (PDF/PNG) fra mappen');
      var inp = document.createElement('input');
      inp.type = 'file'; inp.multiple = true; inp.accept = '.pdf,.png,.jpg,application/pdf,image/*';
      inp.style.cssText = 'display:block;margin:0 0 10px;color:#fff';
      box.appendChild(inp);
      var list = line(''), go = button('Send til sagen', function () {
        var fs = Array.prototype.slice.call(inp.files || []).filter(function (f, i) { return box.querySelector('[data-i="' + i + '"]').checked; });
        ok(fs.map(function (f) { return { name: f.name, blob: f }; }));
      }, true);
      go.disabled = true;
      button('Send uden filer', function () { ok([]); });
      inp.onchange = function () {
        list.textContent = '';
        Array.prototype.forEach.call(inp.files, function (f, i) {
          var l = document.createElement('label'), c = document.createElement('input');
          c.type = 'checkbox'; c.dataset.i = i; c.checked = f.name.indexOf(m) >= 0;
          l.style.display = 'block'; l.appendChild(c);
          l.appendChild(document.createTextNode(' ' + f.name + (f.name.indexOf(m) >= 0 ? '' : '  (ikke denne måler!)')));
          list.appendChild(l);
        });
        go.disabled = false;
      };
    });
  }

  // ---------- run
  try {
    reset('LinkIQ: henter opgaver …');
    var items = await fromOpener();
    var linked = !!items;
    if (!items || !items.length) { items = fromName(); linked = false; }
    if (!items) {
      var clip = '';
      try {
        if (navigator.clipboard && navigator.clipboard.readText) {
          clip = await Promise.race([navigator.clipboard.readText(), wait(4000).then(function () { return ''; })]);
        }
      } catch (e) { clip = ''; }
      clip = String(clip || '').trim();
      var m0 = (prompt('LinkIQ: Målernummer?', /^\d{6,12}$/.test(clip) ? clip : '') || '').replace(/\D/g, '');
      if (!m0) { box.remove(); return; }
      items = [{ meter: m0, files: [] }];
    }
    var results = [], lastCc = null;
    for (var k = 0; k < items.length; k++) {
      var it = items[k], tag = (items.length > 1 ? '(' + (k + 1) + '/' + items.length + ') ' : '');
      try {
        reset('LinkIQ: ' + tag + 'søger måler ' + it.meter + ' …');
        var cc = await findCase(String(it.meter));
        if (!cc) { results.push(it.meter + ': sprunget over'); continue; }
        var files = it.files || [];
        if (!linked && !files.length && it.text !== undefined) {
          files = (await folderFiles(String(it.meter))) || await pickFiles(it.meter);
        }
        reset('LinkIQ: ' + tag + 'sag ' + cc + ' – uploader …');
        var up = await upload(cc, files);
        var w = null;
        if (it.text) {
          reset('LinkIQ: ' + tag + 'sag ' + cc + ' – skriver Ny aktivitet og status …');
          w = await writeLog(cc, it.text, it.status);
        }
        lastCc = cc;
        var what = (up.length ? up.length + ' fil(er)' : 'ingen nye filer') +
          (it.text ? (w === 'exists' ? ', aktiviteten fandtes allerede' : ', aktivitet' + (it.status ? ' + ' + it.status : '')) : '');
        results.push('✓ ' + it.meter + ' → sag ' + cc + ': ' + what);
        tell({ liq: 'result', id: it.id, ok: true, cc: cc, msg: what });
        if (!it.text && !files.length && items.length === 1) { location.href = '/Cases/ShowCase.aspx?cc=' + cc; return; }
      } catch (e) {
        var msg = e && e.message === 'LOGIN' ? 'Log ind i VVS-dialog (Chrome udfylder selv), og tryk på li igen.' : (e && e.message ? e.message : String(e));
        results.push('✗ ' + it.meter + ': ' + msg);
        tell({ liq: 'result', id: it.id, ok: false, msg: msg });
        if (e && e.message === 'LOGIN') { break; }
      }
    }
    reset('LinkIQ: færdig');
    results.forEach(function (r) { line(r); });
    if (items.length === 1 && lastCc && results[0].charAt(0) === '✓') {   // one case, all well: show it
      setTimeout(function () { location.href = '/Cases/ShowCase.aspx?cc=' + lastCc; }, 2500);
    }
    if (lastCc) { button('Vis sagen', function () { location.href = '/Cases/ShowCase.aspx?cc=' + lastCc; }, true); }
    closeBtn();
  } catch (err) {
    reset('LinkIQ: Fejl – ' + (err && err.message ? err.message : err));
    closeBtn();
  }
})();
