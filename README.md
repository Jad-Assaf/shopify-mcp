# shopify-mcp-cloud-run

Production-ready Shopify Admin MCP server for Google Cloud Run. It exposes an authenticated MCP endpoint at `/mcp` and safe Shopify Admin GraphQL tools for products, orders, inventory, discounts, and service health.

## Security model

- Every normal `/mcp` request must include `Authorization: Bearer <MCP_API_KEY>` or a valid OAuth access token issued by this server.
- Local Secure MCP Tunnel mode is the only exception: `MCP_LOCAL_NO_AUTH=true` disables MCP auth for loopback requests only and should be used only with `HOST=127.0.0.1`.
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
MCP_LOCAL_NO_AUTH=false
```

Keep `ALLOW_WRITE_TOOLS=false` unless you intentionally want this MCP server to edit Shopify data.

`PUBLIC_BASE_URL` is recommended in Cloud Run so OAuth discovery metadata uses the exact public service URL. `OAUTH_AUTHORIZATION_PASSWORD` is the password you enter in the browser when ChatGPT links the app. `OAUTH_TOKEN_SECRET` signs short-lived OAuth access tokens.

## Run locally

```bash
./scripts/install-local-deps.sh
npm run dev
```

The normal local/dev service listens on `0.0.0.0` using `process.env.PORT`, defaulting to `8080`, and requires `Authorization: Bearer <MCP_API_KEY>` on `/mcp`.

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

## Secure MCP Tunnel local workflow

Use this mode when connecting this local Shopify MCP server to ChatGPT through Secure MCP Tunnel. It keeps the MCP server on loopback and does not expose it publicly.

### 1. Create and fill `.env`

```bash
cp .env.example .env
```

Fill these values in `.env`:

```bash
SHOPIFY_SHOP_DOMAIN=your-store.myshopify.com
SHOPIFY_ADMIN_ACCESS_TOKEN=your-shopify-admin-token
SHOPIFY_API_VERSION=2026-04
ALLOW_WRITE_TOOLS=false
```

For local tunnel mode, `MCP_API_KEY`, `PUBLIC_BASE_URL`, `OAUTH_AUTHORIZATION_PASSWORD`, and `OAUTH_TOKEN_SECRET` are not used by the tunnel connector because the local server runs with loopback-only no-auth. Keep real values out of git.

### 2. Install local dependencies

```bash
./scripts/install-local-deps.sh
```

This installs Node dependencies into project-local `node_modules/` and creates `.local/bin` and `.local/downloads` for local tools. It does not install npm packages globally.

### 3. Start the local MCP server for tunnel mode

```bash
./scripts/run-local-tunnel.sh
```

This starts:

```text
http://127.0.0.1:8080/mcp
```

In this mode:

- `HOST` defaults to `127.0.0.1`.
- `PORT` defaults to `8080`.
- `MCP_LOCAL_NO_AUTH=true` is set by the script.
- `/mcp` accepts unauthenticated requests only from loopback.
- OAuth routes are disabled for this local process.

### 4. Install or download `tunnel-client`

Download `tunnel-client` from OpenAI Platform tunnel settings or from the latest public release:

```text
https://github.com/openai/tunnel-client/releases/latest
```

Place the binary in the project-local tool directory:

```bash
mkdir -p .local/bin .local/downloads
mv /path/to/tunnel-client .local/bin/tunnel-client
chmod +x .local/bin/tunnel-client
./.local/bin/tunnel-client --help
```

Do not commit the binary or downloaded archives. `.gitignore` excludes `.local/`, `tunnel-client*`, and common archive formats.

### 5. Initialize and run the tunnel profile

Use your real tunnel ID:

```bash
./.local/bin/tunnel-client init \
  --sample sample_mcp_remote_no_auth \
  --profile shopify-local \
  --tunnel-id YOUR_TUNNEL_ID \
  --mcp-server-url http://localhost:8080/mcp
```

If you keep `tunnel-client` on your `PATH`, the same command is:

```bash
tunnel-client init --sample sample_mcp_remote_no_auth --profile shopify-local --tunnel-id YOUR_TUNNEL_ID --mcp-server-url http://localhost:8080/mcp
```

Then run it:

```bash
./.local/bin/tunnel-client run --profile shopify-local
```

Keep both processes running:

- `./scripts/run-local-tunnel.sh`
- `./.local/bin/tunnel-client run --profile shopify-local`

### 6. Avoid tunnel health port conflicts

The Shopify MCP server uses port `8080`. If `tunnel-client` also tries to bind its health/admin server to port `8080`, edit the generated `shopify-local` tunnel-client profile and set its health listener to loopback port `8081`.

Use the config format generated by your `tunnel-client` version. The setting is typically named like this:

```yaml
health:
  listen_addr: 127.0.0.1:8081
```

or:

```toml
[health]
listen_addr = "127.0.0.1:8081"
```

After changing it, restart `tunnel-client run --profile shopify-local`.

### 7. Create the ChatGPT connector

1. In ChatGPT, open **Settings > Connectors** or **Settings > Apps > Advanced settings**.
2. Create a connector/app in Developer mode.
3. Choose **Tunnel** mode.
4. Select the `YOUR_TUNNEL_ID` tunnel/profile that maps to `shopify-local`.
5. Choose **No Authentication**.
6. Save the connector and verify that ChatGPT can discover tools.

Choose **No Authentication** because the tunnel already authenticates the OpenAI-to-tunnel path, and the local Shopify MCP server uses local `.env` credentials while accepting only loopback requests from `tunnel-client`.

### Troubleshooting Secure MCP Tunnel

**Port 8080 already in use**

Find and stop the process:

```bash
lsof -nP -iTCP:8080 -sTCP:LISTEN
```

Or run the local server on another loopback port:

```bash
PORT=8082 ./scripts/run-local-tunnel.sh
```

Then re-run `tunnel-client init` with:

```bash
--mcp-server-url http://localhost:8082/mcp
```

**`tunnel-client` health server is using port 8080**

Edit the generated tunnel-client profile and set:

```text
health.listen_addr = 127.0.0.1:8081
```

Then restart `tunnel-client run --profile shopify-local`.

**ChatGPT cannot discover tools**

Check each layer:

```bash
curl http://127.0.0.1:8080/health
./.local/bin/tunnel-client doctor --profile shopify-local --explain
```

Make sure `./scripts/run-local-tunnel.sh` and `tunnel-client run --profile shopify-local` are both still running. If you recently changed tools, refresh the ChatGPT connector or recreate it so the tool schema is rediscovered.

**Missing env vars**

`./scripts/run-local-tunnel.sh` checks:

- `SHOPIFY_SHOP_DOMAIN`
- `SHOPIFY_ADMIN_ACCESS_TOKEN`
- `SHOPIFY_API_VERSION`

Fill them in `.env`. Do not commit `.env`.

**Dependency install blocked by system Python or `externally-managed-environment`**

This repo is a Node.js app. Use:

```bash
./scripts/install-local-deps.sh
```

It installs into local `node_modules/` and does not use global Python packages. If a separate tunnel-client helper asks for Python packages, create a local venv instead of installing globally:

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
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
