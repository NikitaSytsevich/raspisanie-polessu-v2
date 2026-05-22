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
const CSS_IN = path.join(OUTDIR, 'styles.css');

const isWatch = process.argv.includes('--watch');

const jsConfig = {
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
  // 'external' в проде: source-map пишется в .map-файл, но в bundle.js НЕТ
  // //# sourceMappingURL — браузер не качает карту автоматически, при этом
  // файл остаётся доступен для локального debug / Sentry upload.
  // В watch — inline, чтобы DevTools сразу показывал JSX-исходники.
  sourcemap: isWatch ? 'inline' : 'external',
  legalComments: 'none',
  logLevel: 'info',
};

// CSS обрабатываем отдельно: на исходник в app/styles.css натягиваем
// esbuild-CSS-минификатор и пишем рядом styles.min.css. В index.html
// меняем ссылку на минифицированную версию (см. ниже).
const CSS_OUT = path.join(OUTDIR, 'styles.min.css');
async function buildCss() {
  if (!fs.existsSync(CSS_IN)) return;
  const css = fs.readFileSync(CSS_IN, 'utf8');
  const result = await esbuild.transform(css, {
    loader: 'css',
    minify: !isWatch,
  });
  fs.writeFileSync(CSS_OUT, result.code);
  const size = fs.statSync(CSS_OUT).size;
  console.log(`[build] ${CSS_OUT} (${(size / 1024).toFixed(1)} KB)`);
}

async function run() {
  fs.mkdirSync(OUTDIR, { recursive: true });
  if (isWatch) {
    const ctx = await esbuild.context(jsConfig);
    await ctx.watch();
    await buildCss();
    console.log('[build] watching app/**/*.jsx → app/bundle.js');
  } else {
    const result = await esbuild.build(jsConfig);
    if (result.errors.length) process.exit(1);
    const size = fs.statSync(OUTFILE).size;
    console.log(`[build] ${OUTFILE} (${(size / 1024).toFixed(1)} KB)`);
    await buildCss();
  }
}

run().catch(err => { console.error(err); process.exit(1); });
