import { describe, expect, it } from 'vitest';
import {
  filterProjectsByQuery,
  inboxMatchesQuery,
  isProjectSelectionValid,
  projectPickerChoices,
} from './project-picker';

const projects = [
  {
    id: 'p1',
    name: 'Work',
    color: 'charcoal' as const,
    isArchived: false,
    isFavorite: false,
    sortOrder: 0,
    createdAt: '',
    updatedAt: '',
    activeTaskCount: 0,
    totalTaskCount: 0,
  },
  {
    id: 'p2',
    name: 'Home',
    color: 'blue' as const,
    isArchived: false,
    isFavorite: true,
    sortOrder: 1,
    createdAt: '',
    updatedAt: '',
    activeTaskCount: 1,
    totalTaskCount: 1,
  },
  {
    id: 'p3',
    name: 'Old',
    color: 'red' as const,
    isArchived: true,
    isFavorite: true,
    sortOrder: 2,
    createdAt: '',
    updatedAt: '',
    activeTaskCount: 0,
    totalTaskCount: 2,
  },
];

describe('project picker choices', () => {
  it('offers active projects and Inbox search, not other archived rows', () => {
    expect(inboxMatchesQuery('')).toBe(true);
    expect(inboxMatchesQuery('in')).toBe(true);
    expect(inboxMatchesQuery('work')).toBe(false);
    expect(projectPickerChoices(projects, null, '').map((item) => item.id)).toEqual(['p1', 'p2']);
    expect(projectPickerChoices(projects, 'p1', 'wo').map((item) => item.name)).toEqual(['Work']);
  });

  it('keeps a selected archived project annotated so an unrelated edit can still save', () => {
    expect(projectPickerChoices(projects, 'p3', '')).toEqual([
      expect.objectContaining({ id: 'p1', archived: false }),
      expect.objectContaining({ id: 'p2', archived: false }),
      expect.objectContaining({ id: 'p3', name: 'Old', archived: true }),
    ]);
  });

  it('filters case-insensitively', () => {
    expect(filterProjectsByQuery(projects, 'HO').map((project) => project.name)).toEqual(['Home']);
  });

  it('blocks submit until the catalog is ready and the selection still exists', () => {
    expect(isProjectSelectionValid(null, projects, false)).toBe(false);
    expect(isProjectSelectionValid(null, projects, true)).toBe(true);
    expect(isProjectSelectionValid('p3', projects, true)).toBe(true);
    expect(isProjectSelectionValid('gone', projects, true)).toBe(false);
  });
});
