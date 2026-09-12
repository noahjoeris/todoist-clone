#!/usr/bin/env node
/**
 * Fail a preview deploy before upload when public client configuration is
 * missing or unsuitable for a browser on the public internet.
 *
 * Values are read from the environment and never printed.
 */

const URL_VARS = ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_POWERSYNC_URL', 'EXPO_PUBLIC_API_URL'];
const KEY_VAR = 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY';

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function read(name) {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

function isUnsuitableHost(hostname) {
  const host = hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '0.0.0.0' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local')
  ) {
    return true;
  }

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ipv4) return false;
  const octets = ipv4.slice(1).map(Number);
  if (octets.some((n) => n > 255)) return true;
  const [a, b] = octets;
  return (
    a === 10 ||
    a === 127 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 169 && b === 254)
  );
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

for (const name of URL_VARS) {
  assertHttpsPublic(name);
}

if (!read(KEY_VAR)) {
  fail(`${KEY_VAR} is missing. Set it on the GitHub Actions environment "preview".`);
}

process.stdout.write('Preview client configuration is public HTTPS.\n');
