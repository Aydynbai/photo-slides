/* Photo Slides — Premiere Pro жағы (ExtendScript, ES3). */

var PS_TICKS = 254016000000;

function PS_str(v) {
    var t = typeof v, i, a = [], k;
    if (v === null || v === undefined) { return 'null'; }
    if (t === 'number') { return isFinite(v) ? String(v) : 'null'; }
    if (t === 'boolean') { return v ? 'true' : 'false'; }
    if (t === 'string') {
        var s = '"', c, n;
        for (i = 0; i < v.length; i++) {
            c = v.charAt(i); n = v.charCodeAt(i);
            if (c === '"' || c === '\\') { s += '\\' + c; }
            else if (n < 32 || n > 126) { s += '\\u' + ('0000' + n.toString(16)).slice(-4); }
            else { s += c; }
        }
        return s + '"';
    }
    if (v instanceof Array) {
        for (i = 0; i < v.length; i++) { a.push(PS_str(v[i])); }
        return '[' + a.join(',') + ']';
    }
    for (k in v) { if (v.hasOwnProperty(k)) { a.push(PS_str(k) + ':' + PS_str(v[k])); } }
    return '{' + a.join(',') + '}';
}

function PS_isOurs(clip) {
    return clip && clip.projectItem && String(clip.projectItem.name).indexOf('PS_') === 0;
}

function PS_isPhoto(path) {
    return (/\.(jpe?g|jpe|png|webp|bmp|gif|tiff?|heic|heif|psd|dng|cr2|cr3|nef|arw)$/i).test(String(path));
}

function PS_range(seq) {
    var end = Number(seq.end) / PS_TICKS;
    var a = Number(seq.getInPoint()), b = Number(seq.getOutPoint());
    var eps = 0.0005;
    var set = !(isNaN(a) || isNaN(b) || a < 0 || b <= a) && !(a <= eps && b >= end - eps);
    if (!set) { a = 0; b = end; }
    return { inS: a, outS: b, set: set };
}

function PS_info() {
    try {
        var seq = app.project.activeSequence;
        if (!seq) { return PS_str({ ok: false, err: 'noseq' }); }
        var r = PS_range(seq), eps = 0.0005;
        var best = [], bestTrack = -1, t, c, track, clip, list, path, s, e;
        for (t = 0; t < seq.videoTracks.numTracks; t++) {
            track = seq.videoTracks[t];
            list = [];
            for (c = 0; c < track.clips.numItems; c++) {
                clip = track.clips[c];
                s = Number(clip.start.seconds); e = Number(clip.end.seconds);
                if (e <= r.inS + eps || s >= r.outS - eps) { continue; }
                if (!clip.projectItem || PS_isOurs(clip)) { continue; }
                path = clip.projectItem.getMediaPath();
                if (!path || !PS_isPhoto(path)) { continue; }
                list.push({ start: Math.max(s, r.inS), end: Math.min(e, r.outS), path: String(path) });
            }
            if (list.length > best.length) { best = list; bestTrack = t; }
        }
        return PS_str({
            ok: true, seqName: String(seq.name), projPath: String(app.project.path),
            W: Number(seq.frameSizeHorizontal), H: Number(seq.frameSizeVertical),
            fps: PS_TICKS / Number(seq.timebase), zero: Number(seq.zeroPoint) / PS_TICKS,
            inS: r.inS, outS: r.outS, hasInOut: r.set, track: bestTrack, photos: best
        });
    } catch (err) {
        return PS_str({ ok: false, err: String(err) });
    }
}

function PS_time(sec) { var t = new Time(); t.seconds = sec; return t; }

function PS_trackFree(track, a, b) {
    var c, clip, eps = 0.0005;
    for (c = 0; c < track.clips.numItems; c++) {
        clip = track.clips[c];
        if (Number(clip.end.seconds) > a + eps && Number(clip.start.seconds) < b - eps) { return false; }
    }
    return true;
}

function PS_freeTracks(seq, above, a, b) {
    var out = [], t;
    for (t = above + 1; t < seq.videoTracks.numTracks && out.length < 2; t++) {
        if (PS_trackFree(seq.videoTracks[t], a, b)) { out.push(t); }
    }
    return out;
}

function PS_addTracks(seq, n) {
    var before = seq.videoTracks.numTracks;
    try {
        app.enableQE();
        var q = qe.project.getActiveSequence();
        try { q.addTracks(n, before, 0); } catch (e1) { }
        if (seq.videoTracks.numTracks === before) {
            try { q.addTracks(n, before, 0, 1, 0, 0, 0, 0); } catch (e2) { }
        }
    } catch (e) { }
    return seq.videoTracks.numTracks - before;
}

