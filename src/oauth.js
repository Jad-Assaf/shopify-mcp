import crypto from 'node:crypto';
import { AppError } from './utils/errors.js';

const SCOPES = ['shopify.read', 'shopify.write'];
const AUTH_CODE_TTL_SECONDS = 5 * 60;
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url');
}

function base64UrlJson(value) {
  return base64UrlEncode(JSON.stringify(value));
}

function getOAuthSecret() {
  const secret = process.env.OAUTH_TOKEN_SECRET || process.env.MCP_API_KEY;
  if (!secret) {
    throw new AppError('OAUTH_TOKEN_SECRET or MCP_API_KEY is required for OAuth.', {
      statusCode: 500,
      code: 'OAUTH_SECRET_MISSING'
    });
  }

  return secret;
}

function sign(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlJson(header);
  const encodedPayload = base64UrlJson(payload);
  const signature = crypto
    .createHmac('sha256', getOAuthSecret())
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function verifySignedToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid token format.');
    }

    const [encodedHeader, encodedPayload, signature] = parts;
    const expectedSignature = crypto
      .createHmac('sha256', getOAuthSecret())
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64url');

    if (!timingSafeEqualText(signature, expectedSignature)) {
      throw new Error('Invalid token signature.');
    }

    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      throw new AppError('OAuth token expired.', { statusCode: 401, code: 'OAUTH_TOKEN_EXPIRED' });
    }

    return payload;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError('Invalid OAuth token signature.', { statusCode: 401, code: 'INVALID_OAUTH_TOKEN' });
  }
}

function getBaseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) {
    return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  }

  const protocol = req.get('x-forwarded-proto') ?? req.protocol;
  const host = req.get('x-forwarded-host') ?? req.get('host');
  return `${protocol}://${host}`;
}

export function getProtectedResource(req) {
  return `${getBaseUrl(req)}/mcp`;
}

export function getProtectedResourceMetadataUrl(req) {
  return `${getBaseUrl(req)}/.well-known/oauth-protected-resource`;
}

