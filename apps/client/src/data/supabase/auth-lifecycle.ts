/**
 * Keeps Supabase's token auto-refresh aligned with app foreground/background state.
 *
 * Metro resolves `./auth-lifecycle` to `auth-lifecycle.native.ts` (AppState) or
 * `auth-lifecycle.web.ts` (no-op: supabase-js already listens to `visibilitychange`).
 * This file exists so TypeScript has a single declaration to type-check against; it must
 * never be bundled.
 */
export interface AutoRefreshControls {
  startAutoRefresh(): Promise<void>;
  stopAutoRefresh(): Promise<void>;
}

export type RegisterAuthLifecycle = (auth: AutoRefreshControls) => () => void;

export const registerAuthLifecycle: RegisterAuthLifecycle = () => {
  throw new Error(
    'registerAuthLifecycle was resolved without a platform suffix; expected .native.ts or .web.ts',
  );
};