function PS_clipAt(track, start) {
    var c, clip;
    for (c = 0; c < track.clips.numItems; c++) {
        clip = track.clips[c];
        if (Math.abs(Number(clip.start.seconds) - start) < 0.01) { return clip; }
    }
    return null;
}

function PS_place(track, item, start, end) {
    var dur = end - start, clip;
    try { item.setInPoint(0, 4); item.setOutPoint(dur, 4); } catch (e0) { }
    try { track.overwriteClip(item, PS_time(start)); }
    catch (e1) { track.overwriteClip(item, start); }
    clip = PS_clipAt(track, start);
    if (!clip) { track.overwriteClip(item, start); clip = PS_clipAt(track, start); }
    if (clip && Math.abs(Number(clip.end.seconds) - end) > 0.001) {
        try { clip.end = PS_time(end); } catch (e2) { }
    }
    return clip;
}

function PS_component(clip, matchName, fallbackIndex) {
    var i;
    for (i = 0; i < clip.components.numItems; i++) {
        if (clip.components[i].matchName === matchName) { return clip.components[i]; }
    }
    return clip.components[fallbackIndex];
}

function PS_keyCount(p) { try { var k = p.getKeys(); return k ? k.length : 0; } catch (e) { return 0; } }

/* keys: [[клип басынан секунд, мән], ...] — сызықты интерполяция. */
function PS_animate(clip, p, keys) {
    var same = true, i, base, t, n, T;
    for (i = 1; i < keys.length; i++) { if (PS_str(keys[i][1]) !== PS_str(keys[0][1])) { same = false; } }
    if (same) { p.setValue(keys[0][1], true); return; }
    p.setTimeVarying(true);
    base = Number(clip.inPoint.seconds);
    for (i = 0; i < keys.length; i++) {
        t = base + keys[i][0];
        n = PS_keyCount(p);
        try { p.addKey(t); } catch (e) { }
        if (PS_keyCount(p) > n) {
            p.setValueAtKey(t, keys[i][1], i === keys.length - 1);
            try { p.setInterpolationTypeAtKey(t, 0, false); } catch (e1) { }
        } else {
            T = PS_time(t);
            p.addKey(T);
            p.setValueAtKey(T, keys[i][1], i === keys.length - 1);
            try { p.setInterpolationTypeAtKey(T, 0, false); } catch (e2) { }
        }
    }
}

function PS_bin(name) {
    var root = app.project.rootItem, i;
    for (i = 0; i < root.children.numItems; i++) {
        if (root.children[i].name === name && root.children[i].type === 2) { return root.children[i]; }
    }
    return root.createBin(name);
}

/* Қалтадағы (және оның «Unused» ішкі қалтасындағы) суреттерді аты бойынша жинайды. */
function PS_index(bin, items) {
    var i, j, ch;
    for (i = 0; i < bin.children.numItems; i++) {
        ch = bin.children[i];
        if (ch.type === 2) {
            for (j = 0; j < ch.children.numItems; j++) { if (!items[ch.children[j].name]) { items[ch.children[j].name] = ch.children[j]; } }
        } else { items[ch.name] = ch; }
    }
}

/* Ешбір секвенцияда қолданылмай қалған Photo Slides суреттерін бөлек қалтаға жинайды
   (жобадан өшірмейді — оны пайдаланушы өзі шешеді). */
function PS_tidy(bin) {
    var used = {}, s, t, c, seq, track, i, moved = 0, old = null, list = [];
    for (s = 0; s < app.project.sequences.numSequences; s++) {
        seq = app.project.sequences[s];
        for (t = 0; t < seq.videoTracks.numTracks; t++) {
            track = seq.videoTracks[t];
            for (c = 0; c < track.clips.numItems; c++) {
                if (PS_isOurs(track.clips[c])) { used[String(track.clips[c].projectItem.name)] = true; }
            }
        }
    }
    for (i = 0; i < bin.children.numItems; i++) {
        if (bin.children[i].type !== 2 && !used[String(bin.children[i].name)]) { list.push(bin.children[i]); }
    }
    for (i = 0; i < bin.children.numItems; i++) {
        if (bin.children[i].type === 2 && bin.children[i].name === 'Unused') { old = bin.children[i]; }
    }
    if (old) {   // қайта қолданысқа түскендерін кері қайтару
        var back = [];
        for (i = 0; i < old.children.numItems; i++) { if (used[String(old.children[i].name)]) { back.push(old.children[i]); } }
        for (i = 0; i < back.length; i++) { back[i].moveBin(bin); }
    }
    if (!list.length) { return 0; }
    if (!old) { old = bin.createBin('Unused'); }
    for (i = 0; i < list.length; i++) { list[i].moveBin(old); moved++; }
    return moved;
}

