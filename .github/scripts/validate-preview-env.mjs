#!/usr/bin/env node
/**
 * Fail a preview deploy before upload when public client configuration is
 * missing or unsuitable for a browser on the public internet.
 *
 * Values are read from the environment and never printed.
 */

import { BlockList, isIPv4, isIPv6 } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const URL_VARS = ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_POWERSYNC_URL', 'EXPO_PUBLIC_API_URL'];
const KEY_VAR = 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY';

const PRIVATE_RANGES = new BlockList();
PRIVATE_RANGES.addAddress('0.0.0.0', 'ipv4');
PRIVATE_RANGES.addSubnet('10.0.0.0', 8, 'ipv4');
PRIVATE_RANGES.addSubnet('127.0.0.0', 8, 'ipv4');
PRIVATE_RANGES.addSubnet('169.254.0.0', 16, 'ipv4');
PRIVATE_RANGES.addSubnet('172.16.0.0', 12, 'ipv4');
PRIVATE_RANGES.addSubnet('192.168.0.0', 16, 'ipv4');
PRIVATE_RANGES.addAddress('::', 'ipv6');
PRIVATE_RANGES.addAddress('::1', 'ipv6');
PRIVATE_RANGES.addSubnet('fc00::', 7, 'ipv6');
PRIVATE_RANGES.addSubnet('fe80::', 10, 'ipv6');
// IPv4-mapped IPv6 (::ffff:0:0/96) of the same IPv4 ranges. Prefix = 96 + IPv4 prefix.
PRIVATE_RANGES.addAddress('::ffff:0.0.0.0', 'ipv6');
PRIVATE_RANGES.addSubnet('::ffff:10.0.0.0', 104, 'ipv6');
PRIVATE_RANGES.addSubnet('::ffff:127.0.0.0', 104, 'ipv6');
PRIVATE_RANGES.addSubnet('::ffff:169.254.0.0', 112, 'ipv6');
PRIVATE_RANGES.addSubnet('::ffff:172.16.0.0', 108, 'ipv6');
PRIVATE_RANGES.addSubnet('::ffff:192.168.0.0', 112, 'ipv6');

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function read(name) {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Node's URL parser keeps IPv6 brackets (`[::1]`) and a trailing DNS dot on
 * names (`localhost.`), which would otherwise miss the literal checks below.
 */
function normalizeHostname(hostname) {
  let host = hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }
  if (host.endsWith('.')) {
    host = host.replace(/\.+$/, '');
  }
  return host;
}

export function isUnsuitableHost(hostname) {
  const host = normalizeHostname(hostname);
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return true;
  }

  if (isIPv4(host)) {
    return PRIVATE_RANGES.check(host, 'ipv4');
  }

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    return true;
  }

  if (isIPv6(host)) {
    return PRIVATE_RANGES.check(host, 'ipv6');
  }

  return false;
}

function assertHttpsPublic(name) {
  const value = read(name);
  if (!value) {
    fail(
      `${name} is missing. Set it on the GitHub Actions environment "preview". Do not deploy guest-only mode.`,
    );
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${name} is not a valid URL.`);
  }

  if (url.protocol !== 'https:') {
    fail(`${name} must be an https:// URL suitable for a public preview.`);
  }

  if (isUnsuitableHost(url.hostname)) {
    fail(`${name} must not point at a local, loopback, or private host (never localhost).`);
  }
}

function main() {
  for (const name of URL_VARS) {
    assertHttpsPublic(name);
  }

  if (!read(KEY_VAR)) {
    fail(`${KEY_VAR} is missing. Set it on the GitHub Actions environment "preview".`);
  }

  process.stdout.write('Preview client configuration is public HTTPS.\n');
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(path.resolve(entry)).href) {
  main();
}
