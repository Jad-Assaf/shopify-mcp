import 'dotenv/config';
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './mcp.js';
import { registerOAuthRoutes } from './oauth.js';
import { requireAuth } from './utils/auth.js';
import { getErrorStatusCode, toErrorResponse } from './utils/errors.js';
import { getPublicShopifyConfig } from './shopifyClient.js';

const app = express();
const port = Number(process.env.PORT ?? 8080);

app.set('trust proxy', true);
app.use((req, res, next) => {
  const origin = req.get('origin');
  const allowedOrigins = (process.env.MCP_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (origin && allowedOrigins.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Headers', 'authorization, content-type, mcp-session-id');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }

  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }

  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

registerOAuthRoutes(app);

app.get('/health', (_req, res) => {
  const { shopDomain, apiVersion } = getPublicShopifyConfig();

  res.json({
    status: 'ok',
    service: 'shopify-mcp-cloud-run',
    shopDomain,
    shopifyApiVersion: apiVersion,
    writeToolsEnabled: process.env.ALLOW_WRITE_TOOLS === 'true'
  });
});

app.all('/mcp', requireAuth, async (req, res, next) => {
  try {
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    });

    res.on('close', () => {
      transport.close();
      server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  const statusCode = getErrorStatusCode(error);

  if (statusCode >= 500) {
    console.error(error.message);
  }

  if (!res.headersSent) {
    if (error.details?.wwwAuthenticate) {
      res.set('WWW-Authenticate', error.details.wwwAuthenticate);
    }
    res.status(statusCode).json(toErrorResponse(error));
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`shopify-mcp-cloud-run listening on port ${port}`);
});
