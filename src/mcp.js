import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { shopifyGraphQL, getPublicShopifyConfig } from './shopifyClient.js';
import { registerProductTools } from './tools/products.js';
import { registerOrderTools } from './tools/orders.js';
import { registerInventoryTools } from './tools/inventory.js';
import { registerDiscountTools } from './tools/discounts.js';

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

  registerProductTools(server, shopifyGraphQL, toolResponse);
  registerOrderTools(server, shopifyGraphQL, toolResponse);
  registerInventoryTools(server, shopifyGraphQL, toolResponse);
  registerDiscountTools(server, shopifyGraphQL, toolResponse);

  return server;
}
