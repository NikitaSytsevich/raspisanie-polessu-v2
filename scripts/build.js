// scripts/build.js — сборка фронтенда.
//
//   • app/entry.jsx  → app/bundle[.hash].js  (esbuild, JSX → JS, React external)
//   • app/styles.css → app/styles[.hash].css (esbuild CSS-минификатор)
//   • app/vendor/{react,react-dom}.js → app/vendor/{...}[.hash].js (self-host)
//   • index.template.html → index.html   (подстановка хэшированных URL)
//   • sw.template.js      → sw.js         (precache-list + version)
//
// React и ReactDOM НЕ инлайнятся в бандл — они подключаются как глобальные
// window.React / window.ReactDOM из self-hosted UMD-файлов (app/vendor/*),
// поэтому в бандле никаких импортов React нет.
//
// Запуск:
//   npm run build                 — прод-сборка: минификация + content-hash
//                                    в именах файлов + immutable-кэш.
//   node scripts/build.js --watch — dev: стабильные имена, без хэшей,
//                                    inline-sourcemap, пересборка по изменениям.

const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'app');
const ENTRY = path.join(APP, 'entry.jsx');
const CSS_IN = path.join(APP, 'styles.css');
const REACT_SRC = path.join(APP, 'vendor', 'react.js');
const REACTDOM_SRC = path.join(APP, 'vendor', 'react-dom.js');
const HTML_TEMPLATE = path.join(ROOT, 'index.template.html');
const SW_TEMPLATE = path.join(ROOT, 'sw.template.js');
const HTML_OUT = path.join(ROOT, 'index.html');
const SW_OUT = path.join(ROOT, 'sw.js');

const isWatch = process.argv.includes('--watch');

function hash(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);
}

// Удаляем ранее сгенерированные хэшированные артефакты, чтобы app/ не
// зарастал старыми bundle.<hash>.js при каждой сборке.
function cleanHashed() {
  const rm = (dir, re) => {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      if (re.test(f)) { try { fs.unlinkSync(path.join(dir, f)); } catch {} }
    }
  };
  // esbuild [hash] — base32 (A-Z2-7), верхний регистр, переменная длина.
  rm(APP, /^bundle\.[A-Z0-9]+\.js(\.map)?$/i);
  rm(APP, /^styles\.[a-f0-9]{8}\.css$/);
  rm(path.join(APP, 'vendor'), /^react\.[a-f0-9]{8}\.js$/);
  rm(path.join(APP, 'vendor'), /^react-dom\.[a-f0-9]{8}\.js$/);
}

// Копирует vendor-файл (react.js / react-dom.js) в хэшированную копию и
// возвращает публичный URL. В watch — возвращает стабильный URL без копии.
function emitVendor(srcPath, baseName) {
  if (isWatch) return `/app/vendor/${baseName}.js`;
  const buf = fs.readFileSync(srcPath);
  const h = hash(buf);
  const outName = `${baseName}.${h}.js`;
  fs.writeFileSync(path.join(APP, 'vendor', outName), buf);
  return `/app/vendor/${outName}`;
}

async function buildCss() {
  if (!fs.existsSync(CSS_IN)) return '/app/styles.min.css';
  const css = fs.readFileSync(CSS_IN, 'utf8');
  const result = await esbuild.transform(css, { loader: 'css', minify: !isWatch });
  if (isWatch) {
    const out = path.join(APP, 'styles.min.css');
    fs.writeFileSync(out, result.code);
    console.log(`[build] ${out}`);
    return '/app/styles.min.css';
  }
  const h = hash(result.code);
  const outName = `styles.${h}.css`;
  fs.writeFileSync(path.join(APP, outName), result.code);
  console.log(`[build] app/${outName} (${(result.code.length / 1024).toFixed(1)} KB)`);
  return `/app/${outName}`;
}

// Прод-сборка JS: content-hash в имени через entryNames + metafile,
// чтобы узнать итоговое имя файла. Возвращает публичный URL бандла.
async function buildJsProd() {
  const result = await esbuild.build({
    entryPoints: [ENTRY],
    bundle: true,
    outdir: APP,
    entryNames: 'bundle.[hash]',
    loader: { '.jsx': 'jsx', '.js': 'jsx' },
    jsx: 'transform',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
    target: ['es2020'],
    format: 'iife',
    minify: true,
    sourcemap: 'external',
    legalComments: 'none',
    metafile: true,
    logLevel: 'info',
  });
  if (result.errors.length) process.exit(1);
  const jsFile = Object.keys(result.metafile.outputs).find(
    f => f.endsWith('.js') && !f.endsWith('.map')
  );
  const size = fs.statSync(path.join(ROOT, jsFile)).size;
  console.log(`[build] ${jsFile} (${(size / 1024).toFixed(1)} KB)`);
  // jsFile вида "app/bundle.XXXXXXXX.js" → публичный URL "/app/bundle.XXXXXXXX.js"
  return '/' + jsFile.split(path.sep).join('/');
}

// Подставляет ассеты в шаблоны и пишет index.html + sw.js.
function renderTemplates(assets) {
  const version = isWatch
    ? 'dev'
    : 'v9-' + hash([assets.bundle, assets.styles, assets.react, assets.reactDom].join('|'));

  let html = fs.readFileSync(HTML_TEMPLATE, 'utf8');
  html = html
    .replaceAll('__REACT_JS__', assets.react)
    .replaceAll('__REACT_DOM_JS__', assets.reactDom)
    .replaceAll('__BUNDLE_JS__', assets.bundle)
    .replaceAll('__STYLES_CSS__', assets.styles);
  fs.writeFileSync(HTML_OUT, html);
  console.log(`[build] index.html`);

  const precache = [
    '/', '/index.html',
    assets.bundle, assets.styles, assets.react, assets.reactDom,
    '/manifest.webmanifest',
    '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/favicon-32.png',
  ];
  let sw = fs.readFileSync(SW_TEMPLATE, 'utf8');
  sw = sw
    .replaceAll('__VERSION__', version)
    .replaceAll('__PRECACHE_ASSETS__', JSON.stringify(precache, null, 2));
  fs.writeFileSync(SW_OUT, sw);
  console.log(`[build] sw.js (${version})`);
}

const jsWatchConfig = {
  entryPoints: [ENTRY],
  bundle: true,
  outfile: path.join(APP, 'bundle.js'),
  loader: { '.jsx': 'jsx', '.js': 'jsx' },
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  target: ['es2020'],
  format: 'iife',
  minify: false,
  sourcemap: 'inline',
  legalComments: 'none',
  logLevel: 'info',
};

async function run() {
  fs.mkdirSync(path.join(APP, 'vendor'), { recursive: true });

  if (isWatch) {
    // dev: стабильные имена, esbuild watch, шаблоны рендерим один раз.
    const ctx = await esbuild.context(jsWatchConfig);
    await ctx.watch();
    const styles = await buildCss();
    renderTemplates({
      bundle: '/app/bundle.js',
      styles,
      react: '/app/vendor/react.js',
      reactDom: '/app/vendor/react-dom.js',
    });
    console.log('[build] watching app/**/*.jsx → app/bundle.js');
    return;
  }

  // prod: чистим старое, хэшируем всё, рендерим шаблоны.
  cleanHashed();
  const [bundle, styles] = await Promise.all([buildJsProd(), buildCss()]);
  const react = emitVendor(REACT_SRC, 'react');
  const reactDom = emitVendor(REACTDOM_SRC, 'react-dom');
  renderTemplates({ bundle, styles, react, reactDom });
}

run().catch(err => { console.error(err); process.exit(1); });
