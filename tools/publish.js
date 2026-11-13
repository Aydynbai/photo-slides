// Жариялау: releases.json-ға нұсқа қосады (ескілері сақталады — адамдар ескі нұсқаға қайта оралуы үшін).
//   1) PhotoSlides/version.json-да нұсқаны өзгертіп, PhotoSlides/ өзгерістерін commit жасаңыз
//   2) node tools/publish.js "қысқа сипаттама"
//   3) releases.json + latest.json-ды commit + push жасаңыз → «Жаңарту» батырмасы адамдарда пайда болады
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { execSync } = require('child_process');
const root = path.join(__dirname, '..'), ext = path.join(root, 'PhotoSlides');
if (execSync('git status --porcelain PhotoSlides', { cwd: root }).toString().trim()) { console.error('PhotoSlides/ ішінде commit болмаған өзгеріс бар'); process.exit(1); }
const SKIP = new Set(['version.json', 'prefs.json', '.DS_Store']);
const files = {};
(function walk(dir) {
  for (const n of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (!SKIP.has(n) && !n.endsWith('.new')) files[path.relative(ext, p).split(path.sep).join('/')] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  }
})(ext);
const version = JSON.parse(fs.readFileSync(path.join(ext, 'version.json'), 'utf8')).version;
const commit = execSync('git rev-parse HEAD', { cwd: root }).toString().trim();
const file = path.join(root, 'releases.json');
const rel = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { latest: version, versions: {} };
rel.versions[version] = { commit, date: new Date().toISOString().slice(0, 10), notes: process.argv[2] || '', files };
rel.latest = Object.keys(rel.versions).sort((a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); return (x[0] - y[0]) || (x[1] - y[1]) || (x[2] - y[2]); }).pop();
fs.writeFileSync(file, JSON.stringify(rel, null, 2) + '\n');
// 1.2.0 клиенттері latest.json-ға қарайды: оны соңғы нұсқаға бекітеміз.
fs.writeFileSync(path.join(root, 'latest.json'), JSON.stringify({ version: rel.latest, commit: rel.versions[rel.latest].commit, files: rel.versions[rel.latest].files }, null, 2) + '\n');
console.log('releases.json →', Object.keys(rel.versions).join(', '), '| latest', rel.latest, '|', Object.keys(files).length, 'files');
