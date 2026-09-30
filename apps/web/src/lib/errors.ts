/** Errors that are safe to show to the person who caused them. */
export class UserError extends Error {
  constructor(message: string, readonly code: "forbidden" | "conflict" | "invalid" | "not_found" | "unavailable" | "limit" = "invalid") {
    super(message);
  }
}

interface PgLikeError {
  code?: string;
  message?: string;
}

/**
 * Map a database error to a message for the user. Our own functions raise
 * messages written for people; anything else becomes a generic message so
 * internals are not leaked.
 */
export function fromDbError(err: PgLikeError | null | undefined, fallback = "Something went wrong. Please try again."): UserError {
  const code = err?.code;
  const msg = err?.message ?? "";
  switch (code) {
    case "42501":
      return new UserError(msg && !/row-level security|permission denied for/i.test(msg) ? msg : "You do not have permission to do that.", "forbidden");
    case "40001":
      return new UserError(msg || "Someone else changed this. Reload and try again.", "conflict");
    case "22023":
    case "P0001":
      return new UserError(msg || fallback, "invalid");
    case "23505":
      return new UserError("That already exists.", "conflict");
    case "23503":
      return new UserError("A referenced record was not found.", "invalid");
    case "23514":
      return new UserError("Some values are outside the allowed range.", "invalid");
    case "PGRST116":
      return new UserError("Not found.", "not_found");
    default:
      return new UserError(fallback, "invalid");
  }
}
