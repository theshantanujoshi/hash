#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { createShortener } = require('../lib/server.cjs');

function usage() {
  console.log(`Usage:
  hash-links serve [--port 3000] [--host 127.0.0.1] [--data ./hash-links.json] [--base-url URL]
  hash-links create <url> [--server http://127.0.0.1:3000]`);
}

function parseFlags(args, allowed) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (!allowed.includes(args[i]) || !args[i + 1]) throw new Error(`Invalid option: ${args[i]}`);
    flags[args[i].slice(2)] = args[++i];
  }
  return flags;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === '--help' || command === undefined) return usage();
  if (command === 'create') {
    if (!rest[0] || rest[0].startsWith('--')) throw new Error('A destination URL is required.');
    const flags = parseFlags(rest.slice(1), ['--server']);
    const serverUrl = new URL(flags.server || 'http://127.0.0.1:3000');
    const endpoint = new URL('/api/links', serverUrl);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: rest[0] })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Server returned ${response.status}.`);
    console.log(data.shortUrl);
    return;
  }
  if (command !== 'serve') throw new Error(`Unknown command: ${command}`);
  const flags = parseFlags(rest, ['--port', '--host', '--data', '--base-url']);
  const port = flags.port === undefined ? 3000 : Number(flags.port);
  const host = flags.host || '127.0.0.1';
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be an integer from 1 to 65535.');
  if (!flags['base-url'] && (host === '0.0.0.0' || host === '::')) throw new Error('--base-url is required when listening on all interfaces.');
  const baseUrl = flags['base-url'] || `http://${host.includes(':') ? `[${host}]` : host}:${port}`;
  const server = createShortener({ dataFile: path.resolve(flags.data || 'hash-links.json'), baseUrl });
  server.listen(port, host, () => console.log(`hash-links listening at ${baseUrl}`));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
