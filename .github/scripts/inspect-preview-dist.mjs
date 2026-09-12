#!/usr/bin/env node
/**
 * Confirm the Expo web export is safe to upload to Cloudflare Pages:
 * required files exist, SPA fallback is not disabled by a top-level 404.html,
 * and no file exceeds the Pages 25 MiB limit.
 */

import { readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

const DIST = 'apps/client/dist';
const MAX_BYTES = 25 * 1024 * 1024;
const REQUIRED = ['index.html', '@powersync/worker.js'];

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function isFile(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

const missing = [];
for (const rel of REQUIRED) {
  if (!(await isFile(path.join(DIST, rel)))) missing.push(rel);
}
if (missing.length > 0) {
  fail(`Preview export is missing required files in ${DIST}: ${missing.join(', ')}`);
}

const notFoundPage = path.join(DIST, '404.html');
if (await isFile(notFoundPage)) {
  await unlink(notFoundPage);
  process.stdout.write(
    'Removed top-level 404.html so Cloudflare Pages SPA fallback stays enabled.\n',
  );
}

const oversized = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(entryPath);
      continue;
    }
    if (!entry.isFile()) continue;
    const size = (await stat(entryPath)).size;
    if (size > MAX_BYTES) {
      oversized.push(`${entryPath} (${size} bytes)`);
    }
  }
}

try {
  await walk(DIST);
} catch (error) {
  fail(`Could not read ${DIST}: ${error instanceof Error ? error.message : error}`);
}

if (oversized.length > 0) {
  fail(`Files exceed the Cloudflare Pages 25 MiB limit:\n${oversized.join('\n')}`);
}

process.stdout.write(`Preview export at ${DIST} is ready to upload.\n`);
