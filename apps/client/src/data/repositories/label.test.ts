import { describe, expect, it } from 'vitest';
import {
  foldLabelName,
  LabelDuplicateNameError,
  labelInputSchema,
  labelNamesEqual,
  parseLabelColor,
  readSqliteFavorite,
  sortLabelsByName,
} from './label';

describe('label input', () => {
  it('trims the name and defaults color and favorite', () => {
    expect(labelInputSchema.parse({ name: '  Work  ' })).toEqual({
      name: 'Work',
      color: 'charcoal',
      isFavorite: false,
    });
  });

  it('accepts a palette color and favorite flag', () => {
    expect(labelInputSchema.parse({ name: 'Home', color: 'berry_red', isFavorite: true })).toEqual({
      name: 'Home',
      color: 'berry_red',
      isFavorite: true,
    });
  });

  it.each(['', '  ', '\n'])('rejects an empty name %j', (name) => {
    expect(labelInputSchema.safeParse({ name }).success).toBe(false);
  });

  it('rejects names longer than 60 characters', () => {
    expect(labelInputSchema.safeParse({ name: 'a'.repeat(61) }).success).toBe(false);
    expect(labelInputSchema.parse({ name: 'a'.repeat(60) }).name).toHaveLength(60);
  });

  it('rejects unknown colors', () => {
    expect(labelInputSchema.safeParse({ name: 'Work', color: 'neon' }).success).toBe(false);
  });
});

describe('label display conversion', () => {
  it('falls back unknown colors to charcoal', () => {
    expect(parseLabelColor('berry_red')).toBe('berry_red');
    expect(parseLabelColor('not-a-color')).toBe('charcoal');
  });

  it('reads SQLite 0/1 favorites without coercing other values', () => {
    expect(readSqliteFavorite(0)).toBe(false);
    expect(readSqliteFavorite(1)).toBe(true);
    expect(readSqliteFavorite(true)).toBe(true);
    expect(readSqliteFavorite(false)).toBe(false);
    expect(readSqliteFavorite(2)).toBe(false);
    expect(readSqliteFavorite('yes')).toBe(false);
  });

  it('sorts labels by name then id', () => {
    expect(
      sortLabelsByName([
        { id: 'b', name: 'Work' },
        { id: 'a', name: 'home' },
        { id: 'c', name: 'Home' },
      ]).map((label) => label.id),
    ).toEqual(['a', 'c', 'b']);
  });

  it('exposes a field error for duplicate names', () => {
    const error = new LabelDuplicateNameError();
    expect(error.code).toBe('duplicate-name');
    expect(error.message).toBe('A label with this name already exists');
  });

  it('compares names with a unicode-aware case fold', () => {
    expect(foldLabelName('  École  ')).toBe('école');
    expect(labelNamesEqual('École', 'école')).toBe(true);
    expect(labelNamesEqual('École', 'ecole')).toBe(false);
    expect(labelNamesEqual('Work', ' work ')).toBe(true);
  });
});
