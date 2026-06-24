export class AppError extends Error {
  constructor(message, { statusCode = 500, code = 'INTERNAL_ERROR', details } = {}) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function isAppError(error) {
  return error instanceof AppError;
}

export function toErrorResponse(error) {
  if (isAppError(error)) {
    return {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {})
      }
    };
  }

  return {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.'
    }
  };
}

export function getErrorStatusCode(error) {
  return isAppError(error) ? error.statusCode : 500;
}

export function cleanShopifyErrors(errors = []) {
  return errors.map((error) => ({
    message: error.message,
    ...(error.path ? { path: error.path } : {}),
    ...(error.extensions?.code ? { code: error.extensions.code } : {})
  }));
}

export function cleanUserErrors(userErrors = []) {
  return userErrors.map((error) => ({
    field: error.field ?? [],
    message: error.message
  }));
}
