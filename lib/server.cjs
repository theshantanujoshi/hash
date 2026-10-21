'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

const publicDir = path.join(__dirname, '..', 'public');
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']]
]);

function validDestination(value) {
  if (typeof value !== 'string' || value.length > 4096) return null;
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

function createShortener({ dataFile = path.resolve('hash-links.json'), baseUrl } = {}) {
  if (typeof baseUrl !== 'string') throw new Error('baseUrl is required.');
  const parsedBase = new URL(baseUrl);
  if (!['http:', 'https:'].includes(parsedBase.protocol) || parsedBase.username || parsedBase.password || parsedBase.search || parsedBase.hash || parsedBase.pathname !== '/') {
    throw new Error('baseUrl must be an HTTP(S) origin without a path, query, or fragment.');
  }
  const origin = parsedBase.origin;
  const file = path.resolve(dataFile);
  const links = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  if (links === null || typeof links !== 'object' || Array.isArray(links)) throw new Error('Invalid links data file.');

  function save() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(temp, JSON.stringify(links), { flag: 'wx', mode: 0o600 });
      fs.renameSync(temp, file);
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
  }

  return http.createServer((request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    const pathname = new URL(request.url, origin).pathname;
    function json(status, body) {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(body));
    }
    if (request.method === 'POST' && pathname === '/api/links') {
      let body = '';
      let tooLarge = false;
      request.setEncoding('utf8');
      request.on('data', chunk => {
        if (tooLarge) return;
        body += chunk;
        if (body.length > 8192) {
          tooLarge = true;
          response.setHeader('Connection', 'close');
          json(413, { error: 'Request too large.' });
        }
      });
      request.on('end', () => {
        if (tooLarge) return;
        let input;
        try { input = JSON.parse(body); } catch { return json(400, { error: 'Invalid JSON.' }); }
        const destination = validDestination(input?.url);
        if (!destination) return json(400, { error: 'Enter a valid HTTP or HTTPS URL without credentials.' });
        let id;
        do { id = randomBytes(5).toString('base64url'); } while (Object.hasOwn(links, id));
        links[id] = destination;
        try { save(); } catch (error) {
          delete links[id];
          console.error('Could not save link:', error);
          return json(500, { error: 'Could not save link.' });
        }
        json(201, { id, url: destination, shortUrl: `${origin}/${id}` });
      });
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return json(405, { error: 'Method not allowed.' });
    if (pathname === '/lz-string.min.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      if (request.method === 'HEAD') return response.end();
      return fs.createReadStream(require.resolve('lz-string/libs/lz-string.min.js')).pipe(response);
    }
    if (assets.has(pathname)) {
      const [name, type] = assets.get(pathname);
      response.writeHead(200, { 'Content-Type': type });
      if (request.method === 'HEAD') return response.end();
      return fs.createReadStream(path.join(publicDir, name)).pipe(response);
    }
    const id = pathname.slice(1);
    if (/^[A-Za-z0-9_-]{7}$/.test(id) && Object.hasOwn(links, id)) {
      response.writeHead(302, { Location: links[id], 'Cache-Control': 'no-store' });
      return response.end();
    }
    json(404, { error: 'Link not found.' });
  });
}

module.exports = { createShortener };
