(async function () {
  var CLOSED = ['afsluttet', 'lukket'];
  var HOST = 'vvsdialog.kmd.dk';
  if (location.hostname !== HOST) {
    alert('LinkIQ: Åbn VVS-dialog og log ind først.');
    return;
  }
  var m = (location.hash.match(/linkiq=(\d+)/) || [])[1] ||
    (String(window.name || '').match(/^linkiq_(\d+)$/) || [])[1];
  if (!m) {
    var clip = '';
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        clip = await Promise.race([
          navigator.clipboard.readText(),
          new Promise(function (ok) { setTimeout(function () { ok(''); }, 4000); })
        ]);
      }
    } catch (e) { clip = ''; }
    clip = String(clip || '').trim();
    m = prompt('LinkIQ: Målernummer?', /^\d{6,12}$/.test(clip) ? clip : '');
  }
  m = (m || '').replace(/\D/g, '');
  if (!m) { return; }

  var old = document.getElementById('linkiq-box');
  if (old) { old.remove(); }
  var box = document.createElement('div');
  box.id = 'linkiq-box';
  box.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:99999;background:#1f5e4f;color:#fff;' +
    'font:17px/1.4 Arial,sans-serif;padding:14px;max-height:100%;overflow:auto;box-shadow:0 2px 10px rgba(0,0,0,.5)';
  document.body.appendChild(box);
  function line(t, bold) {
    var p = document.createElement('div');
    p.textContent = t;
    p.style.margin = '0 0 8px';
    if (bold) { p.style.fontWeight = 'bold'; }
    box.appendChild(p);
    return p;
  }
  function button(t, fn) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = t;
    b.style.cssText = 'display:block;width:100%;margin:0 0 8px;padding:12px;font:16px Arial,sans-serif;' +
      'text-align:left;background:#fff;color:#111;border:0;border-radius:6px';
    b.onclick = fn;
    box.appendChild(b);
    return b;
  }
  function reset(t) { box.textContent = ''; line(t, true); }
  function closeBtn() { button('Luk', function () { box.remove(); }); }

  try {
    reset('LinkIQ: søger måler ' + m + ' …');
    var parser = new DOMParser();
    var res = await fetch('/Home.aspx', { credentials: 'same-origin' });
    var doc = parser.parseFromString(await res.text(), 'text/html');
    var form = doc.querySelector('form');
    var inputs = form ? Array.prototype.slice.call(form.querySelectorAll('input')) : [];
    var meterInput = inputs.find(function (i) { return /meternumber/i.test(i.name || ''); });
    var searchBtn = inputs.find(function (i) {
      return (i.type || '').toLowerCase() === 'submit' && (i.value || '').trim() === 'Søg';
    });
    if (!meterInput || !searchBtn) {
      reset('LinkIQ: Log ind i VVS-dialog først, og tryk derefter på li igen.');
      closeBtn();
      return;
    }

    var q = new URLSearchParams();
    Array.prototype.forEach.call(form.querySelectorAll('input,select,textarea'), function (e) {
      if (!e.name || e.disabled) { return; }
      var t = (e.type || '').toLowerCase();
      if (t === 'submit' || t === 'button' || t === 'image' || t === 'file' || t === 'reset') { return; }
      if ((t === 'checkbox' || t === 'radio') && !e.checked) { return; }
      q.append(e.name, e === meterInput ? m : (e.value || ''));
    });
    q.append(searchBtn.name, searchBtn.value);

    var action = new URL(form.getAttribute('action') || 'Home.aspx', location.origin + '/Home.aspx');
    res = await fetch(action.href, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: q.toString()
    });
    var customerUrl = res.url;
    var html = await res.text();
    if (!/ShowCustomer\.aspx/i.test(customerUrl)) {
      reset('LinkIQ: Måler ' + m + ' blev ikke fundet entydigt. Søg manuelt på forsiden.');
      closeBtn();
      return;
    }

    doc = parser.parseFromString(html, 'text/html');
    var seen = {};
    var cases = [];
    Array.prototype.forEach.call(doc.querySelectorAll('[onclick*="ShowCase.aspx"]'), function (e) {
      var cc = ((e.getAttribute('onclick') || '').match(/cc=(\d+)/) || [])[1];
      if (!cc || seen[cc]) { return; }
      seen[cc] = 1;
      function cell(s) { var x = e.querySelector(s); return x ? x.textContent.trim() : ''; }
      var status = cell('.ucCHCol2');
      if (CLOSED.indexOf(status.toLowerCase()) >= 0) { return; }
      cases.push({
        cc: cc, date: cell('.ucCHCol1'), status: status, type: cell('.ucCHCol3'),
        own: e.textContent.indexOf(m) >= 0
      });
    });

    function open(cc) {
      reset('LinkIQ: åbner sagen …');
      location.href = '/Cases/ShowCase.aspx?cc=' + cc;
    }
    if (cases.length === 1) { open(cases[0].cc); return; }
    if (!cases.length) {
      reset('LinkIQ: Ingen åben sag for måler ' + m + '.');
      button('Åbn kundesiden', function () { location.href = customerUrl; });
      closeBtn();
      return;
    }
    reset('LinkIQ: ' + cases.length + ' åbne sager for måler ' + m + '. Vælg sag:');
    cases.forEach(function (c) {
      button(c.date + ' · ' + c.status + ' · ' + c.type + (c.own ? ' · måler nævnt' : ''),
        function () { open(c.cc); });
    });
    closeBtn();
  } catch (err) {
    reset('LinkIQ: Fejl – ' + (err && err.message ? err.message : err));
    closeBtn();
  }
})();