function PS_addDips(trackIndex, dips, timebase) {
    if (!dips.length) { return 0; }
    var track, transition, i, item, count = 0, byStart = {};
    try {
        app.enableQE();
        track = qe.project.getActiveSequence().getVideoTrackAt(trackIndex);
        try { transition = qe.project.getVideoTransitionByName('AE.ADBE Dip To White', true); } catch (e) { }
        if (!transition) { transition = qe.project.getVideoTransitionByName('Dip to White'); }
        if (!transition) { return 0; }
        for (i = 0; i < track.numItems; i++) {
            item = track.getItemAt(i);
            if (item && item.type === 'Clip' && item.start) { byStart[Math.round(Number(item.start.ticks) / timebase)] = item; }
        }
    } catch (eTrack) { return 0; }
    for (i = 0; i < dips.length; i++) {
        item = byStart[Math.round(dips[i].cut * PS_TICKS / timebase)];
        if (!item) { continue; }
        try {
            if (item.addTransition(transition, true, String(dips[i].frames), '0', 0.5) !== false) { count++; }
        } catch (eTransition) { }
    }
    return count;
}

function PS_build(plan) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) { return PS_str({ ok: false, err: 'Секвенция ашық емес' }); }
        var a = plan.inS, b = plan.outS, t, c, track, clip, i, eps = 0.0005;

        /* 1. Осы аралықтағы бұрынғы Photo Slides клиптерін алып тастау (қайта жасағанда қабаттаспасын). */
        for (t = 0; t < seq.videoTracks.numTracks; t++) {
            track = seq.videoTracks[t];
            for (c = track.clips.numItems - 1; c >= 0; c--) {
                clip = track.clips[c];
                if (PS_isOurs(clip) && Number(clip.end.seconds) > a + eps && Number(clip.start.seconds) < b - eps) {
                    clip.remove(false, false);
                }
            }
        }

        /* 2. Фотолардың үстінен екі бос трек: фон және фото. */
        var free = PS_freeTracks(seq, plan.track, a, b);
        if (free.length < 2) {
            PS_addTracks(seq, 2 - free.length);
            free = PS_freeTracks(seq, plan.track, a, b);
        }
        if (free.length < 2) {
            return PS_str({ ok: false, err: 'Фотолардың үстіне ' + (2 - free.length) + ' бос видео трек қосыңыз' });
        }

        /* 3. Дайын суреттерді жобаға импорттау. */
        /* Жобада бар сурет қайта импортталмайды — қайта жасағанда көшірме жиналмайды. */
        var bin = PS_bin('Photo Slides');
        var items = {}, need = [];
        PS_index(bin, items);
        for (i = 0; i < plan.files.length; i++) {
            if (!items[plan.files[i].name]) { need.push(plan.files[i].path); }
        }
        if (need.length) {
            if (!app.project.importFiles(need, true, bin, false)) {
                return PS_str({ ok: false, err: 'Суреттер импортталмады' });
            }
            PS_index(bin, items);
        }

        /* 4. Таймлайнға қою. */
        var tBg = seq.videoTracks[free[0]], tFg = seq.videoTracks[free[1]];
        var it, bg, fg, motion, placed = 0;
        for (i = 0; i < plan.items.length; i++) {
            it = plan.items[i];
            if (!items[it.bg] || !items[it.fg]) { continue; }
            bg = PS_place(tBg, items[it.bg], it.start, it.end);
            fg = PS_place(tFg, items[it.fg], it.start, it.end);
            if (!bg || !fg) { continue; }
            var d = it.end - it.start;
            motion = PS_component(bg, 'AE.ADBE Motion', 1);
            PS_animate(bg, motion.properties[1], [[0, it.bgSc[0]], [d, it.bgSc[1]]]);
            motion = PS_component(fg, 'AE.ADBE Motion', 1);
            PS_animate(fg, motion.properties[0], [[0, it.pos[0]], [d, it.pos[1]]]);
            PS_animate(fg, motion.properties[1], [[0, it.sc[0]], [d, it.sc[1]]]);
            placed++;
        }
        var dips = PS_addDips(free[1], plan.dips, Number(seq.timebase));
        var stale = 0;
        try { stale = PS_tidy(bin); } catch (eT) { }
        return PS_str({ ok: placed > 0, err: placed ? '' : 'Клиптер таймлайнға қойылмады', stale: stale,
                        placed: placed, missedDips: plan.dips.length - dips, tracks: [free[0] + 1, free[1] + 1] });
    } catch (err) {
        return PS_str({ ok: false, err: String(err) + (err && err.line ? ' (' + err.line + ')' : '') });
    }
}
