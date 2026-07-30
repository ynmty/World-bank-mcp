import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

const WB_BASE = "https://search.worldbank.org/api/v2/procnotices";

/**
 * World Bank notice_text fields are raw HTML fragments. This strips tags and
 * decodes the handful of HTML entities that show up most often in practice,
 * then collapses whitespace so the result is readable plain text for an LLM.
 */
function cleanHtml(html: string | undefined): string {
  if (!html) return "";
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&rsquo;|&lsquo;/g, "'")
    .replace(/&rdquo;|&ldquo;/g, '"')
    .replace(/&eacute;/g, "é")
    .replace(/&egrave;/g, "è")
    .replace(/&iacute;/g, "í")
    .replace(/&oacute;/g, "ó")
    .replace(/&aacute;/g, "á")
    .replace(/&ntilde;/g, "ñ")
    .replace(/&ccedil;/g, "ç")
    .replace(/&ndash;/g, "-")
    .replace(/&mdash;/g, "-")
    .replace(/&ordm;/g, "º")
    .replace(/&deg;/g, "°")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

interface WbApiResponse {
  rows: string;
  os: string;
  page: string;
  total: string;
  procnotices?: Record<string, unknown> | unknown[];
}

/**
 * Calls the World Bank Procurement Notices API. This endpoint is free and
 * requires no API key or auth (verified live). Documented query parameters
 * such as `qterm`, `project_ctry_name`, `sector_exact`, and
 * `procurement_method_code` come from third-party reverse-engineering of the
 * endpoint, not an official Cloudflare/World Bank spec -- treat filtering
 * behavior as unverified until you've tested it against this deployed
 * server, and fall back to client-side filtering over `qterm`-less results
 * if a given parameter turns out not to narrow results server-side.
 */
async function wbFetch(
  params: Record<string, string | number | undefined>,
): Promise<WbApiResponse> {
  const url = new URL(WB_BASE);
  url.searchParams.set("format", "json");
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": "worldbank-procurement-mcp/1.0" },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`World Bank API returned ${res.status}: ${body.slice(0, 300)}`);
  }

  return (await res.json()) as WbApiResponse;
}

function normalizeNotices(data: WbApiResponse) {
  const raw = data.procnotices;
  const list: any[] = Array.isArray(raw) ? raw : raw ? Object.values(raw) : [];

  return list
    .filter((n) => n && typeof n === "object")
    .map((n: any) => ({
      id: n.id,
      type: n.notice_type,
      status: n.notice_status,
      noticeDate: n.noticedate,
      country: n.project_ctry_name,
      projectId: n.project_id,
      projectName: n.project_name,
      bidReference: n.bid_reference_no,
      description: n.bid_description,
      procurementGroup: n.procurement_group,
      procurementMethod: n.procurement_method_name,
      submissionDeadlineDate: n.submission_deadline_date,
      submissionDeadlineTime: n.submission_deadline_time,
      language: n.notice_lang_name,
      contactOrganization: n.contact_organization,
      contactEmail: n.contact_email,
      contactCountry: n.contact_ctry_name,
      summary: cleanHtml(n.notice_text).slice(0, 800),
    }));
}

function createServer() {
  const server = new McpServer({
    name: "worldbank-procurement-mcp",
    version: "1.0.0",
  });

  server.registerTool(
    "search_wb_notices",
    {
      description:
        "Search World Bank-financed public procurement notices worldwide -- General/Specific Procurement Notices, Requests for Expression of Interest, Invitations for Bids, and Contract Awards. Free, no API key required. Source: search.worldbank.org/api/v2/procnotices.",
      inputSchema: {
        qterm: z
          .string()
          .optional()
          .describe(
            "Free-text keyword search (e.g. 'artificial intelligence', 'chatbot', 'irrigation'). Matches title, description, project name, and other core fields. Server-side filtering behavior for this param is unverified -- if results look unfiltered, fall back to fetching a larger page and filtering client-side on the `summary`/`description` fields.",
          ),
        countryName: z
          .string()
          .optional()
          .describe("Filter by project country, e.g. 'Kenya', 'India', 'Indonesia'."),
        noticeType: z
          .enum([
            "General Procurement Notice",
            "Specific Procurement Notice",
            "Contract Award",
            "Request for Expression of Interest",
            "Invitation for Bids",
          ])
          .optional()
          .describe("Filter by notice type."),
        sector: z
          .string()
          .optional()
          .describe(
            "Filter by sector, e.g. 'Information and Communications Technologies', 'Energy', 'Transportation', 'Health'.",
          ),
        procurementMethodCode: z
          .string()
          .optional()
          .describe("Filter by procurement method code, e.g. 'ICB', 'NCB', 'QCBS', 'RFB', 'RFQ', 'DIR', 'LCS'."),
        rows: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Number of results to return (default 10, max 50)."),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Pagination offset (default 0)."),
      },
    },
    async ({ qterm, countryName, noticeType, sector, procurementMethodCode, rows, offset }) => {
      const data = await wbFetch({
        qterm,
        project_ctry_name: countryName,
        notice_type_exact: noticeType,
        sector_exact: sector,
        procurement_method_code: procurementMethodCode,
        rows: rows ?? 10,
        os: offset ?? 0,
      });

      const notices = normalizeNotices(data);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                total: data.total,
                returned: notices.length,
                offset: data.os,
                notices,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_wb_notice",
    {
      description:
        "Fetch full details for a single World Bank procurement notice by its ID (e.g. 'OP00458210').",
      inputSchema: {
        id: z.string().describe("The World Bank notice ID, e.g. 'OP00458210'."),
      },
    },
    async ({ id }) => {
      const data = await wbFetch({ id });
      const notices = normalizeNotices(data);
      const notice = notices.find((n) => n.id === id) ?? notices[0];

      if (!notice) {
        return {
          content: [{ type: "text", text: `No notice found with id ${id}.` }],
          isError: true,
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(notice, null, 2) }],
      };
    },
  );

  return server;
}

export default {
  fetch(request: Request, env: unknown, ctx: ExecutionContext) {
    return createMcpHandler(createServer)(request, env, ctx);
  },
} satisfies ExportedHandler;
