/**
 * Post-export step for the web build (PWA hardening).
 *
 * Expo export does not copy arbitrary root files, so we copy the service
 * worker and web app manifest into dist-prod and inject the manifest link
 * into the generated index.html.
 *
 * Usage: node scripts/postexport.js [outputDir]
 */
const fs = require('fs');
const path = require('path');

const outputDir = path.resolve(process.argv[2] || 'dist-prod');
const assetsDir = path.resolve('assets');

function copy(from, to) {
  fs.copyFileSync(from, to);
  console.log(`[postexport] copied ${path.relative(process.cwd(), from)} -> ${path.relative(process.cwd(), to)}`);
}

// 1. Service worker must be at the origin root to control the whole scope.
copy(path.join(assetsDir, 'sw.js'), path.join(outputDir, 'sw.js'));

// 2. Web app manifest.
copy(path.join(assetsDir, 'manifest.json'), path.join(outputDir, 'manifest.json'));

// 3. PWA icons (single source icon copied under the sizes the manifest declares).
copy(path.join(assetsDir, 'icon.png'), path.join(outputDir, 'icon-192.png'));
copy(path.join(assetsDir, 'icon.png'), path.join(outputDir, 'icon-512.png'));

// 4. Inject <link rel="manifest"> + theme-color into index.html if missing.
const indexPath = path.join(outputDir, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
if (!html.includes('rel="manifest"')) {
  html = html.replace(
    '<title>',
    '<link rel="manifest" href="/manifest.json" />\n    <meta name="theme-color" content="#1DB954" />\n    <title>'
  );
  fs.writeFileSync(indexPath, html);
  console.log('[postexport] injected manifest link into index.html');
} else {
  console.log('[postexport] index.html already references the manifest');
}

console.log('[postexport] done');
