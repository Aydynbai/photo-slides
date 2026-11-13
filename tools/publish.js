// Жариялау: latest.json-ды HEAD commit-ке бекітеді. Алдымен PhotoSlides/ өзгерістері commit болуы керек.
//   node tools/publish.js   → latest.json жазылады; оны commit + push жасаған сәтте жаңарту бәріне тарайды.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { execSync } = require('child_process');
const root = path.join(__dirname, '..'), ext = path.join(root, 'PhotoSlides');
if (execSync('git status --porcelain PhotoSlides', { cwd: root }).toString().trim()) { console.error('PhotoSlides/ ішінде commit болмаған өзгеріс бар'); process.exit(1); }
const files = {};
(function walk(dir) {
  for (const n of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (n !== 'version.json' && n !== '.DS_Store') files[path.relative(ext, p).split(path.sep).join('/')] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  }
})(ext);
const out = { version: JSON.parse(fs.readFileSync(path.join(ext, 'version.json'), 'utf8')).version, commit: execSync('git rev-parse HEAD', { cwd: root }).toString().trim(), files };
fs.writeFileSync(path.join(root, 'latest.json'), JSON.stringify(out, null, 2) + '\n');
console.log('latest.json →', out.version, out.commit.slice(0, 7), Object.keys(files).length, 'files');
