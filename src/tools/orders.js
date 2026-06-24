import * as z from 'zod/v4';

const SHOPIFY_PAGE_SIZE = 250;

function requestedCount(first) {
  if (first == null) {
    return null;
  }

  return Math.max(Number(first), 1);
}

function pageSizeFor(remaining) {
  if (remaining == null) {
    return SHOPIFY_PAGE_SIZE;
  }

  return Math.min(remaining, SHOPIFY_PAGE_SIZE);
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
        first: z.number().int().min(1).optional()
      }
    },
    async ({ query, first }) => {
      const limit = requestedCount(first);
      const orders = [];
      let after = null;
      let hasNextPage = false;

      do {
        const remaining = limit == null ? null : limit - orders.length;
        const pageSize = pageSizeFor(remaining);
        const data = await shopifyGraphQL(
          `#graphql
          query GetOrders($query: String, $first: Int!, $after: String) {
            orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
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
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }`,
          { query: query || null, first: pageSize, after }
        );

        orders.push(...data.orders.nodes);
        hasNextPage = data.orders.pageInfo.hasNextPage;
        after = data.orders.pageInfo.endCursor;
      } while (hasNextPage && (limit == null || orders.length < limit));

      return toolResponse({
        orders,
        count: orders.length,
        hasMore: hasNextPage
      });
    }
  );
}
