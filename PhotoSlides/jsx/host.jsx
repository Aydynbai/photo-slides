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

function PS_isOurs(clip, owned) {
    return clip && clip.projectItem && owned[clip.projectItem.nodeId] === true;
}

function PS_owned() {
    var owned = {}, roots = app.project.rootItem.children, i, j, k, bin, child;
    for (i = 0; i < roots.numItems; i++) {
        bin = roots[i];
        if (bin.type !== 2 || bin.name !== 'Photo Slides') { continue; }
        for (j = 0; j < bin.children.numItems; j++) {
            child = bin.children[j];
            if (child.type === 2 && child.name === 'Unused') {
                for (k = 0; k < child.children.numItems; k++) { PS_markOwned(child.children[k], owned); }
            } else { PS_markOwned(child, owned); }
        }
    }
    return owned;
}

function PS_mediaPath(path) {
    var normalized = String(path).replace(/\\/g, '/');
    return /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized;
}

function PS_markOwned(item, owned) {
    if (item.type === 2) { return; }
    var path = PS_mediaPath(item.getMediaPath());
    if (/\/Photo Slides Media\/PS_(?:[a-f0-9]{8}_(?:bg4?\.jpg|photo\.png)|(?:flash|ink)_\d+x\d+\.png)$/i.test(path)) {
        owned[item.nodeId] = true;
    }
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
        var owned = PS_owned();
        var best = [], bestTrack = -1, t, c, track, clip, list, path, s, e;
        for (t = 0; t < seq.videoTracks.numTracks; t++) {
            track = seq.videoTracks[t];
            list = [];
            for (c = 0; c < track.clips.numItems; c++) {
                clip = track.clips[c];
                s = Number(clip.start.seconds); e = Number(clip.end.seconds);
                if (e <= r.inS + eps || s >= r.outS - eps) { continue; }
                if (!clip.projectItem || PS_isOurs(clip, owned)) { continue; }
                path = clip.projectItem.getMediaPath();
                if (!path || !PS_isPhoto(path)) { continue; }
                list.push({ start: Math.max(s, r.inS), end: Math.min(e, r.outS), path: String(path) });
            }
            if (list.length > best.length) { best = list; bestTrack = t; }
        }
        return PS_str({
            ok: true, seqId: String(seq.sequenceID), seqName: String(seq.name), projPath: String(app.project.path),
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
        if (!(seq.videoTracks[t].isLocked && seq.videoTracks[t].isLocked()) && PS_trackFree(seq.videoTracks[t], a, b)) { out.push(t); }
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
    var low = 0, high = track.clips.numItems - 1, middle, clip, delta;
    while (low <= high) {
        middle = Math.floor((low + high) / 2);
        clip = track.clips[middle];
        delta = Number(clip.start.seconds) - start;
        if (Math.abs(delta) < 0.0005) { return clip; }
        if (delta < 0) { low = middle + 1; } else { high = middle - 1; }
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
    var inserted = [], disabled = [];
    try {
        var source = plan.source, seq = app.project.activeSequence;
        var current = PS_info();
        if (!seq || current !== PS_str(source)) {
            return PS_str({ ok: false, err: 'Секвенция немесе фото аралығы өзгерді. GO батырмасын қайта басыңыз.' });
        }
        var a = source.inS, b = source.outS, above = source.track, owned = PS_owned();
        var t, c, track, clip, i, start, end, old = [], eps = 0.0005;
        for (t = 0; t < seq.videoTracks.numTracks; t++) {
            track = seq.videoTracks[t];
            for (c = 0; c < track.clips.numItems; c++) {
                clip = track.clips[c];
                if (!PS_isOurs(clip, owned) || clip.disabled) { continue; }
                start = Number(clip.start.seconds); end = Number(clip.end.seconds);
                if (end <= a + eps || start >= b - eps) { continue; }
                above = Math.max(above, t);
                if (start >= a - eps && end <= b + eps && !(track.isLocked && track.isLocked())) {
                    old.push(clip);
                }
            }
        }

        var bin = PS_bin('Photo Slides');
        var items = {}, need = [];
        PS_index(bin, items);
        for (i = 0; i < plan.files.length; i++) {
            var file = plan.files[i];
            if (!items[file.name]) { need.push(file.path); }
            else if (PS_mediaPath(items[file.name].getMediaPath()) !== PS_mediaPath(file.path)) {
                throw new Error('Photo Slides Media файлының жолы сәйкес келмейді');
            }
        }
        if (need.length) {
            if (!app.project.importFiles(need, true, bin, false)) { throw new Error('Суреттер импортталмады'); }
            PS_index(bin, items);
        }
        for (i = 0; i < plan.items.length; i++) {
            if (!items[plan.items[i].bg] || !items[plan.items[i].fg]) { throw new Error('Дайын фото табылмады'); }
        }

        var free = PS_freeTracks(seq, above, a, b);
        if (free.length < 2) {
            PS_addTracks(seq, 2 - free.length);
            free = PS_freeTracks(seq, above, a, b);
        }
        if (free.length < 2) { throw new Error('Фотолардың үстіне екі бос видео трек қажет'); }

        var tBg = seq.videoTracks[free[0]], tFg = seq.videoTracks[free[1]];
        var it, bg, fg, motion;
        for (i = 0; i < plan.items.length; i++) {
            it = plan.items[i];
            bg = PS_place(tBg, items[it.bg], it.start, it.end);
            if (bg) { inserted.push(bg); }
            fg = PS_place(tFg, items[it.fg], it.start, it.end);
            if (fg) { inserted.push(fg); }
            if (!bg || !fg || Math.abs(Number(bg.end.seconds) - it.end) > eps ||
                Math.abs(Number(fg.end.seconds) - it.end) > eps) {
                throw new Error('Клиптер таймлайнға толық қойылмады');
            }
            var d = it.end - it.start, factor = it.bgFactor || 1;
            motion = PS_component(bg, 'AE.ADBE Motion', 1);
            PS_animate(bg, motion.properties[1], [[0, it.bgSc[0] * factor], [d, it.bgSc[1] * factor]]);
            motion = PS_component(fg, 'AE.ADBE Motion', 1);
            PS_animate(fg, motion.properties[0], [[0, it.pos[0]], [d, it.pos[1]]]);
            PS_animate(fg, motion.properties[1], [[0, it.sc[0]], [d, it.sc[1]]]);
        }
        var dips = PS_addDips(free[1], plan.dips, Number(seq.timebase));
        var coverage = [], span;
        for (i = 0; i < plan.items.length; i++) {
            it = plan.items[i];
            span = coverage[coverage.length - 1];
            if (span && it.start <= span.end + eps) { span.end = Math.max(span.end, it.end); }
            else { coverage.push({ start: it.start, end: it.end }); }
        }
        for (i = 0; i < old.length; i++) {
            clip = old[i];
            start = Number(clip.start.seconds); end = Number(clip.end.seconds);
            for (c = 0; c < coverage.length; c++) {
                if (coverage[c].start > start + eps) { break; }
                if (coverage[c].end >= end - eps) {
                    disabled.push(clip);
                    clip.disabled = true;
                    if (!clip.disabled) { throw new Error('Бұрынғы клипті уақытша өшіру мүмкін болмады'); }
                    break;
                }
            }
        }
        return PS_str({ ok: true, placed: plan.items.length, missedDips: plan.dips.length - dips,
                        tracks: [free[0] + 1, free[1] + 1] });
    } catch (err) {
        var recovered = true, j;
        for (j = disabled.length - 1; j >= 0; j--) {
            try { disabled[j].disabled = false; if (disabled[j].disabled) { recovered = false; } }
            catch (eRestore) { recovered = false; }
        }
        for (j = inserted.length - 1; j >= 0; j--) {
            try { if (inserted[j].remove(false, false) !== 0) { recovered = false; } }
            catch (eRemove) { recovered = false; }
        }
        return PS_str({ ok: false, err: String(err) + (recovered ? '' : ' · Таймлайнды тексеріңіз') });
    }
}
