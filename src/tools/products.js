import * as z from 'zod/v4';
import { AppError } from '../utils/errors.js';

const ProductIdSchema = z.string().min(1);
const ProductStatusSchema = z.enum(['ACTIVE', 'ARCHIVED', 'DRAFT']);

const MetafieldInputSchema = z.object({
  namespace: z.string().min(1),
  key: z.string().min(1),
  type: z.string().min(1),
  value: z.string()
});

const ProductOptionInputSchema = z.object({
  name: z.string().min(1),
  values: z.array(z.string().min(1)).min(1)
});

const ProductMediaInputSchema = z.object({
  originalSource: z.string().url(),
  alt: z.string().optional(),
  mediaContentType: z.enum(['IMAGE', 'VIDEO', 'EXTERNAL_VIDEO', 'MODEL_3D'])
});

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

function normalizeFirst(first, max = 50) {
  return Math.min(Math.max(Number(first ?? 10), 1), max);
}

function productFields() {
  return `#graphql
    id
    title
    handle
    status
    vendor
    productType
    onlineStoreUrl
    totalInventory
    variants(first: 25) {
      nodes {
        id
        title
        sku
        price
        inventoryQuantity
      }
    }
  `;
}

function fullProductFields() {
  return `#graphql
    id
    title
    handle
    status
    descriptionHtml
    vendor
    productType
    tags
    seo {
      title
      description
    }
    variants(first: 100) {
      nodes {
        id
        title
        sku
        price
        compareAtPrice
        inventoryQuantity
        inventoryItem {
          id
          tracked
        }
      }
    }
    images(first: 50) {
      nodes {
        id
        url
        altText
        width
        height
      }
    }
    metafields(first: 50) {
      nodes {
        id
        namespace
        key
        type
        value
      }
    }
  `;
}