function getAuthorizationServerMetadata(req) {
  const baseUrl = getBaseUrl(req);

  return {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    registration_endpoint: `${baseUrl}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: SCOPES,
    client_id_metadata_document_supported: true
  };
}

function getProtectedResourceMetadata(req) {
  const baseUrl = getBaseUrl(req);

  return {
    resource: getProtectedResource(req),
    authorization_servers: [baseUrl],
    scopes_supported: SCOPES,
    bearer_methods_supported: ['header'],
    resource_documentation: 'https://github.com/Jad-Assaf/shopify-mcp'
  };
}

function renderAuthorizeForm(params, error = '') {
  const hiddenInputs = Object.entries(params)
    .map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value ?? '')}">`)
    .join('\n');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Authorize Shopify MCP</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 2rem; max-width: 38rem; }
      label { display: block; margin: 1rem 0 0.5rem; }
      input[type="password"] { width: 100%; padding: 0.6rem; }
      button { margin-top: 1rem; padding: 0.65rem 1rem; }
      .error { color: #b00020; }
    </style>
  </head>
  <body>
    <h1>Authorize Shopify MCP</h1>
    <p>Enter the OAuth authorization password configured for this MCP server.</p>
    ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
    <form method="post" action="/oauth/authorize">
      ${hiddenInputs}
      <label for="password">Authorization password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button type="submit">Authorize</button>
    </form>
  </body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function timingSafeEqualText(a, b) {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);

  if (aBuffer.length !== bBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

function validateAuthorizeParams(params) {
  const required = ['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method'];
  for (const key of required) {
    if (!params[key]) {
      throw new AppError(`Missing OAuth parameter: ${key}`, {
        statusCode: 400,
        code: 'OAUTH_PARAMETER_MISSING'
      });
    }
  }

  if (params.response_type !== 'code') {
    throw new AppError('Unsupported OAuth response_type.', { statusCode: 400, code: 'UNSUPPORTED_RESPONSE_TYPE' });
  }

  if (params.code_challenge_method !== 'S256') {
    throw new AppError('OAuth PKCE S256 is required.', { statusCode: 400, code: 'PKCE_REQUIRED' });
  }
}

function validateRedirectUrl(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') {
    throw new AppError('OAuth redirect_uri must use HTTPS.', { statusCode: 400, code: 'INVALID_REDIRECT_URI' });
  }
}

function verifyPkce(codeVerifier, codeChallenge) {
  const expected = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  return expected === codeChallenge;
}

export function verifyOAuthAccessToken(token, req) {
  const payload = verifySignedToken(token);
  if (payload.typ !== 'access_token') {
    throw new AppError('Invalid OAuth access token type.', { statusCode: 401, code: 'INVALID_OAUTH_TOKEN' });
  }

  const allowedAudiences = new Set([getProtectedResource(req)]);
  if (process.env.PUBLIC_BASE_URL) {
    allowedAudiences.add(`${process.env.PUBLIC_BASE_URL.replace(/\/$/, '')}/mcp`);
  }

  if (!allowedAudiences.has(payload.aud)) {
    throw new AppError('OAuth token audience is not valid for this MCP server.', {
      statusCode: 401,
      code: 'INVALID_OAUTH_AUDIENCE'
    });
  }

  return payload;
}

export function registerProtectedResourceMetadataRoutes(app) {
  app.get('/.well-known/oauth-protected-resource', (req, res) => {
    res.json(getProtectedResourceMetadata(req));
  });

  app.get('/.well-known/oauth-protected-resource/mcp', (req, res) => {
    res.json(getProtectedResourceMetadata(req));
  });
}

export function registerOAuthRoutes(app) {
  registerProtectedResourceMetadataRoutes(app);

  app.get('/.well-known/oauth-authorization-server', (req, res) => {
    res.json(getAuthorizationServerMetadata(req));
  });

  app.get('/.well-known/openid-configuration', (req, res) => {
    res.json(getAuthorizationServerMetadata(req));
  });

  app.post('/oauth/register', (req, res) => {
    const redirectUris = Array.isArray(req.body?.redirect_uris) ? req.body.redirect_uris : [];
    if (redirectUris.length === 0) {
      res.status(400).json({ error: 'invalid_client_metadata', error_description: 'redirect_uris is required.' });
      return;
    }

    res.status(201).json({
      client_id: `client-${crypto.randomUUID()}`,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: redirectUris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code']
    });
  });

  app.get('/oauth/authorize', (req, res, next) => {
    try {
      const params = { ...req.query };
      validateAuthorizeParams(params);
      validateRedirectUrl(params.redirect_uri);
      res.type('html').send(renderAuthorizeForm(params));
    } catch (error) {
      next(error);
    }
  });

  app.post('/oauth/authorize', (req, res, next) => {
    try {
      const configuredPassword = process.env.OAUTH_AUTHORIZATION_PASSWORD;
      if (!configuredPassword) {
        throw new AppError('OAUTH_AUTHORIZATION_PASSWORD is not configured.', {
          statusCode: 500,
          code: 'OAUTH_PASSWORD_MISSING'
        });
      }

      const { password, ...params } = req.body;
      validateAuthorizeParams(params);
      validateRedirectUrl(params.redirect_uri);

      const passwordMatches = timingSafeEqualText(password ?? '', configuredPassword);

      if (!passwordMatches) {
        res.status(401).type('html').send(renderAuthorizeForm(params, 'Invalid authorization password.'));
        return;
      }

      const now = Math.floor(Date.now() / 1000);
      const code = sign({
        typ: 'authorization_code',
        iss: getBaseUrl(req),
        aud: getBaseUrl(req),
        client_id: params.client_id,
        redirect_uri: params.redirect_uri,
        code_challenge: params.code_challenge,
        resource: params.resource || getProtectedResource(req),
        scope: params.scope || SCOPES.join(' '),
        iat: now,
        exp: now + AUTH_CODE_TTL_SECONDS
      });

      const redirect = new URL(params.redirect_uri);
      redirect.searchParams.set('code', code);
      if (params.state) {
        redirect.searchParams.set('state', params.state);
      }

      res.redirect(302, redirect.toString());
    } catch (error) {
      next(error);
    }
  });

  app.post('/oauth/token', (req, res) => {
    try {
      const { grant_type: grantType, code, redirect_uri: redirectUri, code_verifier: codeVerifier } = req.body;

      if (grantType !== 'authorization_code') {
        res.status(400).json({ error: 'unsupported_grant_type' });
        return;
      }

      if (!code || !redirectUri || !codeVerifier) {
        res.status(400).json({ error: 'invalid_request', error_description: 'code, redirect_uri, and code_verifier are required.' });
        return;
      }

      const authCode = verifySignedToken(code);
      if (authCode.typ !== 'authorization_code' || authCode.redirect_uri !== redirectUri) {
        res.status(400).json({ error: 'invalid_grant' });
        return;
      }

      if (!verifyPkce(codeVerifier, authCode.code_challenge)) {
        res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed.' });
        return;
      }

      const now = Math.floor(Date.now() / 1000);
      const accessToken = sign({
        typ: 'access_token',
        iss: getBaseUrl(req),
        aud: authCode.resource,
        sub: 'shopify-mcp-owner',
        scope: authCode.scope,
        iat: now,
        exp: now + ACCESS_TOKEN_TTL_SECONDS
      });

      res.json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_TTL_SECONDS,
        scope: authCode.scope
      });
    } catch {
      res.status(400).json({ error: 'invalid_grant' });
    }
  });
}
