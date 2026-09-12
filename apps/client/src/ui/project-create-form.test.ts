import { describe, expect, it } from 'vitest';
import { projectsTabForCreate } from './project-create-form';

describe('projectsTabForCreate', () => {
  it('forces Active while the create form is open', () => {
    expect(projectsTabForCreate(true, 'archived')).toBe('active');
    expect(projectsTabForCreate(true, 'active')).toBe('active');
  });

  it('keeps the selected tab when not adding', () => {
    expect(projectsTabForCreate(false, 'archived')).toBe('archived');
    expect(projectsTabForCreate(false, 'active')).toBe('active');
  });
});
