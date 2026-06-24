# shopify-mcp-cloud-run

Production-ready Shopify Admin MCP server for Google Cloud Run. It exposes an authenticated MCP endpoint at `/mcp` and safe Shopify Admin GraphQL tools for products, orders, inventory, discounts, and service health.

## Security model

- Every `/mcp` request must include `Authorization: Bearer <MCP_API_KEY>` or a valid OAuth access token issued by this server.
- OAuth 2.1 authorization-code + PKCE endpoints are included for ChatGPT Apps developer mode.
- `Origin` is validated when present. Set `MCP_ALLOWED_ORIGINS` to a comma-separated list for browser clients.
- Shopify credentials are read only from environment variables and are never logged.
- Write tools never write by default. They return a JSON preview unless `confirm=true`.
- Confirmed writes still require `ALLOW_WRITE_TOOLS=true`.
- Destructive actions such as deleting customers/products, refunding orders, or canceling orders are intentionally not implemented.

## Shopify custom app setup

1. In Shopify Admin, go to **Settings > Apps and sales channels > Develop apps**.
2. Create a custom app for this MCP server.
3. Configure Admin API scopes:
   - `read_products`
   - `write_products`
   - `read_orders`
   - `read_inventory`
   - `write_inventory`
   - `read_discounts`
   - `write_discounts`
   - `read_locations`
4. Install the app and copy the Admin API access token.
5. Store the token in Google Secret Manager or your local `.env` file.

## Environment variables

Copy `.env.example` to `.env` for local development:

```bash
cp .env.example .env
```

Required values:

```bash
SHOPIFY_SHOP_DOMAIN=your-store.myshopify.com
SHOPIFY_ADMIN_ACCESS_TOKEN=replace-with-shopify-admin-api-token
SHOPIFY_API_VERSION=2026-04
MCP_API_KEY=some-secret-key
ALLOW_WRITE_TOOLS=false
```

Optional values:

```bash
PUBLIC_BASE_URL=https://your-cloud-run-service-url
OAUTH_AUTHORIZATION_PASSWORD=owner-login-password-for-chatgpt-linking
OAUTH_TOKEN_SECRET=random-oauth-signing-secret
MCP_ALLOWED_ORIGINS=https://your-client.example.com
SHOPIFY_REQUEST_TIMEOUT_MS=20000
SHOPIFY_MAX_RETRIES=2
```

Keep `ALLOW_WRITE_TOOLS=false` unless you intentionally want this MCP server to edit Shopify data.

`PUBLIC_BASE_URL` is recommended in Cloud Run so OAuth discovery metadata uses the exact public service URL. `OAUTH_AUTHORIZATION_PASSWORD` is the password you enter in the browser when ChatGPT links the app. `OAUTH_TOKEN_SECRET` signs short-lived OAuth access tokens.

## Run locally

```bash
npm install
npm run dev
```

The service listens on `0.0.0.0` using `process.env.PORT`, defaulting to `8080`.

Test health:

```bash
curl http://localhost:8080/health
```

Test MCP initialization:

```bash
curl http://localhost:8080/mcp \
  -H "Authorization: Bearer $MCP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1.0.0"}}}'
```

List tools:

```bash
curl http://localhost:8080/mcp \
  -H "Authorization: Bearer $MCP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

## Preview vs confirm

All write tools support preview mode. For example, this returns the proposed change without writing to Shopify:

```json
{
  "productId": "gid://shopify/Product/123",
  "seoTitle": "New SEO title",
  "seoDescription": "New SEO description",
  "confirm": false
}
```

To write, both conditions are required:

- Set `ALLOW_WRITE_TOOLS=true` in the service environment.
- Pass `"confirm": true` to the tool call.

If either condition is missing, the server does not write.

For `update_inventory_quantity`, a confirmed write first reads the current available quantity at the given location and sends it as Shopify's compare value with an idempotency key. If inventory changed between preview and confirm, Shopify returns a user error instead of silently overwriting the new value.

## Cloud Run deployment

Enable required Google APIs:

```bash
gcloud services enable run.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com
```

Create Secret Manager secrets:

```bash
printf "replace-with-shopify-admin-api-token" | gcloud secrets create shopify-admin-token --data-file=-
printf "some-secret-key" | gcloud secrets create mcp-api-key --data-file=-
printf "owner-login-password" | gcloud secrets create oauth-authorization-password --data-file=-
openssl rand -base64 32 | gcloud secrets create oauth-token-secret --data-file=-
```

Deploy to Cloud Run:

```bash
gcloud run deploy shopify-mcp-cloud-run \
  --source . \
  --region me-west1 \
  --allow-unauthenticated \
  --set-env-vars SHOPIFY_SHOP_DOMAIN=your-store.myshopify.com,SHOPIFY_API_VERSION=2026-04,ALLOW_WRITE_TOOLS=false,MCP_ALLOWED_ORIGINS=https://chatgpt.com \
  --set-secrets SHOPIFY_ADMIN_ACCESS_TOKEN=shopify-admin-token:latest,MCP_API_KEY=mcp-api-key:latest,OAUTH_AUTHORIZATION_PASSWORD=oauth-authorization-password:latest,OAUTH_TOKEN_SECRET=oauth-token-secret:latest
```

Cloud Run is marked `--allow-unauthenticated` so MCP clients can reach the service, but the `/mcp` endpoint still requires the bearer token.

After the first deploy, get the public service URL:

```bash
SERVICE_URL=$(gcloud run services describe shopify-mcp-cloud-run \
  --region me-west1 \
  --format='value(status.url)')
```

Then set it as `PUBLIC_BASE_URL` so OAuth metadata is stable:

```bash
gcloud run services update shopify-mcp-cloud-run \
  --region me-west1 \
  --update-env-vars PUBLIC_BASE_URL="$SERVICE_URL"
```

## Connect to ChatGPT

1. In ChatGPT web, open **Settings > Apps > Advanced settings**.
2. Enable **Developer mode**.
3. Click **Create app**.
4. Use the MCP server URL: `https://your-cloud-run-service-url/mcp`.
5. Choose OAuth authentication if prompted.
6. When the authorization page opens, enter `OAUTH_AUTHORIZATION_PASSWORD`.

The server exposes OAuth discovery at:

- `/.well-known/oauth-protected-resource`
- `/.well-known/oauth-authorization-server`
- `/oauth/register`
- `/oauth/authorize`
- `/oauth/token`

## MCP tools

`search_products` and `get_orders` paginate through all matching Shopify pages. Use `query` to narrow results.

- `health_check`
- `shopify_admin_graphql`
- `search_products`
- `get_product`
- `update_product_seo`
- `update_product_description`
- `update_product_tags`
- `update_product_status`
- `create_product`
- `add_product_media`
- `update_product_media`
- `delete_product_media`
- `reorder_product_media`
- `replace_product_media`
- `append_variant_media`
- `detach_variant_media`
- `update_product_metafields`
- `get_orders`
- `get_inventory_by_sku`
- `update_inventory_quantity`
- `create_discount_code`
