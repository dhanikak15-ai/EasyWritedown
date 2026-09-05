const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const pageHandler = require('./api/page');
const uploadRequestHandler = require('./api/upload-request');
const sitemapHandler = require('./api/sitemap');
const robotsHandler = require('./api/robots');

const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function enhanceRes(res) {
  res.status = function (code) {
    res.statusCode = code;
    return res;
  };
  res.json = function (data) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
    return res;
  };
  return res;
}

const server = http.createServer((req, res) => {
  enhanceRes(res);
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // Route API requests
  if (pathname === '/api/page' || pathname === '/api/page/') {
    req.query = parsedUrl.query;
    return pageHandler(req, res);
  }

  if (pathname === '/api/upload-request' || pathname === '/api/upload-request/') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      req.body = body;
      return uploadRequestHandler(req, res);
    });
    return;
  }

  if (pathname === '/sitemap.xml') {
    return sitemapHandler(req, res);
  }

  if (pathname === '/robots.txt') {
    return robotsHandler(req, res);
  }

  // Serve static files
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);

  fs.stat(filePath, (err, stats) => {
    if (!err && stats.isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      fs.createReadStream(filePath).pipe(res);
    } else {
      // SPA Rewrite: serve index.html for any direct page path like /class, /notes, etc.
      const indexPath = path.join(__dirname, 'index.html');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(indexPath).pipe(res);
    }
  });
});

server.listen(PORT, () => {
  console.log(`DONTCBOARD server running at http://localhost:${PORT}`);
});
