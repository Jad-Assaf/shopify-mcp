import * as z from 'zod/v4';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { shopifyGraphQL, getPublicShopifyConfig } from './shopifyClient.js';
import { registerProductTools } from './tools/products.js';
import { registerOrderTools } from './tools/orders.js';
import { registerInventoryTools } from './tools/inventory.js';
import { registerDiscountTools } from './tools/discounts.js';
import { AppError } from './utils/errors.js';

export function toolResponse(payload) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2)
      }
    ]
  };
}

function isWriteOperation(query) {
  return /\bmutation\b/i.test(query);
}

function assertWriteAllowed(confirm) {
  if (!confirm) {
    return false;
  }

  if (process.env.ALLOW_WRITE_TOOLS !== 'true') {
    throw new AppError('Write tools are disabled. Set ALLOW_WRITE_TOOLS=true to allow confirmed writes.', {
      statusCode: 403,
      code: 'WRITES_DISABLED'
    });
  }

  return true;
}

export function createMcpServer() {
  const server = new McpServer({
    name: 'shopify-mcp-cloud-run',
    version: '1.0.0'
  });

  server.registerTool(
    'health_check',
    {
      title: 'Health check',
      description: 'Return service status and public Shopify configuration.'
    },
    async () => {
      const { shopDomain, apiVersion } = getPublicShopifyConfig();

      return toolResponse({
        status: 'ok',
        shopDomain,
        shopifyApiVersion: apiVersion,
        writeToolsEnabled: process.env.ALLOW_WRITE_TOOLS === 'true'
      });
    }
  );

  server.registerTool(
    'shopify_admin_graphql',
    {
      title: 'Shopify Admin GraphQL',
      description: 'Run a raw Shopify Admin GraphQL query. Mutations preview unless confirm=true and write tools are enabled.',
      inputSchema: {
        query: z.string().min(1),
        variables: z.record(z.string(), z.any()).optional(),
        confirm: z.boolean().optional().default(false)
      }
    },
    async ({ query, variables = {}, confirm = false }) => {
      if (isWriteOperation(query) && !assertWriteAllowed(confirm)) {
        return toolResponse({
          preview: true,
          action: 'shopify_admin_graphql',
          operation: 'mutation',
          query,
          variables
        });
      }

      const data = await shopifyGraphQL(query, variables);

      return toolResponse({ data });
    }
  );

  registerProductTools(server, shopifyGraphQL, toolResponse);
  registerOrderTools(server, shopifyGraphQL, toolResponse);
  registerInventoryTools(server, shopifyGraphQL, toolResponse);
  registerDiscountTools(server, shopifyGraphQL, toolResponse);

  return server;
}
