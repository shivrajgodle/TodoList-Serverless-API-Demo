/**
 * Carries an HTTP status code alongside a client-safe message.
 *
 * WHY: keeps error handling to one catch block in the handler instead of
 * scattering status-code-mapping logic through every operation. The
 * message here is always safe to return to the caller - never DynamoDB
 * internals, stack traces, etc. Unexpected (non-ApiError) exceptions are
 * handled separately in the handler and always collapse to a generic 500.
 */
export class ApiError extends Error {
  public readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'ApiError';
  }

  static badRequest(message: string): ApiError {
    return new ApiError(400, message);
  }

  static notFound(message: string): ApiError {
    return new ApiError(404, message);
  }
}
