/* Photo Slides — панель логикасы. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var cep = window.__adobe_cep__;
  var preparing = false, stopped = false, refreshing = false;
  var busy = false, mode = 'mix', last = null;

  /* ---- орта: Premiere (CEP + Node) немесе тест ---- */
  function nodeIO() {
    var req = (window.cep_node && window.cep_node.require) || window.require;
    var fs = req('fs'), path = req('path');
    return {
      read: function (p) {
        return new Promise(function (resolve, reject) {
          fs.readFile(p, function (err, bytes) { if (err) reject(err); else resolve(bytes); });
        });
      },
      write: function (p, bytes) {
        return new Promise(function (resolve, reject) {
          var data = (window.cep_node ? window.cep_node.Buffer : Buffer).from(bytes);
          var temp = p + '.tmp-' + Date.now() + '-' + Math.random().toString(36).slice(2);
          fs.writeFile(temp, data, function (err) {
            if (err) { fs.unlink(temp, function () {}); reject(err); return; }
            fs.rename(temp, p, function (moveError) {
              if (moveError) { fs.unlink(temp, function () {}); reject(moveError); }
              else resolve();
            });
          });
        });
      },
      mkdir: function mk(d) { if (fs.existsSync(d)) return; mk(path.dirname(d)); fs.mkdirSync(d); },
      exists: function (p) { return fs.existsSync(p); },
      stamp: function (p) { try { var st = fs.statSync(p); return st.size + ':' + Math.round(st.mtimeMs || +st.mtime); } catch (e) { return '0'; } },
      readText: function (p) { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return ''; } },
      writeText: function (p, t) { fs.writeFileSync(p, t, 'utf8'); },
      join: path.join, dirname: path.dirname
    };
  }
  var io = window.__PS_IO || null;
  function getIO() { return io || (io = nodeIO()); }

  function host(script) {
    return new Promise(function (resolve, reject) {
      if (!cep) { reject(new Error('Premiere табылмады')); return; }
      cep.evalScript(script, function (res) {
        if (res === 'EvalScript error.' || res == null) { reject(new Error('Premiere скрипті қате берді')); return; }
        try { resolve(JSON.parse(res)); } catch (e) { reject(new Error(String(res).slice(0, 160))); }
      });
    });
  }
  function hash(str) {   // FNV-1a — файл атына тұрақты қысқа кілт
    var h = 0x811c9dc5, i;
    for (i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; }
    return ('0000000' + h.toString(16)).slice(-8);
  }
  function lit(obj) {   // ExtendScript-ке қауіпсіз литерал (ASCII емес таңбалар \u түрінде)
    return JSON.stringify(obj).replace(/[\u007f-￿]/g, function (c) {
      return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
    });
  }

  /* ---- көрсету ---- */
  function tc(sec, fps) {
    var f = Math.round(sec * fps), r = Math.round(fps);
    var ff = f % r, s = Math.floor(f / r), ss = s % 60, m = Math.floor(s / 60), mm = m % 60, hh = Math.floor(m / 60);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return (hh ? p(hh) + ':' : '') + p(mm) + ':' + p(ss) + ':' + p(ff);
  }
  function status(text, cls) { var s = $('status'); s.textContent = text || ''; s.className = 'status' + (cls ? ' ' + cls : ''); }
  function progress(v) { $('prog').style.width = Math.round(v * 100) + '%'; }

  function show(info) {
    last = info;
    var ok = info && info.ok;
    $('seq').textContent = ok ? info.seqName : '';
    $('range').className = 'range' + (ok && info.hasInOut ? '' : ' unset');
    $('in').textContent = ok ? tc(info.inS + info.zero, info.fps) : '--:--:--';
    $('out').textContent = ok ? tc(info.outS + info.zero, info.fps) : '--:--:--';
    var n = ok ? info.photos.length : 0;
    $('count').textContent = n;
    $('dur').textContent = ok && n ? tc(info.outS - info.inS, info.fps) : '';
    if (busy) return;
    $('go').disabled = n === 0 || !info.projPath;
    if (ok && !info.projPath) { status('Алдымен жобаны сақтаңыз'); return; }
    if ($('status').className !== 'status') return;
    if (!ok) status('Секвенцияны ашыңыз');
    else if (!info.hasInOut) status(n ? 'In/Out белгіленбеген — бүкіл секвенция алынады' : 'Таймлайнға фото қойып, I және O басыңыз');
    else if (!n) status('Бұл аралықта фото жоқ');
    else if ($('status').className === 'status') status('V' + (info.track + 1) + ' трегіндегі фотолар');
  }

  function refresh() {
    if (busy || refreshing || document.hidden) return;
    refreshing = true;
    host('PS_info()').then(function (info) {
      if (!busy) show(info);
    }, function () {
      if (!busy) show(null);
    }).then(function () { refreshing = false; });
  }

  /* ---- негізгі әрекет ---- */
  function run() {
    if (preparing) {
      stopped = true;
      $('go').disabled = true;
      status('Тоқтатылуда…');
      return;
    }
    if (busy) return;
    busy = preparing = true;
    stopped = false;
    $('go').textContent = 'STOP';
    progress(0.02); status('Дайындалуда…');
    var R = window.PSRender, P = window.PSPlan, f, selectedMode = mode;
    var index, idxPath, dirty = false;
    var used = [], skipped = 0, files = [], cache = Object.create(null);
    var cancelled = new Error('Тоқтатылды');

    function checkStop() { if (stopped) throw cancelled; }

    host('PS_info()').then(function (i) {
      checkStop();
      f = getIO();
      if (i.ok && !i.projPath) throw new Error('Алдымен жобаны сақтаңыз');
      if (!i.ok || !i.photos.length) throw new Error('Аралықта фото жоқ');
      /* Тұрақты қалта мен тұрақты файл аттары: бір фото бір-ақ рет дайындалады,
         қайта жасағанда дайын файл мен жобадағы дайын элемент қайта қолданылады. */
      var dir = f.join(f.dirname(i.projPath), 'Photo Slides Media');
      f.mkdir(dir);
      var W = i.W, H = i.H, chain = Promise.resolve();
      idxPath = f.join(dir, 'index.json');
      index = {};
      try { index = JSON.parse(f.readText(idxPath) || '{}'); } catch (e) { index = {}; }
      function add(name) { files.push({ name: name, path: f.join(dir, name) }); }

      i.photos.forEach(function (ph, idx) {
        chain = chain.then(function () {
          checkStop();
          status('Фото ' + (idx + 1) + '/' + i.photos.length + ' дайындалуда…');
          progress(0.05 + 0.75 * idx / i.photos.length);
          if (!R.supported(ph.path)) { skipped++; return; }
          if (cache[ph.path]) { used.push(Object.assign({}, ph, cache[ph.path])); return; }
          var key = hash(ph.path + '|' + f.stamp(ph.path) + '|' + W + 'x' + H + '|v2');
          var bgDivisor = W % 4 === 0 && H % 4 === 0 ? 4 : 1;
          var bgName = 'PS_' + key + (bgDivisor === 4 ? '_bg4.jpg' : '_bg.jpg'), fgName = 'PS_' + key + '_photo.png';
          function done(iw, ih) {
            add(bgName); add(fgName);
            cache[ph.path] = { iw: iw, ih: ih, bg: bgName, fg: fgName };
            used.push(Object.assign({}, ph, cache[ph.path]));
          }
          var hit = index[key];
          if (hit && f.exists(f.join(dir, bgName)) && f.exists(f.join(dir, fgName))) { done(hit.iw, hit.ih); return; }
          return R.loadImage(f, ph.path).then(function (L) {
            var img = L.img, iw = img.naturalWidth, ih = img.naturalHeight;
            var lay = P.layout(iw, ih, W, H);
            return Promise.resolve().then(function () {
              checkStop();
              if (f.exists(f.join(dir, bgName))) return;
              return R.toBytes(R.background(img, W, H, bgDivisor), 'image/jpeg', 0.9).then(function (bytes) {
                checkStop();
                return f.write(f.join(dir, bgName), bytes);
              });
            }).then(function () {
              checkStop();
              if (hit && f.exists(f.join(dir, fgName))) return;
              return R.toBytes(R.framed(img, W, H, lay), 'image/png').then(function (bytes) {
                checkStop();
                return f.write(f.join(dir, fgName), bytes);
              });
            }).then(function () {
              index[key] = { iw: iw, ih: ih };
              dirty = true;
              done(iw, ih);
            }).then(function () { URL.revokeObjectURL(L.url); }, function (err) {
              URL.revokeObjectURL(L.url);
              throw err;
            });
          }, function () { skipped++; });
        });
      });

      return chain.then(function () {
        checkStop();
        if (!used.length) throw new Error('Фотолар оқылмады (JPG, PNG, WebP қолдайды)');
        var plan = P.build(used, { W: W, H: H, fps: i.fps }, selectedMode);
        plan.items.forEach(function (it, k) { it.bg = used[k].bg; it.fg = used[k].fg; it.bgFactor = /_bg4\.jpg$/.test(it.bg) ? 4 : 1; delete it.layout; });
        preparing = false;
        $('go').textContent = 'GO';
        $('go').disabled = true;
        status('Таймлайнға қойылуда…'); progress(0.85);
        return host('PS_build(' + lit({ source: i, files: files,
          items: plan.items, dips: plan.dips }) + ')');
      });
    }).then(function (res) {
      if (!res.ok) throw new Error(res.err || 'Белгісіз қате');
      progress(1);
      status('Дайын: ' + res.placed + ' слайд · V' + res.tracks.join(', V') +
             (res.missedDips ? ' · Dip to White қосылмады: ' + res.missedDips : '') +
             (skipped ? ' · ' + skipped + ' фото өткізілді (формат)' : ''), 'ok');
    }).catch(function (e) {
      progress(0);
      status(e && e.message ? e.message : String(e), e === cancelled ? 'ok' : 'err');
    }).then(function () {
      if (dirty) {
        try { f.writeText(idxPath, JSON.stringify(index)); } catch (err) { console.warn(err); }
      }
      busy = preparing = false;
      $('go').textContent = 'GO';
      $('go').disabled = !(last && last.ok && last.projPath && last.photos.length);
      setTimeout(function () { if (!busy) progress(0); }, 1200);
    });
  }

  /* ---- оқиғалар ---- */
  Array.prototype.forEach.call(document.querySelectorAll('.motion button'), function (b) {
    b.addEventListener('click', function () {
      mode = b.getAttribute('data-mode');
      Array.prototype.forEach.call(document.querySelectorAll('.motion button'), function (x) {
        x.className = x === b ? 'on' : '';
      });
    });
  });
  $('go').addEventListener('click', run);

  /* ---- жылдам жаңарту: файл өзгерсе панель өзі қайта жүктеледі, Premiere-ді жаппай-ақ ---- */
  var extDir = decodeURI(location.pathname).replace(/\/[^\/]*$/, '').replace(/^\/([A-Za-z]:)/, '$1');
  function loadHost() {   // host.jsx-ті әр жүктелген сайын қайта оқыту
    return new Promise(function (resolve) {
      if (!cep) { resolve(); return; }
      cep.evalScript('$.evalFile(' + lit(extDir + '/jsx/host.jsx') + ')', function () { resolve(); });
    });
  }
  (function watch() {
    try {
      var req = (window.cep_node && window.cep_node.require) || window.require;
      var fs = req('fs'), path = req('path'), real = fs.realpathSync(extDir), timer = null;
      var bump = function () {
        clearTimeout(timer);
        timer = setTimeout(function tick() { if (busy) { timer = setTimeout(tick, 500); } else { location.reload(); } }, 400);
      };
      ['', 'js', 'css', 'jsx'].forEach(function (d) { fs.watch(path.join(real, d), bump); });
    } catch (e) { /* Node жоқ орта (тест) — бақылаусыз жұмыс істей береді */ }
  })();
  window.addEventListener('focus', refresh);
  document.addEventListener('mouseenter', refresh);
  loadHost().then(function () { setInterval(refresh, 5000); refresh(); });

  /* ---- нұсқалар: ештеңе өздігінен орнатылмайды ---- */
  var U = function () { return window.__PS_UPD || window.PSUpdate; };
  var uenv = null, rel = null, local = '0', prefs = {}, checking = null;
  function updEnv() {
    if (window.__PS_UPD) return null;
    if (uenv) return uenv;
    var req = (window.cep_node && window.cep_node.require) || window.require, fs = req('fs');
    return (uenv = { fs: fs, path: req('path'), crypto: req('crypto'),
      Buffer: window.cep_node ? window.cep_node.Buffer : Buffer, dir: fs.realpathSync(extDir) });
  }
  function verLabel() { $('ver').textContent = 'v' + local + (prefs.pinned ? ' · бекітілген' : ''); }

  function renderVersions() {
    var box = $('vers'), list = Object.keys(rel.versions).sort(function (a, b) { return U().newer(a, b) ? -1 : 1; });
    box.innerHTML = '';
    list.forEach(function (v) {
      var m = rel.versions[v], row = document.createElement('div'), b = document.createElement('b'),
          sm = document.createElement('small'), btn = document.createElement('button');
      row.className = 'row' + (v === local ? ' cur' : '');
      b.textContent = v;
      var label = v === local ? 'қазір' : v === rel.latest ? 'соңғы' : '';
      sm.textContent = [label, m.notes].filter(Boolean).join(' · ');
      sm.title = sm.textContent;
      row.appendChild(b); row.appendChild(sm);
      if (v !== local) {
        btn.textContent = v === rel.latest ? 'Жаңарту' : 'Орнату';
        btn.addEventListener('click', function () { doInstall(v); });
        row.appendChild(btn);
      }
      box.appendChild(row);
    });
    box.title = 'Ескі нұсқаны орнатсаңыз, ол бекітіледі (жаңарту ұсынылмайды). Соңғысын орнатсаңыз, бекіту алынады.';
  }

  function showUpdate() {
    var has = rel && !prefs.pinned && U().newer(rel.latest, local);
    $('upd').hidden = !has;
    if (has) $('upd').textContent = 'Жаңарту → ' + rel.latest;
  }

  function checkStatus(message) {
    $('checkStatus').textContent = message;
    $('checkStatus').hidden = !message;
  }

  function checkUpdates(manual) {
    if (manual) {
      $('check').disabled = true;
      checkStatus('Тексерілуде…');
    }
    if (!checking) {
      checking = U().releases().then(function (r) {
        rel = r;
        $('ver').disabled = false;
        showUpdate();
        if (!$('vers').hidden) renderVersions();
      });
      var clear = function () { checking = null; };
      checking.then(clear, clear);
    }
    if (!manual) return;
    checking.then(function () {
      $('check').disabled = false;
      if (U().newer(rel.latest, local)) {
        checkStatus('Жаңа нұсқа: ' + rel.latest + (prefs.pinned ? ' · Нұсқалар тізімінен орнатуға болады.' : ''));
      } else {
        checkStatus('Сізде соңғы нұсқа орнатылған.');
      }
    }, function () {
      $('check').disabled = false;
      checkStatus('Жаңартуды тексеру мүмкін болмады. Қайталап көріңіз.');
    });
  }

  function doInstall(v) {
    if (busy || !rel) return;
    var latest = rel.latest;
    busy = true; $('go').disabled = true; $('upd').disabled = true;
    status('Жүктелуде: ' + v + '…');
    U().install(updEnv(), rel, v).then(function () {
      prefs.pinned = v !== latest;   // ескі нұсқа — бекітіледі, соңғысы — бекіту алынады
      U().writePrefs(updEnv(), prefs);
      try { sessionStorage.setItem('ps-updated', v); } catch (e) { }
      status('Орнатылды: ' + v + '. Панель қайта жүктеледі…', 'ok');
      setTimeout(function () { location.reload(); }, 800);
    }, function (e) {
      busy = false; $('upd').disabled = false; show(last);
      status('Орнату мүмкін болмады: ' + (e && e.message ? e.message : e) + '. Бұрынғы нұсқа сақталды.', 'err');
    });
  }

  $('ver').addEventListener('click', function () {
    if (!rel) return;
    var box = $('vers');
    box.hidden = !box.hidden;
    this.setAttribute('aria-expanded', String(!box.hidden));
    if (!box.hidden) renderVersions();
  });
  $('check').addEventListener('click', function () { checkUpdates(true); });
  $('upd').addEventListener('click', function () { doInstall(rel.latest); });

  (function updates() {
    try {
      var env = updEnv();
      local = U().localVersion(env); prefs = U().readPrefs(env);
      verLabel();
      var done = null;
      try { done = sessionStorage.getItem('ps-updated'); sessionStorage.removeItem('ps-updated'); } catch (e) { }
      if (done) setTimeout(function () { status('Орнатылды: ' + done, 'ok'); }, 300);
      checkUpdates(false);
    } catch (e) { $('ver').hidden = true; $('check').hidden = true; }
  })();
})();
