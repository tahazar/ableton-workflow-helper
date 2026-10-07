/**
 * An error response from the gateway. `code` is the body's `error` field
 * (`not_found`, `bad_request`, `unavailable`, `internal`, or `unknown_op`),
 * so callers can tell "nothing at that path" apart from a failed call
 * without matching on message text.
 */
export class GatewayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}
