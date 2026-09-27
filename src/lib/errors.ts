/**
 * Application error taxonomy.
 *
 * Every failure that can reach a user is one of these. The `code` is a stable
 * machine-readable string the UI switches on; the message is for humans. Rule:
 * never collapse two different failures into one generic `throw new Error` —
 * that is what makes production incidents undebuggable.
 */
export abstract class WatchtowerError extends Error {
  abstract readonly code: string;
  abstract readonly status: number;
  readonly details: Readonly<Record<string, unknown>>;

  /**
   * Public so subclasses that do not declare their own constructor inherit an
   * accessible one. Direct instantiation is still impossible because the class
   * is `abstract`; `code` and `status` are abstract too, so every concrete
   * error must supply them.
   */
  constructor(message: string, details: Readonly<Record<string, unknown>> = {}) {
    super(message);
    this.name = this.constructor.name;
    this.details = details;
  }

  /** Structured, log-safe projection. Deliberately excludes the message when
   * it could embed a credential. */
  toLogFields(): Record<string, unknown> {
    return { error: this.code, name: this.name, ...this.details };
  }
}

export class ValidationError extends WatchtowerError {
  readonly code = "VALIDATION_FAILED";
  readonly status = 400;
}

export class AuthenticationError extends WatchtowerError {
  readonly code = "AUTHENTICATION_FAILED";
  readonly status = 401;
}

export class AuthorizationError extends WatchtowerError {
  readonly code = "NOT_AUTHORIZED";
  readonly status = 403;
}

export class NotFoundError extends WatchtowerError {
  readonly code = "NOT_FOUND";
  readonly status = 404;
}

export class ConflictError extends WatchtowerError {
  readonly code = "CONFLICT";
  readonly status = 409;
}

export class RateLimitError extends WatchtowerError {
  readonly code = "RATE_LIMITED";
  readonly status = 429;
}

/**
 * A third-party dependency (Africa's Talking, Cloudinary, Mapbox, the push
 * service) failed. Carries enough context to retry or escalate without needing
 * the original provider response re-fetched.
 */
export class UpstreamError extends WatchtowerError {
  readonly code = "UPSTREAM_FAILED";
  readonly status = 502;

  /**
   * Public because this is a concrete class, unlike the abstract base: callers
   * outside the class body construct it directly, and `from` exists only to
   * additionally capture an underlying cause.
   */
  constructor(provider: string, message: string, details: Readonly<Record<string, unknown>> = {}) {
    super(`${provider}: ${message}`, { provider, ...details });
  }

  static from(provider: string, cause: unknown, details: Readonly<Record<string, unknown>> = {}): UpstreamError {
    const message = cause instanceof Error ? cause.message : String(cause);
    return new UpstreamError(provider, message, details);
  }
}

export const isWatchtowerError = (value: unknown): value is WatchtowerError =>
  value instanceof WatchtowerError;

type ErrorBody = { error: { code: string; message: string; details?: Record<string, unknown> } };

export const toErrorBody = (error: WatchtowerError): ErrorBody => ({
  error: {
    code: error.code,
    message: error.message,
    ...(Object.keys(error.details).length > 0 ? { details: error.details } : {}),
  },
});
