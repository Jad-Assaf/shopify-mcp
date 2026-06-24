import * as z from 'zod/v4';

function normalizeFirst(first, max = 50) {
  return Math.min(Math.max(Number(first ?? 10), 1), max);
}

function customerVisitFields() {
  return `#graphql
    id
    occurredAt
    source
    sourceDescription
    sourceType
    landingPage
    referrerUrl
    referralCode
    utmParameters {
      campaign
      content
      medium
      source
      term
    }
  `;
}

export function registerOrderTools(server, shopifyGraphQL, toolResponse) {
  server.registerTool(
    'get_orders',
    {
      title: 'Get orders',
      description: 'Fetch recent Shopify orders with customer, notes, attribution, and line item details.',
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
              note
              displayFinancialStatus
              displayFulfillmentStatus
              customAttributes {
                key
                value
              }
              app {
                id
                name
              }
              customerJourneySummary {
                ready
                customerOrderIndex
                daysToConversion
                firstVisit {
                  ${customerVisitFields()}
                }
                lastVisit {
                  ${customerVisitFields()}
                }
              }
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
