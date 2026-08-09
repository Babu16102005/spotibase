// SpotiBase - Minimal production static file server for the web frontend bundle.
// Serves ./dist-prod (expo export --platform web) on port 3000.
// Usage: node serve-frontend.js [port]
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

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
};

function send(res, code, body, type) {
  res.writeHead(code, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
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
    const data = fs.readFileSync(filePath);
    send(res, 200, data, MIME[ext] || 'application/octet-stream');
  } catch (e) {
    send(res, 500, 'Internal Server Error: ' + e.message);
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log(`[frontend] SpotiBase web UI serving ${ROOT} on http://localhost:${PORT}`);
});