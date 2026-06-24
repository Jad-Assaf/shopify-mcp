import { AppError, cleanShopifyErrors, cleanUserErrors } from './utils/errors.js';

const DEFAULT_TIMEOUT_MS = Number(process.env.SHOPIFY_REQUEST_TIMEOUT_MS ?? 20000);
const MAX_RETRIES = Number(process.env.SHOPIFY_MAX_RETRIES ?? 2);

function getShopifyConfig() {
  const shopDomain = process.env.SHOPIFY_SHOP_DOMAIN;
  const accessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  const apiVersion = process.env.SHOPIFY_API_VERSION ?? '2026-04';

  if (!shopDomain) {
    throw new AppError('SHOPIFY_SHOP_DOMAIN is not configured.', {
      statusCode: 500,
      code: 'SHOPIFY_SHOP_DOMAIN_MISSING'
    });
  }

  if (!accessToken) {
    throw new AppError('SHOPIFY_ADMIN_ACCESS_TOKEN is not configured.', {
      statusCode: 500,
      code: 'SHOPIFY_TOKEN_MISSING'
    });
  }

  return { shopDomain, accessToken, apiVersion };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(attempt, response) {
  const retryAfter = response?.headers?.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) {
      return seconds * 1000;
    }
  }

  return 500 * 2 ** attempt;
}

function findUserErrors(payload) {
  const found = [];

  function walk(value) {
    if (!value || typeof value !== 'object') {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }

    if (Array.isArray(value.userErrors) && value.userErrors.length > 0) {
      found.push(...value.userErrors);
    }

    Object.values(value).forEach(walk);
  }

  walk(payload);
  return found;
}

export async function shopifyGraphQL(query, variables = {}, options = {}) {
  const { shopDomain, accessToken, apiVersion } = getShopifyConfig();
  const url = `https://${shopDomain}/admin/api/${apiVersion}/graphql.json`;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
        await sleep(retryDelayMs(attempt, response));
        continue;
      }

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new AppError('Shopify Admin API request failed.', {
          statusCode: response.status,
          code: 'SHOPIFY_HTTP_ERROR',
          details: {
            status: response.status,
            statusText: response.statusText,
            response: payload
          }
        });
      }

      if (!payload || typeof payload !== 'object') {
        throw new AppError('Shopify Admin API returned an invalid JSON response.', {
          statusCode: 502,
          code: 'SHOPIFY_INVALID_RESPONSE'
        });
      }

      if (payload?.errors?.length) {
        throw new AppError('Shopify GraphQL returned errors.', {
          statusCode: 502,
          code: 'SHOPIFY_GRAPHQL_ERROR',
          details: cleanShopifyErrors(payload.errors)
        });
      }

      const userErrors = findUserErrors(payload?.data);
      if (userErrors.length > 0) {
        throw new AppError('Shopify mutation returned user errors.', {
          statusCode: 400,
          code: 'SHOPIFY_USER_ERROR',
          details: cleanUserErrors(userErrors)
        });
      }

      return payload.data;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;

      if (error.name === 'AbortError') {
        lastError = new AppError('Shopify Admin API request timed out.', {
          statusCode: 504,
          code: 'SHOPIFY_TIMEOUT'
        });
      }

      if (attempt < MAX_RETRIES && !isNonRetryableError(lastError)) {
        await sleep(500 * 2 ** attempt);
        continue;
      }

      break;
    }
  }

  throw lastError;
}

function isNonRetryableError(error) {
  return error instanceof AppError && error.statusCode < 500 && error.statusCode !== 429;
}

export function getPublicShopifyConfig() {
  return {
    shopDomain: process.env.SHOPIFY_SHOP_DOMAIN ?? null,
    apiVersion: process.env.SHOPIFY_API_VERSION ?? '2026-04'
  };
}
