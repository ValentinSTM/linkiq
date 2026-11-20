// Run with:  node --test tests-js/lcd.test.js
// Display pictures of a MULTICAL 603 (only the LCD, grey, 360 px wide), taken with a phone
// in ordinary office light: shadow over half the display, glare on the right-hand digits.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { readLcd, Voter } = require('../frontend/lcd.js');

const DIR = path.join(__dirname, 'lcd');
const cases = JSON.parse(fs.readFileSync(path.join(DIR, 'cases.json'), 'utf8'));

function load(c, transform) {
  const g = zlib.inflateSync(fs.readFileSync(path.join(DIR, c.file)));
  const data = new Uint8ClampedArray(c.w * c.h * 4);
  for (let i = 0; i < g.length; i++) {
    const v = transform ? transform(g[i], i % c.w, Math.floor(i / c.w), c) : g[i];
    data[4 * i] = data[4 * i + 1] = data[4 * i + 2] = v; data[4 * i + 3] = 255;
  }
  return { width: c.w, height: c.h, data };
}

for (const c of cases) {
  test(`reads ${c.screen}: ${c.expect}`, () => {
    assert.equal(readLcd(load(c)).text, c.expect);
  });
}

test('dim room: a third of the light, same readings', () => {
  for (const c of cases) assert.equal(readLcd(load(c, (v) => Math.round(v * 0.33))).text, c.expect, c.screen);
});

test('strong glare spot on the right half never gives a wrong number', () => {
  for (const c of cases) {
    const r = readLcd(load(c, (v, x, y, k) => {
      const d2 = ((x - 0.78 * k.w) ** 2 + (y - 0.45 * k.h) ** 2) / (0.2 * k.w) ** 2;
      return v + (255 - v) * 0.6 * Math.exp(-d2);
    }));
    assert.ok(r.text === c.expect || r.text.includes('?') || r.text.length < c.expect.length, `${c.screen}: ${r.text}`);
  }
});

test('voting needs the same text several times', () => {
  const v = new Voter(3, 8);
  assert.equal(v.add({ text: '0000123.4' }).stable, false);
  assert.equal(v.add({ text: '0000128.4' }).stable, false);
  assert.equal(v.add({ text: '00001?3.4' }).stable, false);
  assert.equal(v.add({ text: '0000123.4' }).stable, false);
  const r = v.add({ text: '0000123.4' });
  assert.equal(r.stable, true);
  assert.equal(r.text, '0000123.4');
});
