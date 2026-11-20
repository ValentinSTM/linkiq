/* LinkIQ - reading the 7-segment LCD of a Kamstrup MULTICAL 603 from the camera.
 * Plain JavaScript, no network, no library: fits low-end phones and works offline.
 * Input: ImageData-like {width, height, data (RGBA)} with the display inside the frame.
 * Output: {text, digits, kind, quality, row}. The installer can always correct the text. */
(function (root) {
  'use strict';

  // Segment order: a b c d e f g
  var PATTERNS = {
    '1111110': '0', '0110000': '1', '1101101': '2', '1111001': '3', '0110011': '4',
    '1011011': '5', '1011111': '6', '1110000': '7', '1111111': '8', '1111011': '9',
    '0011111': '6', '1110011': '9', '1110010': '7', '0000001': '-'
  };

  // Zones relative to the digit box: [x0, x1, y0, y1]
  var ZONES = [
    [0.28, 0.72, 0.00, 0.17], // a
    [0.62, 1.00, 0.14, 0.44], // b
    [0.58, 1.00, 0.56, 0.86], // c
    [0.24, 0.70, 0.83, 1.00], // d
    [0.00, 0.40, 0.56, 0.86], // e
    [0.00, 0.40, 0.14, 0.44], // f
    [0.26, 0.74, 0.40, 0.60]  // g
  ];

  function toGray(img, targetW) {
    var sw = img.width, sh = img.height, d = img.data;
    var f = Math.max(1, sw / targetW);
    var w = Math.max(1, Math.round(sw / f)), h = Math.max(1, Math.round(sh / f));
    var g = new Float32Array(w * h);
    for (var y = 0; y < h; y++) {
      var sy0 = Math.floor(y * f), sy1 = Math.max(sy0 + 1, Math.floor((y + 1) * f));
      for (var x = 0; x < w; x++) {
        var sx0 = Math.floor(x * f), sx1 = Math.max(sx0 + 1, Math.floor((x + 1) * f));
        var s = 0, n = 0;
        for (var yy = sy0; yy < sy1 && yy < sh; yy++) {
          var o = (yy * sw + sx0) * 4;
          for (var xx = sx0; xx < sx1 && xx < sw; xx++, o += 4) {
            s += 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2]; n++;
          }
        }
        g[y * w + x] = n ? s / n : 0;
      }
    }
    return { w: w, h: h, g: g };
  }

  // Local threshold (Bradley): copes with shadow, uneven light and glare.
  function threshold(G, winFrac, t, minDiff) {
    var w = G.w, h = G.h, g = G.g;
    var I = new Float64Array((w + 1) * (h + 1));
    for (var y = 0; y < h; y++) {
      var row = 0;
      for (var x = 0; x < w; x++) {
        row += g[y * w + x];
        I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row;
      }
    }
    var r = Math.max(4, Math.round(w * winFrac / 2));
    var m = new Uint8Array(w * h);
    for (y = 0; y < h; y++) {
      var y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (x = 0; x < w; x++) {
        var x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
        var sum = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
        var mean = sum / ((x1 - x0) * (y1 - y0));
        var v = g[y * w + x];
        if (v < mean * (1 - t) && mean - v > minDiff) m[y * w + x] = 1;
      }
    }
    return m;
  }

  function components(m, w, h) {
    var lab = new Int32Array(w * h), comps = [], stack = [];
    for (var i = 0; i < w * h; i++) {
      if (!m[i] || lab[i]) continue;
      var id = comps.length + 1, c = { id: id, x0: 1e9, y0: 1e9, x1: -1, y1: -1, n: 0 };
      lab[i] = id; stack.push(i);
      while (stack.length) {
        var p = stack.pop(), px = p % w, py = (p - px) / w;
        c.n++;
        if (px < c.x0) c.x0 = px; if (px > c.x1) c.x1 = px;
        if (py < c.y0) c.y0 = py; if (py > c.y1) c.y1 = py;
        if (px > 0 && m[p - 1] && !lab[p - 1]) { lab[p - 1] = id; stack.push(p - 1); }
        if (px < w - 1 && m[p + 1] && !lab[p + 1]) { lab[p + 1] = id; stack.push(p + 1); }
        if (py > 0 && m[p - w] && !lab[p - w]) { lab[p - w] = id; stack.push(p - w); }
        if (py < h - 1 && m[p + w] && !lab[p + w]) { lab[p + w] = id; stack.push(p + w); }
      }
      c.x1++; c.y1++; c.w = c.x1 - c.x0; c.h = c.y1 - c.y0;
      comps.push(c);
    }
    return { lab: lab, comps: comps };
  }

  function median(a) {
    if (!a.length) return 0;
    var s = a.slice().sort(function (x, y) { return x - y; });
    return s[s.length >> 1];
  }

  function xOverlap(a, b) { return Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0); }

  // Join segments lying above each other into one digit.
  function groupComps(list, maxGap, maxW, maxH) {
    maxW = maxW || 1e9; maxH = maxH || 1e9;
    var groups = list.map(function (c) {
      return { x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1, ids: [c.id], n: c.n };
    });
    var merged = true;
    while (merged) {
      merged = false;
      for (var i = 0; i < groups.length && !merged; i++) {
        for (var j = i + 1; j < groups.length; j++) {
          var a = groups[i], b = groups[j];
          var ov = xOverlap(a, b), minW = Math.min(a.x1 - a.x0, b.x1 - b.x0);
          var gap = Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1);
          var nw = Math.max(a.x1, b.x1) - Math.min(a.x0, b.x0), nh = Math.max(a.y1, b.y1) - Math.min(a.y0, b.y0);
          if (ov >= 0.3 * minW && gap <= maxGap && nw <= maxW && nh <= maxH) {
            a.x0 = Math.min(a.x0, b.x0); a.x1 = Math.max(a.x1, b.x1);
            a.y0 = Math.min(a.y0, b.y0); a.y1 = Math.max(a.y1, b.y1);
            a.ids = a.ids.concat(b.ids); a.n += b.n;
            groups.splice(j, 1); merged = true; break;
          }
        }
      }
    }
    groups.forEach(function (g) { g.w = g.x1 - g.x0; g.h = g.y1 - g.y0; });
    return groups;
  }

  function zoneFill(lab, w, ids, box, z) {
    var bw = box.x1 - box.x0, bh = box.y1 - box.y0;
    var x0 = Math.round(box.x0 + z[0] * bw), x1 = Math.round(box.x0 + z[1] * bw);
    var y0 = Math.round(box.y0 + z[2] * bh), y1 = Math.round(box.y0 + z[3] * bh);
    var horiz = (z[1] - z[0]) * bw > (z[3] - z[2]) * bh;
    // Share of cross-lines (across the segment) that hit dark pixels.
    var hit = 0, tot = 0, x, y, k;
    if (horiz) {
      for (x = x0; x < x1; x++) {
        tot++;
        for (y = y0; y < y1; y++) { k = lab[y * w + x]; if (k && ids[k]) { hit++; break; } }
      }
    } else {
      for (y = y0; y < y1; y++) {
        tot++;
        for (x = x0; x < x1; x++) { k = lab[y * w + x]; if (k && ids[k]) { hit++; break; } }
      }
    }
    return tot ? hit / tot : 0;
  }

  var DIGITS = ['1111110', '0110000', '1101101', '1111001', '0110011', '1011011', '1011111', '1110000', '1111111', '1111011'];

  function decode(segs) {
    var key = segs.map(function (s) { return s ? '1' : '0'; }).join('');
    return PATTERNS[key] || '?';
  }

  // Glare can wipe out one segment: take the only digit that is one segment away.
  function decodeSoft(fills, thr) {
    var on = fills.map(function (f) { return f > thr; });
    var ch = decode(on);
    if (ch !== '?') return { ch: ch, exact: true };
    var cand = [];
    DIGITS.forEach(function (p, d) {
      var diff = 0;
      for (var i = 0; i < 7; i++) if ((p[i] === '1') !== on[i]) diff++;
      if (diff === 1) cand.push(String(d));
    });
    return cand.length === 1 ? { ch: cand[0], exact: false } : { ch: '?', exact: false };
  }

  function rotateGray(G, ang) {
    var w = G.w, h = G.h, src = G.g, out = new Float32Array(w * h);
    var c = Math.cos(ang), s = Math.sin(ang), cx = w / 2, cy = h / 2, fill = G.bg || 128;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var dx = x - cx, dy = y - cy;
        var sx = c * dx - s * dy + cx, sy = s * dx + c * dy + cy;
        var x0 = Math.floor(sx), y0 = Math.floor(sy);
        if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) { out[y * w + x] = fill; continue; }
        var fx = sx - x0, fy = sy - y0, i = y0 * w + x0;
        out[y * w + x] = (src[i] * (1 - fx) + src[i + 1] * fx) * (1 - fy) + (src[i + w] * (1 - fx) + src[i + w + 1] * fx) * fy;
      }
    }
    return { w: w, h: h, g: out, bg: G.bg };
  }

  function bgLevel(G) {
    var w = G.w, h = G.h, a = [];
    for (var y = Math.round(h * 0.2); y < h * 0.8; y += 2)
      for (var x = Math.round(w * 0.2); x < w * 0.8; x += 2) a.push(G.g[y * w + x]);
    a.sort(function (p, q) { return p - q; });
    return a[Math.round(a.length * 0.6)] || 128;
  }

  function analyze(G, opts) {
    var w = G.w, h = G.h;
    // the minimum contrast follows the light level, so a dim room works like a bright one
    var m = threshold(G, opts.win, opts.t, opts.minDiff * Math.max(0.5, Math.min(1, (G.bg || 150) / 150)));
    var cc = components(m, w, h), lab = cc.lab;
    var D = opts.debug ? { w: w, h: h, m: m, dots: [], y0: 0, y1: 0 } : null;
    var minArea = Math.max(4, w * h * 0.00006);
    var comps = cc.comps.filter(function (c) {
      return c.n >= minArea && c.x0 > 0 && c.y0 > 0 && c.x1 < w && c.y1 < h &&
        c.w < 0.45 * w && c.h < 0.8 * h;
    });

    // Pass 1: find the row of large digits
    var g1 = groupComps(comps, 0.04 * h, 0.13 * w, 0.62 * h).filter(function (g) {
      return g.h > 0.18 * h && g.h < 0.8 * h && g.h / Math.max(1, g.w) > 0.9;
    });
    var best = null;
    g1.forEach(function (a) {
      var mem = g1.filter(function (b) {
        var cyA = (a.y0 + a.y1) / 2, cyB = (b.y0 + b.y1) / 2;
        return Math.abs(b.h - a.h) < 0.2 * a.h && Math.abs(cyB - cyA) < 0.12 * a.h + 0.08 * Math.abs((b.x0 - a.x0));
      });
      var score = mem.reduce(function (s, b) { return s + b.h; }, 0);
      if (!best || score > best.score) best = { score: score, mem: mem };
    });

    var dashed = function () {
      // No digits: are there dashes ("- - -": no value, e.g. no sensor)?
      var dashes = comps.filter(function (c) {
        return c.w > 2.2 * c.h && c.w > 0.04 * w && c.h < 0.08 * h && c.y0 > 0.2 * h && c.y1 < 0.8 * h;
      });
      var rowD = [];
      dashes.forEach(function (a) {
        var r = dashes.filter(function (b) {
          return Math.abs((b.y0 + b.y1) - (a.y0 + a.y1)) < 2 * a.h + 2 &&
            b.w > 0.65 * a.w && b.w < 1.5 * a.w && b.h < 2 * a.h + 2 && b.h > 0.5 * a.h - 1;
        });
        if (r.length > rowD.length) rowD = r;
      });
      return rowD.length >= 2 ? { text: '---', digits: [], kind: 'dashes', quality: 1, angle: 0, dbg: D } : null;
    };
    if (!best) return dashed() || { text: '', digits: [], kind: 'none', quality: 0, angle: 0, dbg: D };

    // Tilt (phone held at an angle): line through the digit centres
    var angle = 0, mem = best.mem;
    if (mem.length >= 2) {
      var n = mem.length, sx = 0, sy = 0, sxx = 0, sxy = 0;
      mem.forEach(function (g) {
        var x = (g.x0 + g.x1) / 2, y = (g.y0 + g.y1) / 2;
        sx += x; sy += y; sxx += x * x; sxy += x * y;
      });
      var den = n * sxx - sx * sx;
      if (den > 0) angle = Math.atan((n * sxy - sx * sy) / den);
    }

    var y0 = median(mem.map(function (g) { return g.y0; }));
    var y1 = median(mem.map(function (g) { return g.y1; }));
    var H = y1 - y0, tol = 0.07 * H;

    // Pass 2: only components inside the row; dots are kept apart
    var inBand = comps.filter(function (c) {
      return c.y0 >= y0 - tol && c.y1 <= y1 + tol && c.h <= 1.06 * H;
    });
    var dots = [], segs = [];
    inBand.forEach(function (c) {
      var small = Math.max(c.w, c.h) < 0.16 * H && Math.max(c.w, c.h) < 2.2 * Math.min(c.w, c.h);
      var cy = (c.y0 + c.y1) / 2;
      if (small && cy > y0 + 0.78 * H) dots.push(c); else segs.push(c);
    });
    var compById = {}; segs.forEach(function (c) { compById[c.id] = c; });
    var groups = groupComps(segs, 0.12 * H, 0.75 * H, 1.1 * H).filter(function (g) { return g.h >= 0.3 * H; });
    groups.sort(function (a, b) { return a.x0 - b.x0; });

    var wide = groups.filter(function (g) { return g.w >= 0.35 * H; }).map(function (g) { return g.w; });
    var Wref = wide.length ? median(wide) : 0.55 * H;

    // A narrow "1" is two vertical segments (upper and lower); one long line is
    // the display edge or the box drawn around the last digit.
    groups = groups.filter(function (g, i) {
      if (g.w >= 0.6 * Wref) return true;
      var parts = g.ids.map(function (id) { return compById[id]; });
      var up = parts.some(function (c) { return c.y1 < y0 + 0.62 * H && c.h > 0.25 * H; });
      var lo = parts.some(function (c) { return c.y0 > y0 + 0.38 * H && c.h > 0.25 * H; });
      var full = parts.some(function (c) { return c.h > 0.8 * H; });
      if (!full && (!up || !lo)) return false;
      var prev = groups[i - 1];
      if (prev && prev.w >= 0.6 * Wref && g.x1 - Wref < prev.x1 - 0.3 * Wref) return false;
      return true;
    });

    var digits = groups.map(function (g) {
      var box = { x0: g.x0, x1: g.x1, y0: y0, y1: y1 };
      if (g.w < 0.6 * Wref) { // narrow = "1" (right side of the cell); a "7" would have a wide top
        box.x0 = g.x1 - Wref;
        return { ch: '1', exact: true, box: box, fills: [0, 1, 1, 0, 0, 0, 0], margin: 0.5 };
      }
      var ids = {}; g.ids.forEach(function (id) { ids[id] = true; });
      var fills = ZONES.map(function (z) { return zoneFill(lab, w, ids, box, z); });
      var dec = decodeSoft(fills, 0.45);
      var margin = dec.exact ? Math.min.apply(null, fills.map(function (f) { return Math.abs(f - 0.45); })) : 0;
      return { ch: dec.ch, exact: dec.exact, box: box, fills: fills, margin: margin };
    });

    // Decimal point: small dot at the bottom, between two digits
    var dpAfter = -1;
    dots.forEach(function (d) {
      var cx = (d.x0 + d.x1) / 2;
      var inside = digits.some(function (g) { return cx > g.box.x0 + 0.15 * Wref && cx < g.box.x1 - 0.1 * Wref; });
      if (inside) return;
      if (Math.min(d.w, d.h) < 0.05 * H) return;
      for (var i = 0; i < digits.length - 1; i++) {
        var px1 = groups[i].x1; // right edge of the previous digit's segments
        if (d.x0 >= px1 - 1 && cx <= px1 + 0.4 * Wref && cx < digits[i + 1].box.x0 + 0.1 * Wref) dpAfter = i;
      }
    });

    var text = '';
    digits.forEach(function (d, i) { text += d.ch; if (i === dpAfter) text += '.'; });
    var bad = digits.filter(function (d) { return d.ch === '?'; }).length;
    var soft = digits.filter(function (d) { return !d.exact; }).length;
    var quality = digits.length ? (1 - (bad + 0.5 * soft) / digits.length) : 0;
    if (D) { D.dots = dots; D.y0 = y0; D.y1 = y1; }
    var alt = quality < 0.6 ? dashed() : null;   // shadow noise taken for digits next to real dashes?
    return {
      text: text, digits: digits, kind: 'digits', quality: quality, dp: dpAfter, angle: angle, alt: alt, dbg: D,
      row: { x0: digits.length ? digits[0].box.x0 / w : 0, x1: digits.length ? digits[digits.length - 1].box.x1 / w : 0, y0: y0 / h, y1: y1 / h }
    };
  }

  function readLcd(img, opts) {
    opts = Object.assign({ width: 360, win: 0.06, t: 0.08, minDiff: 8 }, opts || {});
    var G = toGray(img, opts.width);
    G.bg = bgLevel(G);
    var r = analyze(G, opts);
    // Tilted reading: straighten and try again
    if (r.kind === 'digits' && Math.abs(r.angle) > 0.012 && Math.abs(r.angle) < 0.35) {
      var r2 = analyze(rotateGray(G, r.angle), opts);
      if (r2.kind === 'digits' && r2.quality >= r.quality) r = r2;
    }
    if (r.kind === 'digits' && r.alt) return r.alt;
    return r;
  }

  // Voting over camera frames: the same text several times is a safe reading.
  function Voter(need, size) {
    this.need = need || 3; this.size = size || 8; this.hist = [];
  }
  Voter.prototype.add = function (r) {
    if (!r || !r.text || r.text.indexOf('?') >= 0) { this.hist.push(null); }
    else this.hist.push(r.text);
    if (this.hist.length > this.size) this.hist.shift();
    var counts = {}, bestT = null, bestN = 0;
    this.hist.forEach(function (t) {
      if (!t) return;
      counts[t] = (counts[t] || 0) + 1;
      if (counts[t] > bestN) { bestN = counts[t]; bestT = t; }
    });
    return { text: bestT, count: bestN, stable: bestN >= this.need };
  };
  Voter.prototype.reset = function () { this.hist = []; };

  var api = { readLcd: readLcd, Voter: Voter, decode: decode, PATTERNS: PATTERNS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LinkIQLcd = api;
})(this);
