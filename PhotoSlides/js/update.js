/* Photo Slides — нұсқаларды басқару.
   GitHub-тағы releases.json барлық шыққан нұсқаны айтады: әрқайсысының commit-і мен файлдарының SHA-256 сомасы.
   Ештеңе өздігінен орнатылмайды: тек пайдаланушы батырма басқанда. Файлдар сол commit-тен жүктеледі,
   сомасы тексеріледі, бәрі дұрыс болғанда ғана ауыстырылады. */
(function (root) {
  'use strict';
  var REPO = 'Aydynbai/photo-slides';
  var RAW = 'https://raw.githubusercontent.com/' + REPO + '/';
  var SAFE = /^(?!.*\.\.)[A-Za-z0-9_\-][A-Za-z0-9_\-./]*$/;
  var VER = /^\d+\.\d+\.\d+$/;

  function newer(a, b) {   // a > b ?
    var x = String(a).split('.'), y = String(b).split('.'), i;
    for (i = 0; i < 3; i++) { var d = (parseInt(x[i], 10) || 0) - (parseInt(y[i], 10) || 0); if (d) return d > 0; }
    return false;
  }

  function get(url, binary) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return binary ? r.arrayBuffer() : r.text();
    });
  }

  function releases() {
    return get(RAW + 'main/releases.json?t=' + Date.now()).then(function (t) {
      var r = JSON.parse(t), v;
      if (!r || !VER.test(r.latest) || !r.versions || !r.versions[r.latest]) throw new Error('releases.json');
      for (v in r.versions) {
        if (!VER.test(v) || !/^[0-9a-f]{40}$/.test(r.versions[v].commit)) delete r.versions[v];
      }
      return r;
    });
  }

  function localVersion(env) {
    try { return JSON.parse(env.fs.readFileSync(env.path.join(env.dir, 'version.json'), 'utf8')).version; } catch (e) { return '0'; }
  }
  function readPrefs(env) {
    try { return JSON.parse(env.fs.readFileSync(env.path.join(env.dir, 'prefs.json'), 'utf8')) || {}; } catch (e) { return {}; }
  }
  function writePrefs(env, p) { env.fs.writeFileSync(env.path.join(env.dir, 'prefs.json'), JSON.stringify(p)); }

  /* rel — releases(); ver — орнатылатын нұсқа (жаңасы да, ескісі де). */
  function install(env, rel, ver) {
    var fs = env.fs, path = env.path, m = rel.versions[ver];
    if (!m) return Promise.reject(new Error('нұсқа табылмады'));
    function sha(buf) { return env.crypto.createHash('sha256').update(buf).digest('hex'); }
    var todo = [];
    Object.keys(m.files).forEach(function (n) {
      if (!SAFE.test(n)) throw new Error('bad path');
      var cur = null;
      try { cur = sha(fs.readFileSync(path.join(env.dir, n))); } catch (e) { }
      if (cur !== m.files[n]) todo.push(n);
    });
    return Promise.all(todo.map(function (n) {
      return get(RAW + m.commit + '/PhotoSlides/' + n, true).then(function (ab) {
        var buf = env.Buffer.from(ab);
        if (sha(buf) !== m.files[n]) throw new Error('checksum: ' + n);
        return { name: n, buf: buf };
      });
    })).then(function (got) {   // бәрі жүктеліп, тексерілген соң ғана жазамыз
      got.forEach(function (g) {
        var dest = path.join(env.dir, g.name), dir = path.dirname(dest);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        fs.writeFileSync(dest + '.new', g.buf);
        fs.renameSync(dest + '.new', dest);
      });
      fs.writeFileSync(path.join(env.dir, 'version.json'), JSON.stringify({ version: ver }));
      return ver;
    });
  }

  var api = { newer: newer, releases: releases, localVersion: localVersion, readPrefs: readPrefs, writePrefs: writePrefs, install: install };
  if (typeof window !== 'undefined') window.PSUpdate = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(this);
