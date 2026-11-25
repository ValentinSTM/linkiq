// Short "li" bookmark (Android Chrome cuts or refuses very long bookmarks). It only fetches the real
// li code and runs it: from LinkIQ when VVS-dialog was opened from there (window.opener), else the
// copy kept in this browser's VVS-dialog storage, else from the clipboard ("LIQCODE:…", copied in
// LinkIQ). The real code therefore updates itself with every LinkIQ version.
(function () {
  var K = 'linkiq-li-code', o = window.opener, done = 0;
  function run(c) { done = 1; try { localStorage.setItem(K, c); } catch (e) { /* */ } try { (0, eval)(c); } catch (e) { alert('LinkIQ: ' + e.message); } }
  function local() {
    if (done) { return; }
    var c = null;
    try { c = localStorage.getItem(K); } catch (e) { /* */ }
    if (c) { run(c); return; }
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then(function (t) {
        t = String(t || '');
        if (t.indexOf('LIQCODE:') === 0) { run(t.slice(8)); } else { alert('LinkIQ: Kopiér li-koden i LinkIQ (Opret bogmærket li) og tryk på li igen.'); }
      }, function () { alert('LinkIQ: Kopiér li-koden i LinkIQ (Opret bogmærket li) og tryk på li igen.'); });
    }
  }
  if (o) {
    addEventListener('message', function f(ev) {
      if (ev.source !== o || !ev.data || ev.data.liq !== 'code' || !ev.data.code) { return; }
      removeEventListener('message', f);
      if (!done) { run(ev.data.code); }
    });
    try { o.postMessage({ liq: 'code' }, '*'); } catch (e) { /* LinkIQ closed */ }
    setTimeout(local, 1500);
  } else { local(); }
})();
