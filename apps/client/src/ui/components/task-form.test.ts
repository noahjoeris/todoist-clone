import { describe, expect, it } from 'vitest';
import { isTaskSubmitDisabled } from './task-form';

describe('task form submit gating', () => {
  const ready = { busy: false, missing: false, title: 'Buy milk', creatingLabel: false };

  it('allows save when the draft has a title and nothing is pending', () => {
    expect(isTaskSubmitDisabled(ready)).toBe(false);
  });

  it('blocks save until inline label create and selection finish', () => {
    expect(isTaskSubmitDisabled({ ...ready, creatingLabel: true })).toBe(true);
  });

  it('still blocks save while busy, missing, or untitled', () => {
    expect(isTaskSubmitDisabled({ ...ready, busy: true })).toBe(true);
    expect(isTaskSubmitDisabled({ ...ready, missing: true })).toBe(true);
    expect(isTaskSubmitDisabled({ ...ready, title: '  ' })).toBe(true);
  });

  it('blocks save while the project catalog is loading or the selection is gone', () => {
    expect(isTaskSubmitDisabled({ ...ready, projectsReady: false })).toBe(true);
    expect(isTaskSubmitDisabled({ ...ready, projectSelectionInvalid: true })).toBe(true);
    expect(isTaskSubmitDisabled({ ...ready, projectsReady: true })).toBe(false);
  });
});
