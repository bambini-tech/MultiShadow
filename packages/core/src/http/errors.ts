/**
 * Error taxonomy for HTTP / API calls.
 *
 * The retry layer distinguishes *transient* failures (network blips, 429, 5xx),
 * which are safe to retry, from *business* failures (4xx: bad request, invalid
 * route, amount below minimum), which are not — retrying them just wastes time
 * and rate-limit budget.
 */

export class HttpError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }

  /** 5xx and 429 are considered transient / retryable. */
  get isTransient(): boolean {
    return this.status === 429 || (this.status >= 500 && this.status <= 599);
  }
}

/** A network-level failure (DNS, connection reset, timeout). Always transient. */
export class NetworkError extends Error {
  // `cause` exists on Error in ES2022; we narrow/attach it explicitly.
  override readonly cause: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

/** Decide whether an arbitrary thrown value is worth retrying. */
export function isRetryable(err: unknown): boolean {
  if (err instanceof NetworkError) return true;
  if (err instanceof HttpError) return err.isTransient;
  return false;
}
