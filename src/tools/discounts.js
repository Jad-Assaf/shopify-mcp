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

export function registerDiscountTools(server, shopifyGraphQL, toolResponse) {
  server.registerTool(
    'create_discount_code',
    {
      title: 'Create discount code',
      description: 'Preview or create a basic percentage discount code.',
      inputSchema: {
        title: z.string().min(1),
        code: z.string().min(1),
        percentage: z.number().positive().max(100),
        startsAt: z.string().datetime(),
        endsAt: z.string().datetime().optional(),
        confirm: z.boolean().optional().default(false)
      }
    },
    async ({ title, code, percentage, startsAt, endsAt, confirm = false }) => {
      const input = {
        title,
        code,
        startsAt,
        ...(endsAt ? { endsAt } : {}),
        customerSelection: {
          all: true
        },
        customerGets: {
          value: {
            percentage: percentage / 100
          },
          items: {
            all: true
          }
        },
        appliesOncePerCustomer: false
      };

      if (!requireWriteAllowed(confirm)) {
        return toolResponse({ preview: true, action: 'create_discount_code', input });
      }

      const data = await shopifyGraphQL(
        `#graphql
        mutation CreateDiscountCode($basicCodeDiscount: DiscountCodeBasicInput!) {
          discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
            codeDiscountNode {
              id
              codeDiscount {
                ... on DiscountCodeBasic {
                  title
                  startsAt
                  endsAt
                  codes(first: 10) {
                    nodes {
                      code
                    }
                  }
                }
              }
            }
            userErrors {
              field
              message
            }
          }
        }`,
        { basicCodeDiscount: input }
      );

      return toolResponse({
        created: true,
        discount: data.discountCodeBasicCreate.codeDiscountNode
      });
    }
  );
}
