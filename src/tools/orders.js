import * as z from 'zod/v4';

function normalizeFirst(first, max = 50) {
  return Math.min(Math.max(Number(first ?? 10), 1), max);
}

export function registerOrderTools(server, shopifyGraphQL, toolResponse) {
  server.registerTool(
    'get_orders',
    {
      title: 'Get orders',
      description: 'Fetch recent Shopify orders with customer and line item details.',
      inputSchema: {
        query: z.string().optional(),
        first: z.number().int().min(1).max(50).optional()
      }
    },
    async ({ query, first }) => {
      const data = await shopifyGraphQL(
        `#graphql
        query GetOrders($query: String, $first: Int!) {
          orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) {
            nodes {
              id
              name
              createdAt
              displayFinancialStatus
              displayFulfillmentStatus
              totalPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              customer {
                firstName
                lastName
                email
              }
              lineItems(first: 50) {
                nodes {
                  id
                  title
                  quantity
                  sku
                  variantTitle
                  originalTotalSet {
                    shopMoney {
                      amount
                      currencyCode
                    }
                  }
                }
              }
            }
          }
        }`,
        { query: query || null, first: normalizeFirst(first) }
      );

      return toolResponse({ orders: data.orders.nodes });
    }
  );
}
