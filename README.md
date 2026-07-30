# worldbank-procurement-mcp

A remote MCP (Model Context Protocol) server that exposes the World Bank's
free, public **Procurement Notices API**
(`search.worldbank.org/api/v2/procnotices`) as tools an AI agent can call --
search notices worldwide, filter by country/sector/notice type, and fetch a
single notice by ID. No API key needed on the World Bank side.

Built with Cloudflare's current (July 2026) `createMcpHandler` pattern from
the `agents` SDK -- **not** the older `McpAgent`/Durable Object pattern you'll
see in most existing tutorials, which Cloudflare has deprecated.

## Tools exposed

- **`search_wb_notices`** -- keyword + filter search (country, sector, notice
  type, procurement method code), paginated.
- **`get_wb_notice`** -- full detail for one notice by ID.

> **Note on `qterm` filtering:** the World Bank endpoint is undocumented
> (there's no official spec), so parameter behavior comes from third-party
> reverse-engineering. Test `qterm` filtering against your own deployment
> before relying on it -- if it doesn't actually narrow results server-side,
> pull a larger page with `rows` and filter client-side on the returned
> `summary`/`description` text instead.

## 1. Local setup

Requires Node.js 18+.

```bash
unzip worldbank-procurement-mcp.zip
cd worldbank-procurement-mcp
npm install
```

Run it locally:

```bash
npm start
```

Wrangler will print a local URL, e.g. `http://localhost:8788/mcp`.

Test it with the MCP Inspector in a second terminal:

```bash
npx @modelcontextprotocol/inspector@latest
```

Open the Inspector in your browser, paste in `http://localhost:8788/mcp`,
click **Connect**, then **List Tools** to confirm both tools show up. Try
`search_wb_notices` with `countryName: "Kenya"` or `qterm: "software"`.

## 2. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit: World Bank procurement MCP server"
```

Create an empty repo on GitHub (no README/license, since you already have
one), then:

```bash
git remote add origin https://github.com/<your-username>/worldbank-procurement-mcp.git
git branch -M main
git push -u origin main
```

## 3. Deploy to Cloudflare

**Option A -- CLI (fastest):**

```bash
npx wrangler login
npx wrangler deploy
```

This deploys straight to `worldbank-procurement-mcp.<your-account>.workers.dev/mcp`.

**Option B -- connect the GitHub repo for auto-deploy on push:**

1. In the Cloudflare dashboard, go to **Workers & Pages -> Create -> Import
   a repository**, and select the GitHub repo you just pushed.
2. Cloudflare will detect `wrangler.jsonc` and build settings automatically.
3. Every push to `main` redeploys the Worker -- same pattern as your existing
   TED MCP Worker.

## 4. Connect it to Claude (or another MCP client)

Since this server has no auth, connect via the `mcp-remote` local proxy. In
Claude Desktop's config (Settings -> Developer -> Edit Config):

```json
{
  "mcpServers": {
    "worldbank-procurement": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://worldbank-procurement-mcp.<your-account>.workers.dev/mcp"
      ]
    }
  }
}
```

Restart Claude Desktop, then ask it to search World Bank notices for a
country or keyword.

If you're connecting through the same Slack/Claude-Tag MCP setup you used
for the TED tool, register this Worker's `/mcp` URL there instead.

## 5. Adding more tools later

Add another `server.registerTool(...)` call inside `createServer()` in
`src/index.ts`. Since this server is stateless (no Durable Object, no
session), every tool call is a fresh fetch to the World Bank API -- no
extra state management needed. Push to `main` (or run `wrangler deploy`)
to ship the change.

## Notes

- No secrets or environment variables are required -- the World Bank API is
  open. If you later add other data sources that need keys, set them with
  `npx wrangler secret put <NAME>`.
- `compatibility_date` in `wrangler.jsonc` is pinned to 2026-07-30; bump it
  periodically per Cloudflare's Workers changelog.
