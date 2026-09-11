/**
 * Auth errors that Supabase puts on the confirmation / recovery redirect URL
 * (`error`, `error_code`, `error_description` in the query or hash). Pure parsing
 * so password-reset and email-change can reuse it without loading supabase-js.
 */
export class AuthUrlError {
  constructor(
    /** Supabase `error_code` (e.g. `otp_expired`), falling back to `error`. */
    readonly code: string | undefined,
    /** URL-decoded `error_description`, if present. */
    readonly message: string | undefined,
  ) {}
}

/**
 * Reads `error` / `error_code` / `error_description` from a URL's query and
 * fragment. Query values win when both are present, matching supabase-js.
 * Returns null when none of those params appear.
 */
export function parseAuthUrlError(href: string): AuthUrlError | null {
  const params = paramsFromHref(href);
  const error = emptyToUndefined(params.error);
  const errorCode = emptyToUndefined(params.error_code);
  const errorDescription = emptyToUndefined(params.error_description);
  if (error === undefined && errorCode === undefined && errorDescription === undefined) {
    return null;
  }
  return new AuthUrlError(errorCode ?? error, errorDescription);
}

/**
 * Reads the Supabase `type` param from a redirect URL (`recovery`, `signup`,
 * `email_change`, …). Used to detect a password-recovery session on web.
 */
export function parseAuthUrlType(href: string): string | undefined {
  return emptyToUndefined(paramsFromHref(href).type);
}

function paramsFromHref(href: string): Record<string, string> {
  try {
    const url = new URL(href);
    const params: Record<string, string> = {};
    // Hash first so search params overwrite it (query takes precedence).
    if (url.hash.length > 1) {
      new URLSearchParams(url.hash.slice(1)).forEach((value, key) => {
        params[key] = value;
      });
    }
    url.searchParams.forEach((value, key) => {
      params[key] = value;
    });
    return params;
  } catch {
    return {};
  }
}

function emptyToUndefined(value: string | undefined): string | undefined {
  return value?.trim() ? value : undefined;
}
