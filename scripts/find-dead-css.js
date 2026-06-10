// scripts/find-dead-css.js — одноразовый аудит: классы из app/styles.css,
// не упоминаемые в исходниках приложения (с учётом динамических шаблонов).
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const css = fs.readFileSync(path.join(ROOT, 'app/styles.css'), 'utf8');
const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
let depth = 0, sel = '';
const sels = [];
for (const ch of noComments) {
  if (ch === '{') { if (depth === 0) { sels.push(sel); sel = ''; } depth++; }
  else if (ch === '}') { depth--; }
  else if (depth === 0) sel += ch;
}
const classRe = /\.([a-zA-Z_][\w-]*)/g;
const cssClasses = new Set();
for (const s of sels) { let m; while ((m = classRe.exec(s))) cssClasses.add(m[1]); }

const srcFiles = ['home.jsx','changes.jsx','editor.jsx','settings.jsx','stats.jsx','ui.jsx','router.jsx','main.jsx','data.jsx','_logic.js']
  .map(f => path.join(ROOT, 'app', f));
let src = srcFiles.map(f => fs.readFileSync(f, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
).join('\n') + fs.readFileSync(path.join(ROOT, 'index.template.html'), 'utf8');

// Классы, генерируемые динамически (шаблонные строки в JSX)
const extra = new Set(['dark', 'light']);
for (const id of ['ice_arena','sports_pool','small_pool','rowing_base']) extra.add('is-fac-' + id);
for (let i = 0; i < 8; i++) extra.add('idx-' + i);
for (const b of ['confirmed','not_in_site','closed','no_data','occ','free']) extra.add('is-' + b);

const dead = [];
for (const c of cssClasses) {
  if (extra.has(c)) continue;
  const esc = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('(?<![\\w-])' + esc + '(?![\\w-])');
  if (!re.test(src)) dead.push(c);
}
console.log('всего классов:', cssClasses.size, '| мёртвых:', dead.length);
console.log(dead.sort().join('\n'));
