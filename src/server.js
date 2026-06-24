import 'dotenv/config';
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './mcp.js';
import { requireAuth } from './utils/auth.js';
import { getErrorStatusCode, toErrorResponse } from './utils/errors.js';
import { getPublicShopifyConfig } from './shopifyClient.js';

const app = express();
const port = Number(process.env.PORT ?? 8080);

app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));

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
    res.status(statusCode).json(toErrorResponse(error));
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`shopify-mcp-cloud-run listening on port ${port}`);
});
