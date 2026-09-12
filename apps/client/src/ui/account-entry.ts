/** How the guest screen offers (or explains the absence of) account sign-in. */
export type AccountEntry =
  | { kind: 'hidden' }
  | { kind: 'sign-in'; onPress: () => void }
  | { kind: 'unavailable'; message: string }
  | { kind: 'account'; label: string; onPress: () => void };
