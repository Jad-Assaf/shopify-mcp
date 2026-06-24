import crypto from 'node:crypto';
import { getProtectedResourceMetadataUrl, verifyOAuthAccessToken } from '../oauth.js';
import { AppError } from './errors.js';

function parseAllowedOrigins() {
  return (process.env.MCP_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function timingSafeEqualText(a, b) {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);

  if (aBuffer.length !== bBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

export function requireAuth(req, _res, next) {
  try {
    const configuredKey = process.env.MCP_API_KEY;
    if (!configuredKey) {
      throw new AppError('MCP_API_KEY is not configured.', {
        statusCode: 500,
        code: 'MCP_API_KEY_MISSING'
      });
    }

    const header = req.get('authorization') ?? '';
    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token) {
      throw new AppError('Unauthorized MCP request.', {
        statusCode: 401,
        code: 'UNAUTHORIZED'
      });
    }

    if (timingSafeEqualText(token, configuredKey)) {
      validateOrigin(req);
      next();
      return;
    }

    verifyOAuthAccessToken(token, req);
    validateOrigin(req);
    next();
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 401) {
      error.details = {
        wwwAuthenticate: `Bearer resource_metadata="${getProtectedResourceMetadataUrl(req)}", scope="shopify.read shopify.write"`
      };
    }
    next(error);
  }
}

export function validateOrigin(req) {
  const origin = req.get('origin');
  if (!origin) {
    return;
  }

  let originUrl;
  try {
    originUrl = new URL(origin);
  } catch {
    throw new AppError('Invalid Origin header.', {
      statusCode: 403,
      code: 'INVALID_ORIGIN'
    });
  }

  const allowedOrigins = parseAllowedOrigins();
  const requestHost = req.get('x-forwarded-host') ?? req.get('host');
  const requestProtocol = req.get('x-forwarded-proto') ?? req.protocol;
  const sameOrigin = requestHost && originUrl.origin === `${requestProtocol}://${requestHost}`;

  if (sameOrigin || allowedOrigins.includes(originUrl.origin)) {
    return;
  }

  throw new AppError('Origin is not allowed for MCP requests.', {
    statusCode: 403,
    code: 'ORIGIN_NOT_ALLOWED'
  });
}
