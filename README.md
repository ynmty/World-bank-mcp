# worldbank-procurement-mcp

A remote MCP (Model Context Protocol) server exposing the World Bank's free
Procurement Notices API (`search.worldbank.org/api/v2/procnotices`) as tools
an AI agent can call. No API key needed on the World Bank side.

## What was broken in the previous version, and the fix

The first deploy returned `-32603 Internal server error` on every request,
failing in ~1ms of CPU time -- too fast to have even reached a fetch call.
Root cause, confirmed against `@modelcontextprotocol/server`'s actual
changelog:

1. **`inputSchema` was a bare object** (`{ name: z.string() }`) instead of a
   full Standard Schema instance (`z.object({ name: z.string() })`). Cloudflare's
   own docs example uses the bare-object form, but the SDK's real behavior
   (per its changelog, PR #1689 "Support Standard Schema for tool and prompt
   schemas") requires a complete schema object. The bare form throws the
   moment the tool is registered -- which matches the instant, pre-fetch
   failure exactly. **Fixed**: every `inputSchema` in `src/index.ts` now uses
   `z.object({...})`.
2. **Zod was pinned to v3** (`^3.23.8`); the SDK requires **Zod v4** for
   Standard Schema support. **Fixed**: `zod` is now pinned to `^4.4.3`.
3. **Versions were floating or nonexistent.** `agents` was `"latest"` (drift
   risk), and `@modelcontextprotocol/server@2.0.0` doesn't actually exist as
   a stable release -- the real latest is the alpha line. **Fixed**: both are
   now pinned to exact, verified-published versions:
   `agents@0.17.4`, `@modelcontextprotocol/server@2.0.0-alpha.2`.

Also added: a try/catch around the handler that logs the real JS error to
Observability/`wrangler tail` before responding, and a friendly plain-text
response at `/` instead of a bare 404, so future debugging is faster.

**Honesty check:** `@modelcontextprotocol/server` is still an alpha package
("expect breaking changes until v2 stabilizes" per its own README) and
Cloudflare's `createMcpHandler` pattern is only days old. I've verified every
version and API detail above against the SDK's real changelog and Cloudflare's
current docs, and this should deploy cleanly -- but I can't execute or test
it myself (no network access in my environment), so "perfectly" is my best
verified effort, not a guarantee against a dependency shipping another
breaking change after this was written.

## Tools exposed

- **`search_wb_notices`** -- keyword + filter search (country, sector,
  notice type, procurement method), paginated.
- **`get_wb_notice`** -- full detail for one notice by ID.

## Deploying from a computer

```bash
unzip worldbank-procurement-mcp.zip
cd worldbank-procurement-mcp
npm install
npm start          # local dev server + MCP Inspector to test first
npx wrangler login
npx wrangler deploy
```

Test locally before deploying:

```bash
npx @modelcontextprotocol/inspector@latest
```
Point it at `http://localhost:8788/mcp`, Connect, List Tools.

## Deploying from your phone only

If you don't have a computer handy, this replaces the existing
`world-bank-mcp` Worker's code without touching a terminal:

1. On github.com (mobile browser), open the repo backing your Worker.
2. Tap into `package.json`, tap the pencil (edit) icon, delete the contents,
   paste in the new `package.json` from this zip, commit to `main`.
3. Repeat for `src/index.ts` (the big one -- this is the actual fix),
   `wrangler.jsonc`, `tsconfig.json`, and `.gitignore`.
4. If your Worker is connected to this repo for auto-deploy (check
   **Workers & Pages → world-bank-mcp → Settings → Build**), each commit to
   `main` redeploys automatically -- watch **Deployments** for the new one
   to go live.
5. If it's *not* connected to a repo yet: **Workers & Pages → world-bank-mcp
   → Settings → Build → Connect to Git**, pick this repo, and it'll deploy
   from there going forward.

Either way, after it redeploys, go back to the MCP playground and tap **Add**
on `https://world-bank-mcp.maksgstaad.workers.dev/mcp` again.

## Notes

- No secrets required -- the World Bank API is open.
- `compatibility_date` in `wrangler.jsonc` is pinned to 2026-07-30; bump it
  periodically per Cloudflare's Workers changelog.
- If this still fails after redeploying, check Observability again -- the
  new try/catch means you should now see the actual error message and stack
  trace in the log entry, not just a bare error code. Paste that back and
  I'll fix the real cause rather than guessing again.
