export const SEARCH_SHORTCUT_KEY = '/';

type ShortcutEvent = {
  key: string;
  repeat: boolean;
  isComposing?: boolean;
  keyCode?: number;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  defaultPrevented?: boolean;
  target: unknown;
};

export function isEditableKeyboardTarget(target: unknown): boolean {
  if (target == null || typeof target !== 'object') return false;
  const element = target as {
    tagName?: string;
    isContentEditable?: boolean;
    getAttribute?: (name: string) => string | null;
  };
  const tag = element.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (element.isContentEditable === true) return true;
  if (element.getAttribute?.('contenteditable') === 'true') return true;
  if (element.getAttribute?.('role') === 'textbox') return true;
  return false;
}

/**
 * `/` opens Search from the task shell. Ignore it in fields, IME, repeats,
 * and with modifier keys. Callers still skip when another modal is open.
 */
export function shouldIgnoreSearchShortcut(event: ShortcutEvent): boolean {
  if (event.defaultPrevented) return true;
  if (event.key !== SEARCH_SHORTCUT_KEY) return true;
  if (event.repeat) return true;
  if (event.isComposing === true || event.keyCode === 229) return true;
  if (event.metaKey || event.ctrlKey || event.altKey) return true;
  return isEditableKeyboardTarget(event.target);
}
