// scripts/build.js — собирает app/entry.jsx → public/app.bundle.js.
//
// Без babel-standalone в браузере: JSX компилируется на этапе деплоя.
// React и ReactDOM остаются external — index.html подключает их прод-
// сборки с CDN, чтобы избежать инлайнинга всей React в бандл.
//
// Запускается:
//   npm run build           — однократная сборка (минифицированная)
//   node scripts/build.js   — то же самое
//   node scripts/build.js --watch — пересборка при изменениях (dev)

const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const ENTRY = path.join(ROOT, 'app', 'entry.jsx');
const OUTDIR = path.join(ROOT, 'app');
const OUTFILE = path.join(OUTDIR, 'bundle.js');

const isWatch = process.argv.includes('--watch');

const baseConfig = {
  entryPoints: [ENTRY],
  bundle: true,
  outfile: OUTFILE,
  loader: { '.jsx': 'jsx', '.js': 'jsx' },
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  // React/ReactDOM грузятся через <script src=…> из index.html
  // и доступны как глобальные window.React / window.ReactDOM.
  // Поскольку наш код их не импортирует (использует глобал),
  // никаких external указывать не нужно.
  target: ['es2020'],
  format: 'iife',
  minify: !isWatch,
  sourcemap: isWatch ? 'inline' : true,
  legalComments: 'none',
  logLevel: 'info',
};

async function run() {
  fs.mkdirSync(OUTDIR, { recursive: true });
  if (isWatch) {
    const ctx = await esbuild.context(baseConfig);
    await ctx.watch();
    console.log('[build] watching app/**/*.jsx → app/bundle.js');
  } else {
    const result = await esbuild.build(baseConfig);
    if (result.errors.length) process.exit(1);
    const size = fs.statSync(OUTFILE).size;
    console.log(`[build] ${OUTFILE} (${(size / 1024).toFixed(1)} KB)`);
  }
}

run().catch(err => { console.error(err); process.exit(1); });
