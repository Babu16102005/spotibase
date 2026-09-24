// SpotiBase - Minimal production static file server for the web frontend bundle.
// Serves ./dist-prod (expo export --platform web) on port 3000.
// Usage: node serve-frontend.js [port]
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, 'mobile', 'dist-prod');
const PORT = parseInt(process.argv[2] || '3000', 10);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.wasm': 'application/wasm',
};

// Static, hashed, content-addressed assets (never change once built) can be
// cached for a full year, immutable. Everything else must revalidate so
// updates propagate.
function isImmutable(urlPath, filePath) {
  return !isRevalidate(urlPath, filePath) && (
    urlPath.includes('/_expo/') ||
    urlPath.includes('/static/') ||
    /\.(js|mjs|css|png|jpg|jpeg|gif|webp|svg|woff|woff2|ttf|otf|ico|wasm)$/i.test(filePath)
  );
}

// Documents and app-shell metadata must always revalidate so updates
// propagate: index.html, the service worker, and the PWA manifest. Note the
// service worker and manifest are root-level files whose names don't follow
// the content-hashed convention, even though sw.js technically ends in ".js".
function isRevalidate(urlPath, filePath) {
  const base = path.basename(filePath).toLowerCase();
  return (
    urlPath === '/' ||
    /\.html?$/i.test(filePath) ||
    base === 'sw.js' ||
    base === 'service-worker.js' ||
    base === 'manifest.json' ||
    base === 'manifest.webmanifest'
  );
}

// Text-ish content types we are willing to gzip on the fly for local/dev,
// since dev typically bypasses nginx.
function isCompressible(ext) {
  return (
    ext === '.html' ||
    ext === '.js' ||
    ext === '.mjs' ||
    ext === '.css' ||
    ext === '.json' ||
    ext === '.svg' ||
    ext === '.txt' ||
    ext === '.xml' ||
    ext === '.wasm'
  );
}

function send(res, code, body, type, headers) {
  const resHeaders = Object.assign({
    'Content-Type': type || 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
  }, headers || {});
  res.writeHead(code, resHeaders);
  res.end(body);
}

http.createServer((req, res) => {
  try {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    let filePath = path.normalize(path.join(ROOT, urlPath));

    // Prevent path traversal
    if (!filePath.startsWith(ROOT)) {
      return send(res, 403, 'Forbidden');
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }

    if (!fs.existsSync(filePath)) {
      // SPA fallback
      filePath = path.join(ROOT, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const isImmutableAsset = isImmutable(urlPath, filePath);
    const data = fs.readFileSync(filePath);

    // HTML and SW/manifest must revalidate; hashed static assets may cache forever.
    let cacheControl;
    if (isImmutableAsset) {
      cacheControl = 'public, max-age=31536000, immutable';
    } else {
      // HTML (app shell) plus sw.js / manifest.json always revalidate so
      // updates propagate to clients.
      cacheControl = 'no-cache, no-store, must-revalidate';
    }

    // gzip compress text-ish payloads on the fly when the client asks for it.
    const acceptEncoding = (req.headers['accept-encoding'] || '').toLowerCase();
    const wantsGzip = acceptEncoding.indexOf('gzip') !== -1 && isCompressible(ext);
    if (wantsGzip) {
      const gz = zlib.gzipSync(data, { level: 6 });
      return send(res, 200, gz, MIME[ext] || 'application/octet-stream', {
        'Cache-Control': cacheControl,
        'Content-Encoding': 'gzip',
        'Vary': 'Accept-Encoding',
      });
    }

    send(res, 200, data, MIME[ext] || 'application/octet-stream', {
      'Cache-Control': cacheControl,
    });
  } catch (e) {
    send(res, 500, 'Internal Server Error: ' + e.message);
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log(`[frontend] SpotiBase web UI serving ${ROOT} on http://localhost:${PORT}`);
});