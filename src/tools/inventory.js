import crypto from 'node:crypto';
import * as z from 'zod/v4';
import { AppError } from '../utils/errors.js';

function requireWriteAllowed(confirm) {
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

export function registerInventoryTools(server, shopifyGraphQL, toolResponse) {
  server.registerTool(
    'get_inventory_by_sku',
    {
      title: 'Get inventory by SKU',
      description: 'Find a product variant by SKU and return inventory levels.',
      inputSchema: {
        sku: z.string().min(1)
      }
    },
    async ({ sku }) => {
      const data = await shopifyGraphQL(
        `#graphql
        query GetInventoryBySku($query: String!) {
          productVariants(first: 10, query: $query) {
            nodes {
              id
              title
              sku
              product {
                id
                title
              }
              inventoryItem {
                id
                tracked
                inventoryLevels(first: 25) {
                  nodes {
                    id
                    quantities(names: ["available", "committed", "incoming", "on_hand", "reserved"]) {
                      name
                      quantity
                    }
                    location {
                      id
                      name
                    }
                  }
                }
              }
            }
          }
        }`,
        { query: `sku:${sku}` }
      );

      return toolResponse({ variants: data.productVariants.nodes });
    }
  );

  server.registerTool(
    'update_inventory_quantity',
    {
      title: 'Update inventory quantity',
      description: 'Preview or set available inventory quantity for an inventory item at a location.',
      inputSchema: {
        inventoryItemId: z.string().min(1),
        locationId: z.string().min(1),
        availableQuantity: z.number().int(),
        confirm: z.boolean().optional().default(false)
      }
    },
    async ({ inventoryItemId, locationId, availableQuantity, confirm = false }) => {
      const idempotencyKey = crypto.randomUUID();
      const input = {
        name: 'available',
        reason: 'correction',
        referenceDocumentUri: `shopify-mcp-cloud-run://inventory-set/${idempotencyKey}`,
        quantities: [
          {
            inventoryItemId,
            locationId,
            quantity: availableQuantity
          }
        ]
      };

      if (!requireWriteAllowed(confirm)) {
        return toolResponse({
          preview: true,
          action: 'update_inventory_quantity',
          input,
          note: 'A confirmed write will fetch the current available quantity and use it as the compare value.'
        });
      }

      const current = await shopifyGraphQL(
        `#graphql
        query GetInventoryLevelForSet($inventoryItemId: ID!, $locationId: ID!) {
          inventoryItem(id: $inventoryItemId) {
            id
            inventoryLevel(locationId: $locationId) {
              location {
                id
                name
              }
              quantities(names: ["available"]) {
                name
                quantity
              }
            }
          }
        }`,
        { inventoryItemId, locationId }
      );

      const inventoryLevel = current.inventoryItem?.inventoryLevel;
      if (!inventoryLevel) {
        throw new AppError('Inventory level not found for the inventory item and location.', {
          statusCode: 404,
          code: 'INVENTORY_LEVEL_NOT_FOUND'
        });
      }

      const currentAvailable = inventoryLevel.quantities.find((quantity) => quantity.name === 'available')?.quantity;
      if (!Number.isInteger(currentAvailable)) {
        throw new AppError('Current available inventory quantity was not returned by Shopify.', {
          statusCode: 502,
          code: 'INVENTORY_QUANTITY_MISSING'
        });
      }

      input.quantities[0].changeFromQuantity = currentAvailable;

      const data = await shopifyGraphQL(
        `#graphql
        mutation SetInventoryQuantity($input: InventorySetQuantitiesInput!, $idempotencyKey: String!) {
          inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
            inventoryAdjustmentGroup {
              createdAt
              reason
              referenceDocumentUri
              changes {
                name
                delta
                quantityAfterChange
                item {
                  id
                }
                location {
                  id
                  name
                }
              }
            }
            userErrors {
              code
              field
              message
            }
          }
        }`,
        { input, idempotencyKey }
      );

      return toolResponse({
        updated: true,
        idempotencyKey,
        previousAvailableQuantity: currentAvailable,
        inventoryAdjustmentGroup: data.inventorySetQuantities.inventoryAdjustmentGroup
      });
    }
  );
}
