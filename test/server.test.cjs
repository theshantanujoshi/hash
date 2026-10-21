'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const vm = require('node:vm');
const LZString = require('lz-string');
const { createShortener } = require('../lib/server.cjs');
const execFileAsync = promisify(execFile);

test('creates a short link, redirects, and survives restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hash-test-'));
  const dataFile = path.join(dir, 'links.json');
  let server;
  try {
    server = createShortener({ dataFile, baseUrl: 'https://links.example' });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const local = `http://127.0.0.1:${server.address().port}`;
    const destination = 'https://example.com/long/path?campaign=one&source=two';
    const created = await fetch(`${local}/api/links`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: destination }) });
    assert.equal(created.status, 201);
    const link = await created.json();
    assert.match(link.id, /^[A-Za-z0-9_-]{7}$/);
    assert.equal(link.shortUrl, `https://links.example/${link.id}`);
    const redirect = await fetch(`${local}/${link.id}`, { redirect: 'manual' });
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get('location'), destination);
    assert.equal(redirect.headers.get('referrer-policy'), 'no-referrer');
    await new Promise(resolve => server.close(resolve));
    server = createShortener({ dataFile, baseUrl: 'https://links.example' });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const afterRestart = await fetch(`http://127.0.0.1:${server.address().port}/${link.id}`, { redirect: 'manual' });
    assert.equal(afterRestart.headers.get('location'), destination);
  } finally {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects invalid destinations and has no web UI', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hash-test-'));
  const server = createShortener({ dataFile: path.join(dir, 'links.json'), baseUrl: 'http://localhost:3000' });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const local = `http://127.0.0.1:${server.address().port}`;
    for (const url of ['javascript:alert(1)', 'file:///secret', 'https://user:pass@example.com', 'not a url']) {
      const response = await fetch(`${local}/api/links`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
      assert.equal(response.status, 400, url);
    }
    const huge = await fetch(`${local}/api/links`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'https://example.com/' + 'x'.repeat(9000) }) });
    assert.equal(huge.status, 413);
    assert.equal((await fetch(local)).status, 404);
    assert.equal((await fetch(`${local}/lz-string.min.js`)).status, 404);
    assert.equal((await fetch(`${local}/missing`)).status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI creates a link through the running server', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hash-test-'));
  const server = createShortener({ dataFile: path.join(dir, 'links.json'), baseUrl: 'https://links.example' });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const local = `http://127.0.0.1:${server.address().port}`;
    const { stdout } = await execFileAsync(process.execPath, [path.join(__dirname, '..', 'bin', 'hash-links.cjs'), 'create', 'https://example.com/long/path', '--server', local]);
    const short = stdout.trim();
    assert.match(short, /^https:\/\/links\.example\/[A-Za-z0-9_-]{7}$/);
    const redirect = await fetch(`${local}/${short.split('/').at(-1)}`, { redirect: 'manual' });
    assert.equal(redirect.headers.get('location'), 'https://example.com/long/path');
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the GitHub Pages entry point redirects legacy fragment links', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const inlineScript = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
  const target = 'https://example.com/old/long/link';
  let redirected;
  vm.runInNewContext(inlineScript, {
    LZString,
    URL,
    location: {
      hash: `#${LZString.compressToEncodedURIComponent(target)}`,
      replace(url) { redirected = url; }
    },
    document: { getElementById() { throw new Error('Unexpected error state'); } }
  });
  assert.equal(redirected, target);
});