export function registerProductTools(server, shopifyGraphQL, toolResponse) {
  server.registerTool(
    'search_products',
    {
      title: 'Search products',
      description: 'Search Shopify products by title, SKU, handle, vendor, product type, or tag.',
      inputSchema: {
        query: z.string().min(1),
        first: z.number().int().min(1).max(50).optional()
      }
    },
    async ({ query, first }) => {
      const data = await shopifyGraphQL(
        `#graphql
        query SearchProducts($query: String!, $first: Int!) {
          products(first: $first, query: $query) {
            nodes {
              ${productFields()}
            }
          }
        }`,
        { query, first: normalizeFirst(first) }
      );

      return toolResponse({ products: data.products.nodes });
    }
  );

  server.registerTool(
    'get_product',
    {
      title: 'Get product',
      description: 'Fetch full Shopify product details, variants, images, and metafields.',
      inputSchema: {
        productId: ProductIdSchema
      }
    },
    async ({ productId }) => {
      const data = await shopifyGraphQL(
        `#graphql
        query GetProduct($productId: ID!) {
          product(id: $productId) {
            ${fullProductFields()}
          }
        }`,
        { productId }
      );

      if (!data.product) {
        throw new AppError('Product not found.', { statusCode: 404, code: 'PRODUCT_NOT_FOUND' });
      }

      return toolResponse({ product: data.product });
    }
  );

  server.registerTool(
    'update_product_seo',
    {
      title: 'Update product SEO',
      description: 'Preview or update Shopify product SEO title and description.',
      inputSchema: {
        productId: ProductIdSchema,
        seoTitle: z.string().min(1),
        seoDescription: z.string().min(1),
        confirm: z.boolean().optional().default(false)
      }
    },
    async ({ productId, seoTitle, seoDescription, confirm = false }) => {
      const product = { id: productId, seo: { title: seoTitle, description: seoDescription } };
      if (!requireWriteAllowed(confirm)) {
        return toolResponse({ preview: true, action: 'update_product_seo', product });
      }

      const data = await shopifyGraphQL(
        `#graphql
        mutation UpdateProductSeo($product: ProductUpdateInput!) {
          productUpdate(product: $product) {
            product {
              id
              title
              seo {
                title
                description
              }
            }
            userErrors {
              field
              message
            }
          }
        }`,
        { product }
      );

      return toolResponse({ updated: true, product: data.productUpdate.product });
    }
  );

  server.registerTool(
    'update_product_description',
    {
      title: 'Update product description',
      description: 'Preview or update product descriptionHtml.',
      inputSchema: {
        productId: ProductIdSchema,
        descriptionHtml: z.string().min(1),
        confirm: z.boolean().optional().default(false)
      }
    },
    async ({ productId, descriptionHtml, confirm = false }) => {
      const product = { id: productId, descriptionHtml };
      if (!requireWriteAllowed(confirm)) {
        return toolResponse({ preview: true, action: 'update_product_description', product });
      }

      const data = await shopifyGraphQL(
        `#graphql
        mutation UpdateProductDescription($product: ProductUpdateInput!) {
          productUpdate(product: $product) {
            product {
              id
              title
              descriptionHtml
            }
            userErrors {
              field
              message
            }
          }
        }`,
        { product }
      );

      return toolResponse({ updated: true, product: data.productUpdate.product });
    }
  );

  server.registerTool(
    'update_product_tags',
    {
      title: 'Update product tags',
      description: 'Preview or replace all product tags.',
      inputSchema: {
        productId: ProductIdSchema,
        tags: z.array(z.string().min(1)).default([]),
        confirm: z.boolean().optional().default(false)
      }
    },
    async ({ productId, tags, confirm = false }) => {
      const product = { id: productId, tags };
      if (!requireWriteAllowed(confirm)) {
        return toolResponse({ preview: true, action: 'update_product_tags', product });
      }

      const data = await shopifyGraphQL(
        `#graphql
        mutation UpdateProductTags($product: ProductUpdateInput!) {
          productUpdate(product: $product) {
            product {
              id
              title
              tags
            }
            userErrors {
              field
              message
            }
          }
        }`,
        { product }
      );

      return toolResponse({ updated: true, product: data.productUpdate.product });
    }
  );

  server.registerTool(
    'update_product_status',
    {
      title: 'Update product status',
      description: 'Preview or update product status. Status must be ACTIVE, DRAFT, or ARCHIVED.',
      inputSchema: {
        productId: ProductIdSchema,
        status: ProductStatusSchema,
        confirm: z.boolean().optional().default(false)
      }
    },
    async ({ productId, status, confirm = false }) => {
      const product = { id: productId, status };
      if (!requireWriteAllowed(confirm)) {
        return toolResponse({ preview: true, action: 'update_product_status', product });
      }

      const data = await shopifyGraphQL(
        `#graphql
        mutation UpdateProductStatus($product: ProductUpdateInput!) {
          productUpdate(product: $product) {
            product {
              id
              title
              status
              handle
            }
            userErrors {
              field
              message
            }
          }
        }`,
        { product }
      );

      return toolResponse({ updated: true, product: data.productUpdate.product });
    }
  );

  server.registerTool(
    'create_product',
    {
      title: 'Create product',
      description: 'Preview or create a Shopify product with optional status, tags, SEO, metafields, options, collections, and media.',
      inputSchema: {
        title: z.string().min(1),
        descriptionHtml: z.string().optional(),
        vendor: z.string().optional(),
        productType: z.string().optional(),
        status: ProductStatusSchema.optional(),
        handle: z.string().optional(),
        tags: z.array(z.string().min(1)).optional(),
        seoTitle: z.string().optional(),
        seoDescription: z.string().optional(),
        metafields: z.array(MetafieldInputSchema).optional(),
        collectionsToJoin: z.array(z.string().min(1)).optional(),
        productOptions: z.array(ProductOptionInputSchema).max(3).optional(),
        media: z.array(ProductMediaInputSchema).optional(),
        confirm: z.boolean().optional().default(false)
      }
    },
    async ({
      title,
      descriptionHtml,
      vendor,
      productType,
      status,
      handle,
      tags,
      seoTitle,
      seoDescription,
      metafields,
      collectionsToJoin,
      productOptions,
      media,
      confirm = false
    }) => {
      const product = {
        title,
        ...(descriptionHtml ? { descriptionHtml } : {}),
        ...(vendor ? { vendor } : {}),
        ...(productType ? { productType } : {}),
        ...(status ? { status } : {}),
        ...(handle ? { handle } : {}),
        ...(tags ? { tags } : {}),
        ...(metafields ? { metafields } : {}),
        ...(collectionsToJoin ? { collectionsToJoin } : {}),
        ...(productOptions
          ? {
              productOptions: productOptions.map((option) => ({
                name: option.name,
                values: option.values.map((name) => ({ name }))
              }))
            }
          : {}),
        ...(seoTitle || seoDescription
          ? {
              seo: {
                ...(seoTitle ? { title: seoTitle } : {}),
                ...(seoDescription ? { description: seoDescription } : {})
              }
            }
          : {})
      };

      const variables = {
        product,
        media: media ?? []
      };

      if (!requireWriteAllowed(confirm)) {
        return toolResponse({ preview: true, action: 'create_product', ...variables });
      }

      const data = await shopifyGraphQL(
        `#graphql
        mutation CreateProduct($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
          productCreate(product: $product, media: $media) {
            product {
              id
              title
              handle
              status
              vendor
              productType
              tags
              seo {
                title
                description
              }
              variants(first: 10) {
                nodes {
                  id
                  title
                  sku
                  price
                  inventoryItem {
                    id
                    tracked
                  }
                }
              }
              media(first: 10) {
                nodes {
                  alt
                  mediaContentType
                  preview {
                    status
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
        variables
      );

      return toolResponse({ created: true, product: data.productCreate.product });
    }
  );

  server.registerTool(
    'update_product_metafields',
    {
      title: 'Update product metafields',
      description: 'Preview or set product metafields with metafieldsSet.',
      inputSchema: {
        ownerId: z.string().min(1),
        metafields: z.array(
          z.object({
            namespace: z.string().min(1),
            key: z.string().min(1),
            type: z.string().min(1),
            value: z.string()
          })
        ).min(1),
        confirm: z.boolean().optional().default(false)
      }
    },
    async ({ ownerId, metafields, confirm = false }) => {
      const input = metafields.map((metafield) => ({ ...metafield, ownerId }));
      if (!requireWriteAllowed(confirm)) {
        return toolResponse({ preview: true, action: 'update_product_metafields', input });
      }

      const data = await shopifyGraphQL(
        `#graphql
        mutation SetProductMetafields($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields {
              id
              namespace
              key
              type
              value
            }
            userErrors {
              field
              message
            }
          }
        }`,
        { metafields: input }
      );

      return toolResponse({ updated: true, metafields: data.metafieldsSet.metafields });
    }
  );
}
