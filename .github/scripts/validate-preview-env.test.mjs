import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { isUnsuitableHost } from './validate-preview-env.mjs';

const script = fileURLToPath(new URL('./validate-preview-env.mjs', import.meta.url));

const publicEnv = {
  EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  EXPO_PUBLIC_POWERSYNC_URL: 'https://example.powersync.journeyapps.com',
  EXPO_PUBLIC_API_URL: 'https://api.example.com',
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
};

function hostnameOf(href) {
  return new URL(href).hostname;
}

function run(env) {
  return spawnSync(process.execPath, [script], {
    env: { PATH: process.env.PATH ?? '', ...env },
    encoding: 'utf8',
  });
}

describe('isUnsuitableHost', () => {
  it('rejects loopback and private IPv4', () => {
    for (const host of [
      '127.0.0.1',
      '10.0.0.1',
      '192.168.1.1',
      '172.16.0.1',
      '169.254.1.1',
      '0.0.0.0',
    ]) {
      assert.equal(isUnsuitableHost(host), true, host);
    }
  });

  it('rejects localhost and .local names, including trailing DNS dots', () => {
    for (const host of [
      'localhost',
      'localhost.',
      'localhost..',
      'foo.localhost',
      'foo.localhost.',
      'service.local',
      'service.local.',
    ]) {
      assert.equal(isUnsuitableHost(host), true, host);
    }
  });

  it('rejects bracketed loopback, unique-local, and link-local IPv6', () => {
    for (const href of [
      'https://[::1]',
      'https://[::]',
      'https://[fc00::1]',
      'https://[fd12:3456:789a::1]',
      'https://[fe80::1]',
    ]) {
      assert.equal(isUnsuitableHost(hostnameOf(href)), true, href);
    }
  });

  it('rejects IPv4-mapped private and loopback addresses', () => {
    for (const href of [
      'https://[::ffff:127.0.0.1]',
      'https://[::ffff:10.0.0.1]',
      'https://[::ffff:192.168.0.1]',
      'https://[::ffff:172.16.0.1]',
      'https://[::ffff:169.254.0.1]',
    ]) {
      assert.equal(isUnsuitableHost(hostnameOf(href)), true, href);
    }
  });

  it('accepts public hostnames, including a trailing DNS dot', () => {
    for (const href of [
      'https://example.supabase.co',
      'https://example.com.',
      'https://todoist-clone.pages.dev',
      'https://8.8.8.8',
      'https://[2001:4860:4860::8888]',
      'https://[::ffff:8.8.8.8]',
    ]) {
      assert.equal(isUnsuitableHost(hostnameOf(href)), false, href);
    }
  });
});

describe('validate-preview-env.mjs', () => {
  it('accepts public HTTPS client configuration', () => {
    const result = run(publicEnv);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Preview client configuration is public HTTPS/);
  });

  it('rejects bracketed loopback, private IPv6, and trailing-dot local names', () => {
    for (const href of [
      'https://[::1]',
      'https://[fc00::1]',
      'https://localhost.',
      'https://service.local.',
    ]) {
      const result = run({ ...publicEnv, EXPO_PUBLIC_API_URL: href });
      assert.equal(result.status, 1, href);
      assert.match(
        result.stderr,
        /EXPO_PUBLIC_API_URL must not point at a local, loopback, or private host/,
        href,
      );
    }
  });

  it('rejects missing variables before upload', () => {
    const result = run({
      EXPO_PUBLIC_POWERSYNC_URL: publicEnv.EXPO_PUBLIC_POWERSYNC_URL,
      EXPO_PUBLIC_API_URL: publicEnv.EXPO_PUBLIC_API_URL,
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publicEnv.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /EXPO_PUBLIC_SUPABASE_URL is missing/);
  });
});
