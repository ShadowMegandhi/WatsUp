/**
 * A Result type, so failure is a value rather than a thrown exception.
 *
 * The sync engine must never let one course's failure abort the run, and a
 * thrown error is far too easy to let escape a boundary by accident. Making
 * failure part of the return type means the compiler asks "what about the error
 * case?" at every call site.
 */

export type Result<T, E> = Ok<T> | Err<E>;

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

export const isOk = <T, E>(r: Result<T, E>): r is Ok<T> => r.ok;
export const isErr = <T, E>(r: Result<T, E>): r is Err<E> => !r.ok;

export const mapOk = <T, U, E>(
  r: Result<T, E>,
  f: (value: T) => U,
): Result<U, E> => (r.ok ? ok(f(r.value)) : r);

export const mapErr = <T, E, F>(
  r: Result<T, E>,
  f: (error: E) => F,
): Result<T, F> => (r.ok ? r : err(f(r.error)));

export const unwrapOr = <T, E>(r: Result<T, E>, fallback: T): T =>
  r.ok ? r.value : fallback;

/** Splits a batch of results into successes and failures, losing neither. */
export const partition = <T, E>(
  results: readonly Result<T, E>[],
): { readonly values: readonly T[]; readonly errors: readonly E[] } => ({
  values: results.filter(isOk).map((r) => r.value),
  errors: results.filter(isErr).map((r) => r.error),
});

/** Wraps a throwing async call, converting an exception into an Err. */
export const tryCatch = async <T, E>(
  fn: () => Promise<T>,
  onThrow: (cause: unknown) => E,
): Promise<Result<T, E>> => {
  try {
    return ok(await fn());
  } catch (cause) {
    return err(onThrow(cause));
  }
};
