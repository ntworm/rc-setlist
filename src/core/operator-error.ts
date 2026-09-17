/**
 * An error whose message is written for the operator and safe to show them.
 *
 * The command bus forwards only these (and ProfileError, whose messages are
 * fixed strings) in `command_status`; anything else — a filesystem error with
 * a path in it, a bug — reaches the client as the bare `execution_failed`.
 */
export class OperatorError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'OperatorError';
  }
}
