/* Photo Slides — автожаңарту.
   GitHub-тағы latest.json жарияланған нұсқаны, оның commit-ін және әр файлдың SHA-256 сомасын айтады.
   Жаңа нұсқа шықса, файлдар сол commit-тен жүктеледі, сомасы тексеріледі, содан кейін ғана ауыстырылады. */
(function (root) {
  'use strict';
  var REPO = 'Aydynbai/photo-slides';
  var RAW = 'https://raw.githubusercontent.com/' + REPO + '/';
  var SAFE = /^(?!.*\.\.)[A-Za-z0-9_\-][A-Za-z0-9_\-./]*$/;

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

  /* env: { fs, path, crypto, Buffer, dir } → Promise<null | version> */
  function check(env) {
    var fs = env.fs, path = env.path, local = '0';
    try { local = JSON.parse(fs.readFileSync(path.join(env.dir, 'version.json'), 'utf8')).version; } catch (e) { }
    function sha(buf) { return env.crypto.createHash('sha256').update(buf).digest('hex'); }

    return get(RAW + 'main/latest.json?t=' + Date.now()).then(function (text) {
      var m = JSON.parse(text);
      if (!m || !newer(m.version, local) || !/^[0-9a-f]{40}$/.test(m.commit)) return null;
      var names = Object.keys(m.files), todo = [];
      names.forEach(function (n) {
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
        fs.writeFileSync(path.join(env.dir, 'version.json'), JSON.stringify({ version: m.version }));
        return m.version;
      });
    });
  }

  var api = { check: check, newer: newer };
  if (typeof window !== 'undefined') window.PSUpdate = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(this);
