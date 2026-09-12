import { describe, expect, it } from 'vitest';
import {
  favoriteProjects,
  foldProjectName,
  ProjectDuplicateNameError,
  projectInputSchema,
  projectNamesEqual,
  readSqliteFlag,
  sortProjectsByOrder,
  spliceActiveOrder,
} from './project';

describe('project input', () => {
  it('trims the name and defaults color and favorite', () => {
    expect(projectInputSchema.parse({ name: '  Work  ' })).toEqual({
      name: 'Work',
      color: 'charcoal',
      isFavorite: false,
    });
  });

  it('accepts a palette color and favorite flag', () => {
    expect(
      projectInputSchema.parse({ name: 'Home', color: 'berry_red', isFavorite: true }),
    ).toEqual({
      name: 'Home',
      color: 'berry_red',
      isFavorite: true,
    });
  });

  it.each(['', '  ', '\n'])('rejects an empty name %j', (name) => {
    expect(projectInputSchema.safeParse({ name }).success).toBe(false);
  });

  it('rejects names longer than 60 characters', () => {
    expect(projectInputSchema.safeParse({ name: 'a'.repeat(61) }).success).toBe(false);
    expect(projectInputSchema.parse({ name: 'a'.repeat(60) }).name).toHaveLength(60);
  });

  it('rejects unknown colors', () => {
    expect(projectInputSchema.safeParse({ name: 'Work', color: 'neon' }).success).toBe(false);
  });
});

describe('project display conversion', () => {
  it('reads SQLite 0/1 flags without coercing other values', () => {
    expect(readSqliteFlag(0)).toBe(false);
    expect(readSqliteFlag(1)).toBe(true);
    expect(readSqliteFlag(true)).toBe(true);
    expect(readSqliteFlag(false)).toBe(false);
    expect(readSqliteFlag(2)).toBe(false);
    expect(readSqliteFlag('yes')).toBe(false);
  });

  it('sorts by sort order then id', () => {
    expect(
      sortProjectsByOrder([
        { id: 'b', sortOrder: 1 },
        { id: 'a', sortOrder: 1 },
        { id: 'c', sortOrder: 0 },
      ]).map((project) => project.id),
    ).toEqual(['c', 'a', 'b']);
  });

  it('exposes a field error for duplicate names', () => {
    const error = new ProjectDuplicateNameError();
    expect(error.code).toBe('duplicate-name');
    expect(error.message).toBe('A project with this name already exists');
  });

  it('compares names with a unicode-aware case fold', () => {
    expect(foldProjectName('  École  ')).toBe('école');
    expect(projectNamesEqual('École', 'école')).toBe(true);
    expect(projectNamesEqual('École', 'ecole')).toBe(false);
    expect(projectNamesEqual('Work', ' work ')).toBe(true);
  });

  it('hides archived favorites from the sidebar list', () => {
    expect(
      favoriteProjects([
        { id: 'a', isFavorite: true, isArchived: false },
        { id: 'b', isFavorite: true, isArchived: true },
        { id: 'c', isFavorite: false, isArchived: false },
      ]).map((project) => project.id),
    ).toEqual(['a']);
  });

  it('replaces only active slots when splicing a reorder', () => {
    const canonical = [
      { id: 'A', isArchived: false },
      { id: 'B', isArchived: true },
      { id: 'C', isArchived: false },
      { id: 'D', isArchived: false },
    ];
    expect(spliceActiveOrder(canonical, ['D', 'A', 'C']).map((project) => project.id)).toEqual([
      'D',
      'B',
      'A',
      'C',
    ]);
  });
});
