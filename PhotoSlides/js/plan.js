/* Photo Slides — таза есеп (Premiere-ге тәуелсіз, тестіленеді).
 */
(function (root) {
  'use strict';

  var SPEED = 0.025;       // кадр өлшемінің үлесі / с
  var ZOOM_RATE = 2.5;     // % / с
  var ZOOM_MAX = 14;       // %
  var CYCLE = ['h', 'v', 'd', 'z'];

  function layout(iw, ih, W, H) {
    var landscape = W >= H;
    var b = Math.max(4, Math.round(0.016 * Math.min(W, H)));
    var maxW = (landscape ? 0.80 : 0.88) * W - 2 * b;
    var maxH = (landscape ? 0.88 : 0.80) * H - 2 * b;
    var k = Math.min(maxW / iw, maxH / ih);
    var pw = Math.round(iw * k), ph = Math.round(ih * k);
    return { border: b, pw: pw, ph: ph, fw: pw + 2 * b, fh: ph + 2 * b };
  }

  function travel(speedPx, dur, margin, minPx) {
    return Math.min(speedPx * dur, Math.max(margin * 0.9, minPx));
  }

  /* Бір фотоның қозғалысы: позиция (0..1) мен масштаб (%) — басы/соңы. */
  function motion(kind, flip, dur, lay, W, H) {
    var s = flip ? -1 : 1;
    var tx = travel(SPEED * W, dur, W - lay.fw, 0.05 * W) / W;
    var ty = travel(SPEED * H, dur, H - lay.fh, 0.04 * H) / H;
    var m = { pos: [[0.5, 0.5], [0.5, 0.5]], sc: [100, 100] };
    if (kind === 'h') {
      m.pos = [[0.5 + s * tx / 2, 0.5], [0.5 - s * tx / 2, 0.5]];
    } else if (kind === 'v') {
      m.pos = [[0.5, 0.5 + s * ty / 2], [0.5, 0.5 - s * ty / 2]];
    } else if (kind === 'd') {
      tx *= 0.8; ty *= 0.8;
      m.pos = [[0.5 - s * tx / 2, 0.5 + ty / 2], [0.5 + s * tx / 2, 0.5 - ty / 2]];
    } else {
      var z = Math.min(ZOOM_RATE * dur, ZOOM_MAX);
      m.sc = flip ? [100, 100 - z] : [100 - z, 100];
    }
    return m;
  }

  function kindFor(mode, i) {
    if (mode === 'mix') return { kind: CYCLE[i % 4], flip: Math.floor(i / 4) % 2 === 1 };
    return { kind: mode, flip: i % 2 === 1 };
  }

  function dipFrames(previous, next, fps) {
    if (Math.abs(previous.end - next.start) >= 0.5 / fps) return 0;
    var shorter = Math.min(previous.end - previous.start, next.end - next.start);
    return 2 * Math.min(Math.round(0.4 * fps), Math.floor(shorter * fps / 4 + 0.00001));
  }

  /* photos: [{start,end,iw,ih}], seq: {W,H,fps} */
  function build(photos, seq, mode) {
    var items = [], dips = [], i;
    for (i = 0; i < photos.length; i++) {
      var p = photos[i], dur = p.end - p.start;
      var lay = layout(p.iw, p.ih, seq.W, seq.H);
      var kf = kindFor(mode, i);
      var m = motion(kf.kind, kf.flip, dur, lay, seq.W, seq.H);
      items.push({ start: p.start, end: p.end, kind: kf.kind, layout: lay,
                   pos: m.pos, sc: m.sc, bgSc: [100, Math.min(108, 100 + 1.2 * dur)] });
      if (i > 0) {
        var frames = dipFrames(photos[i - 1], p, seq.fps);
        if (frames >= 2) dips.push({ cut: p.start, frames: frames });
      }
    }
    return { items: items, dips: dips };
  }

  var api = { layout: layout, motion: motion, build: build, kindFor: kindFor };
  // CEP панелінде Node қосулы болғандықтан `module` бар — сондықтан терезеге әрқашан жазамыз.
  if (typeof window !== 'undefined') window.PSPlan = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(this);
