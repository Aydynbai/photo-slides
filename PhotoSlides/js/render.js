/* Photo Slides — сурет дайындау (панельдегі canvas, сыртқы бағдарламасыз). */
(function (root) {
  'use strict';

  var MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg', png: 'image/png',
               webp: 'image/webp', bmp: 'image/bmp', gif: 'image/gif' };

  function ext(p) { var m = /\.([a-z0-9]+)$/i.exec(p); return m ? m[1].toLowerCase() : ''; }
  function supported(p) { return !!MIME[ext(p)]; }

  /* JPEG ішіндегі EXIF бағыты (1..8). Ескі Premiere (2020–2021) панелі телефон
     фотоларын өзі бұрмайды, сондықтан қажет болса өзіміз бұрамыз. */
  function exifOrientation(b) {
    if (b.length < 4 || b[0] !== 0xFF || b[1] !== 0xD8) return 1;
    var i = 2;
    while (i + 4 < b.length && b[i] === 0xFF) {
      var marker = b[i + 1], len = (b[i + 2] << 8) | b[i + 3];
      if (marker === 0xE1 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66) {
        var t = i + 10, le = b[t] === 0x49;
        var u16 = function (o) { return le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]; };
        var u32 = function (o) { return le ? u16(o) | (u16(o + 2) << 16) : (u16(o) << 16) | u16(o + 2); };
        var ifd = t + u32(t + 4), n = u16(ifd), k;
        for (k = 0; k < n; k++) {
          var e = ifd + 2 + k * 12;
          if (e + 12 > b.length) break;
          if (u16(e) === 0x0112) { var v = u16(e + 8); return v >= 1 && v <= 8 ? v : 1; }
        }
        return 1;
      }
      if (marker === 0xDA) break;
      i += 2 + len;
    }
    return 1;
  }

  function autoRotates() {   // Chromium 81+ EXIF бағытын өзі қолданады
    var m = /Chrom(?:e|ium)\/(\d+)/.exec(navigator.userAgent);
    return !m || Number(m[1]) >= 81;
  }

  function upright(img, o) {
    var w = img.naturalWidth, h = img.naturalHeight, swap = o >= 5;
    var c = canvas(swap ? h : w, swap ? w : h), g = c.getContext('2d');
    var T = { 2: [-1, 0, 0, 1, w, 0], 3: [-1, 0, 0, -1, w, h], 4: [1, 0, 0, -1, 0, h],
              5: [0, 1, 1, 0, 0, 0], 6: [0, 1, -1, 0, h, 0], 7: [0, -1, -1, 0, h, w], 8: [0, -1, 1, 0, 0, w] }[o];
    g.transform.apply(g, T);
    g.drawImage(img, 0, 0);
    c.naturalWidth = c.width; c.naturalHeight = c.height;
    return c;
  }

  function loadImage(io, path) {
    return Promise.resolve().then(function () { return io.read(path); }).then(function (bytes) {
      return new Promise(function (resolve, reject) {
        var url, o = 1;
        try {
          if (!autoRotates() || root.__PS_FORCE_EXIF) o = exifOrientation(bytes);
          url = URL.createObjectURL(new Blob([bytes], { type: MIME[ext(path)] }));
        } catch (e) { reject(e); return; }
        var img = new Image();
        img.onload = function () {
          try { resolve({ img: o > 1 ? upright(img, o) : img, url: url }); }
          catch (err) { URL.revokeObjectURL(url); reject(err); }
        };
        img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode')); };
        img.src = url;
      });
    });
  }

  function canvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function toBytes(c, type, q) {
    return new Promise(function (resolve, reject) {
      c.toBlob(function (blob) {
        if (!blob) { reject(new Error('encode')); return; }
        var fr = new FileReader();
        fr.onload = function () { resolve(new Uint8Array(fr.result)); };
        fr.onerror = function () { reject(fr.error); };
        fr.readAsArrayBuffer(blob);
      }, type, q);
    });
  }

  function cover(g, img, w, h, over) {
    var k = Math.max(w / img.naturalWidth, h / img.naturalHeight) * over;
    var dw = img.naturalWidth * k, dh = img.naturalHeight * k;
    g.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }

  /* Фон: сол фотоның үлкейтілген, бұлыңғыр көшірмесі. Кішірейтіп барып
     созу — кез келген өлшемде жылдам әрі тегіс бұлыңғырлық береді. */
  function background(img, W, H, divisor) {
    var sw = Math.max(32, Math.round(W / 24)), sh = Math.max(32, Math.round(H / 24));
    var s = canvas(sw, sh), sg = s.getContext('2d');
    sg.imageSmoothingQuality = 'high';
    if ('filter' in sg) sg.filter = 'blur(1.5px)';
    cover(sg, img, sw, sh, 1.35);
    var m = canvas(Math.round(W / 4), Math.round(H / 4)), mg = m.getContext('2d');
    mg.imageSmoothingQuality = 'high';
    mg.drawImage(s, 0, 0, m.width, m.height);
    var c = divisor === 4 ? m : canvas(W, H), g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    if (c !== m) g.drawImage(m, 0, 0, c.width, c.height);
    g.fillStyle = 'rgba(0,0,0,0.14)';
    g.fillRect(0, 0, c.width, c.height);
    return c;
  }

  /* Алдыңғы қабат: ақ жиекті фото, мөлдір фонда, жұмсақ көлеңкемен. */
  function framed(img, W, H, lay) {
    var c = canvas(W, H), g = c.getContext('2d');
    var x = Math.round((W - lay.fw) / 2), y = Math.round((H - lay.fh) / 2);
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.38)';
    g.shadowBlur = Math.round(0.035 * Math.min(W, H));
    g.shadowOffsetY = Math.round(0.008 * Math.min(W, H));
    g.fillStyle = '#ffffff';
    g.fillRect(x, y, lay.fw, lay.fh);
    g.restore();
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, x + lay.border, y + lay.border, lay.pw, lay.ph);
    return c;
  }

  root.PSRender = { exifOrientation: exifOrientation, supported: supported, loadImage: loadImage, background: background,
                    framed: framed, toBytes: toBytes };
})(typeof window !== 'undefined' ? window : this);
