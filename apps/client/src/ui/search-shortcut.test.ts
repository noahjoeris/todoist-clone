import { describe, expect, it } from 'vitest';
import { isEditableKeyboardTarget, shouldIgnoreSearchShortcut } from './search-shortcut';

function event(overrides: Partial<Parameters<typeof shouldIgnoreSearchShortcut>[0]> = {}) {
  return {
    key: '/',
    repeat: false,
    isComposing: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    defaultPrevented: false,
    target: null,
    ...overrides,
  };
}

describe('search shortcut guards', () => {
  it('accepts a plain / key outside of fields', () => {
    expect(shouldIgnoreSearchShortcut(event())).toBe(false);
  });

  it('ignores repeats, IME composition, modifiers, and other keys', () => {
    expect(shouldIgnoreSearchShortcut(event({ repeat: true }))).toBe(true);
    expect(shouldIgnoreSearchShortcut(event({ isComposing: true }))).toBe(true);
    expect(shouldIgnoreSearchShortcut(event({ keyCode: 229 }))).toBe(true);
    expect(shouldIgnoreSearchShortcut(event({ metaKey: true }))).toBe(true);
    expect(shouldIgnoreSearchShortcut(event({ ctrlKey: true }))).toBe(true);
    expect(shouldIgnoreSearchShortcut(event({ altKey: true }))).toBe(true);
    expect(shouldIgnoreSearchShortcut(event({ key: '?' }))).toBe(true);
    expect(shouldIgnoreSearchShortcut(event({ defaultPrevented: true }))).toBe(true);
  });

  it('ignores editable targets including contenteditable', () => {
    expect(isEditableKeyboardTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isEditableKeyboardTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isEditableKeyboardTarget({ tagName: 'SELECT' })).toBe(true);
    expect(isEditableKeyboardTarget({ isContentEditable: true })).toBe(true);
    expect(
      isEditableKeyboardTarget({
        getAttribute: (name: string) => (name === 'contenteditable' ? 'true' : null),
      }),
    ).toBe(true);
    expect(
      isEditableKeyboardTarget({
        getAttribute: (name: string) => (name === 'role' ? 'textbox' : null),
      }),
    ).toBe(true);
    expect(shouldIgnoreSearchShortcut(event({ target: { tagName: 'INPUT' } }))).toBe(true);
    expect(shouldIgnoreSearchShortcut(event({ target: { tagName: 'DIV' } }))).toBe(false);
  });
});
