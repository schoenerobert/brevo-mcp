import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";

const BREVO_API_KEY = process.env.BREVO_API_KEY || "";
const BASE_URL = "https://api.brevo.com/v3";
const PORT = process.env.PORT || 3000;

// ─── HTTP client ──────────────────────────────────────────────────────────────
async function brevo(
  method: string,
  path: string,
  body?: unknown
): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "api-key": BREVO_API_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Brevo API ${res.status}: ${text}`);
  }
  return text ? JSON.parse(text) : { success: true };
}

// ─── MCP Server ───────────────────────────────────────────────────────────────
const server = new McpServer({
  name: "brevo-mcp",
  version: "1.0.0",
});

// ── CONTACTS ──────────────────────────────────────────────────────────────────

server.tool(
  "get_contacts",
  "List all contacts in Brevo with optional filtering",
  {
    limit: z.number().optional().default(50).describe("Number of contacts (max 1000)"),
    offset: z.number().optional().default(0).describe("Pagination offset"),
    modifiedSince: z.string().optional().describe("Filter contacts modified since date (ISO 8601)"),
    listId: z.number().optional().describe("Filter contacts belonging to a specific list"),
    sort: z.enum(["asc", "desc"]).optional().default("desc"),
  },
  async ({ limit, offset, modifiedSince, listId, sort }) => {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
      sort: sort ?? "desc",
    });
    if (modifiedSince) params.set("modifiedSince", modifiedSince);
    if (listId) params.set("listId", String(listId));
    const data = await brevo("GET", `/contacts?${params}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "get_contact",
  "Get a specific contact by email or ID",
  {
    identifier: z.string().describe("Contact email address or numeric ID"),
  },
  async ({ identifier }) => {
    const data = await brevo("GET", `/contacts/${encodeURIComponent(identifier)}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "create_contact",
  "Create a new contact in Brevo",
  {
    email: z.string().optional().describe("Email address (required if no SMS)"),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    phone: z.string().optional().describe("Phone number (e.g. +49123456789)"),
    company: z.string().optional(),
    listIds: z.array(z.number()).optional().describe("List IDs to add contact to"),
    attributes: z.record(z.string(), z.unknown()).optional().describe("Additional Brevo attributes (e.g. JOBTITLE, COMPANY)"),
    updateEnabled: z.boolean().optional().default(false).describe("Update existing contact if found"),
  },
  async ({ email, firstName, lastName, phone, company, listIds, attributes, updateEnabled }) => {
    const attrs: Record<string, unknown> = { ...attributes };
    if (firstName) attrs["FIRSTNAME"] = firstName;
    if (lastName) attrs["LASTNAME"] = lastName;
    if (company) attrs["COMPANY"] = company;
    if (phone) attrs["SMS"] = phone;

    const body: Record<string, unknown> = {
      attributes: attrs,
      updateEnabled: updateEnabled ?? false,
    };
    if (email) body["email"] = email;
    if (listIds?.length) body["listIds"] = listIds;

    const data = await brevo("POST", "/contacts", body);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "update_contact",
  "Update an existing contact in Brevo",
  {
    identifier: z.string().describe("Contact email address or numeric ID"),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    company: z.string().optional(),
    phone: z.string().optional(),
    listIds: z.array(z.number()).optional().describe("Add to these list IDs"),
    unlinkListIds: z.array(z.number()).optional().describe("Remove from these list IDs"),
    attributes: z.record(z.string(), z.unknown()).optional().describe("Additional Brevo attributes"),
  },
  async ({ identifier, firstName, lastName, company, phone, listIds, unlinkListIds, attributes }) => {
    const attrs: Record<string, unknown> = { ...attributes };
    if (firstName) attrs["FIRSTNAME"] = firstName;
    if (lastName) attrs["LASTNAME"] = lastName;
    if (company) attrs["COMPANY"] = company;
    if (phone) attrs["SMS"] = phone;

    const body: Record<string, unknown> = { attributes: attrs };
    if (listIds?.length) body["listIds"] = listIds;
    if (unlinkListIds?.length) body["unlinkListIds"] = unlinkListIds;

    await brevo("PUT", `/contacts/${encodeURIComponent(identifier)}`, body);
    return { content: [{ type: "text", text: `Contact ${identifier} updated successfully.` }] };
  }
);

server.tool(
  "delete_contact",
  "Delete a contact from Brevo",
  {
    identifier: z.string().describe("Contact email address or numeric ID"),
  },
  async ({ identifier }) => {
    await brevo("DELETE", `/contacts/${encodeURIComponent(identifier)}`);
    return { content: [{ type: "text", text: `Contact ${identifier} deleted.` }] };
  }
);

// ── LISTS ─────────────────────────────────────────────────────────────────────

server.tool(
  "get_lists",
  "Get all contact lists in Brevo",
  {
    limit: z.number().optional().default(50),
    offset: z.number().optional().default(0),
  },
  async ({ limit, offset }) => {
    const data = await brevo("GET", `/contacts/lists?limit=${limit}&offset=${offset}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ── CRM DEALS ─────────────────────────────────────────────────────────────────

server.tool(
  "get_deals",
  "Get CRM deals from Brevo Sales CRM",
  {
    limit: z.number().optional().default(50),
    offset: z.number().optional().default(0),
    filters: z.string().optional().describe("Filter string e.g. filters[attributes.deal_name]=test"),
    sort: z.string().optional().describe("Sort field e.g. attributes.deal_value"),
    sortBy: z.enum(["asc", "desc"]).optional().default("desc"),
  },
  async ({ limit, offset, sort, sortBy }) => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset), sortBy: sortBy ?? "desc" });
    if (sort) params.set("sort", sort);
    const data = await brevo("GET", `/crm/deals?${params}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "get_deal",
  "Get a specific CRM deal by ID",
  {
    dealId: z.string().describe("Deal ID"),
  },
  async ({ dealId }) => {
    const data = await brevo("GET", `/crm/deals/${dealId}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "create_deal",
  "Create a new deal in Brevo Sales CRM",
  {
    name: z.string().describe("Deal name"),
    dealOwner: z.string().optional().describe("Owner email or ID"),
    pipeline: z.string().optional().describe("Pipeline ID (fetch via get_pipelines)"),
    dealStage: z.string().optional().describe("Stage ID within the pipeline"),
    amount: z.number().optional().describe("Deal value/amount"),
    closingDate: z.string().optional().describe("Expected closing date (YYYY-MM-DD)"),
    linkedContactIds: z.array(z.number()).optional().describe("Contact IDs to link"),
    linkedCompanyIds: z.array(z.string()).optional().describe("Company IDs to link"),
    attributes: z.record(z.string(), z.unknown()).optional().describe("Additional deal attributes"),
  },
  async ({ name, dealOwner, pipeline, dealStage, amount, closingDate, linkedContactIds, linkedCompanyIds, attributes }) => {
    const attrs: Record<string, unknown> = { ...attributes };
    if (dealOwner) attrs["deal_owner"] = dealOwner;
    if (pipeline) attrs["pipeline"] = pipeline;
    if (dealStage) attrs["deal_stage"] = dealStage;
    if (amount !== undefined) attrs["amount"] = amount;
    if (closingDate) attrs["closing_date"] = closingDate;

    const body: Record<string, unknown> = { name, attributes: attrs };
    if (linkedContactIds?.length) body["linkedContactIds"] = linkedContactIds;
    if (linkedCompanyIds?.length) body["linkedCompaniesIds"] = linkedCompanyIds;

    const data = await brevo("POST", "/crm/deals", body);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "update_deal",
  "Update an existing deal in Brevo Sales CRM",
  {
    dealId: z.string().describe("Deal ID"),
    name: z.string().optional(),
    dealOwner: z.string().optional(),
    pipeline: z.string().optional(),
    dealStage: z.string().optional(),
    amount: z.number().optional(),
    closingDate: z.string().optional(),
    linkedContactIds: z.array(z.number()).optional(),
    linkedCompanyIds: z.array(z.string()).optional(),
    attributes: z.record(z.string(), z.unknown()).optional(),
  },
  async ({ dealId, name, dealOwner, pipeline, dealStage, amount, closingDate, linkedContactIds, linkedCompanyIds, attributes }) => {
    const attrs: Record<string, unknown> = { ...attributes };
    if (dealOwner) attrs["deal_owner"] = dealOwner;
    if (pipeline) attrs["pipeline"] = pipeline;
    if (dealStage) attrs["deal_stage"] = dealStage;
    if (amount !== undefined) attrs["amount"] = amount;
    if (closingDate) attrs["closing_date"] = closingDate;

    const body: Record<string, unknown> = { attributes: attrs };
    if (name) body["name"] = name;
    if (linkedContactIds?.length) body["linkedContactIds"] = linkedContactIds;
    if (linkedCompanyIds?.length) body["linkedCompaniesIds"] = linkedCompanyIds;

    await brevo("PATCH", `/crm/deals/${dealId}`, body);
    return { content: [{ type: "text", text: `Deal ${dealId} updated successfully.` }] };
  }
);

server.tool(
  "delete_deal",
  "Delete a deal from Brevo Sales CRM",
  {
    dealId: z.string().describe("Deal ID"),
  },
  async ({ dealId }) => {
    await brevo("DELETE", `/crm/deals/${dealId}`);
    return { content: [{ type: "text", text: `Deal ${dealId} deleted.` }] };
  }
);

// ── PIPELINES ─────────────────────────────────────────────────────────────────

server.tool(
  "get_pipelines",
  "Get all CRM pipelines and their stages",
  {},
  async () => {
    const data = await brevo("GET", "/crm/pipeline/details/all");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ── COMPANIES ─────────────────────────────────────────────────────────────────

server.tool(
  "get_companies",
  "Get CRM companies from Brevo",
  {
    limit: z.number().optional().default(50),
    offset: z.number().optional().default(0),
    filters: z.string().optional().describe("Filter by attribute e.g. filters[attributes.name]=ACME"),
    sort: z.string().optional(),
    sortBy: z.enum(["asc", "desc"]).optional().default("desc"),
  },
  async ({ limit, offset, sort, sortBy }) => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset), sortBy: sortBy ?? "desc" });
    if (sort) params.set("sort", sort);
    const data = await brevo("GET", `/crm/companies?${params}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "create_company",
  "Create a new company in Brevo CRM",
  {
    name: z.string().describe("Company name"),
    website: z.string().optional(),
    phone: z.string().optional(),
    linkedContactIds: z.array(z.number()).optional(),
    linkedDealsIds: z.array(z.string()).optional(),
    attributes: z.record(z.string(), z.unknown()).optional().describe("Additional company attributes"),
  },
  async ({ name, website, phone, linkedContactIds, linkedDealsIds, attributes }) => {
    const attrs: Record<string, unknown> = { ...attributes };
    if (website) attrs["website"] = website;
    if (phone) attrs["phone_number"] = phone;

    const body: Record<string, unknown> = { name, attributes: attrs };
    if (linkedContactIds?.length) body["linkedContactIds"] = linkedContactIds;
    if (linkedDealsIds?.length) body["linkedDealsIds"] = linkedDealsIds;

    const data = await brevo("POST", "/crm/companies", body);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "update_company",
  "Update a company in Brevo CRM",
  {
    companyId: z.string().describe("Company ID"),
    name: z.string().optional(),
    website: z.string().optional(),
    phone: z.string().optional(),
    linkedContactIds: z.array(z.number()).optional(),
    linkedDealsIds: z.array(z.string()).optional(),
    attributes: z.record(z.string(), z.unknown()).optional(),
  },
  async ({ companyId, name, website, phone, linkedContactIds, linkedDealsIds, attributes }) => {
    const attrs: Record<string, unknown> = { ...attributes };
    if (website) attrs["website"] = website;
    if (phone) attrs["phone_number"] = phone;

    const body: Record<string, unknown> = { attributes: attrs };
    if (name) body["name"] = name;
    if (linkedContactIds?.length) body["linkedContactIds"] = linkedContactIds;
    if (linkedDealsIds?.length) body["linkedDealsIds"] = linkedDealsIds;

    await brevo("PATCH", `/crm/companies/${companyId}`, body);
    return { content: [{ type: "text", text: `Company ${companyId} updated.` }] };
  }
);

// ── CRM NOTES & TASKS ─────────────────────────────────────────────────────────

server.tool(
  "create_note",
  "Create a note in Brevo CRM linked to contacts/deals/companies",
  {
    text: z.string().describe("Note content"),
    contactIds: z.array(z.number()).optional(),
    dealIds: z.array(z.string()).optional(),
    companyIds: z.array(z.string()).optional(),
  },
  async ({ text, contactIds, dealIds, companyIds }) => {
    const body: Record<string, unknown> = { note: text };
    if (contactIds?.length) body["contactIds"] = contactIds;
    if (dealIds?.length) body["dealIds"] = dealIds;
    if (companyIds?.length) body["companyIds"] = companyIds;
    const data = await brevo("POST", "/crm/notes", body);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "create_task",
  "Create a task in Brevo CRM",
  {
    name: z.string().describe("Task name/title"),
    taskTypeId: z.string().describe("Task type ID (fetch types via get_task_types)"),
    dueDate: z.string().describe("Due date ISO 8601"),
    done: z.boolean().optional().default(false),
    assignToId: z.string().optional().describe("Assign to user ID"),
    contactIds: z.array(z.number()).optional(),
    dealIds: z.array(z.string()).optional(),
    companyIds: z.array(z.string()).optional(),
    note: z.string().optional().describe("Task notes"),
    duration: z.number().optional().describe("Duration in minutes"),
  },
  async ({ name, taskTypeId, dueDate, done, assignToId, contactIds, dealIds, companyIds, note, duration }) => {
    const body: Record<string, unknown> = {
      name,
      taskTypeId,
      date: dueDate,
      done: done ?? false,
    };
    if (assignToId) body["assignToId"] = assignToId;
    if (contactIds?.length) body["contactIds"] = contactIds;
    if (dealIds?.length) body["dealIds"] = dealIds;
    if (companyIds?.length) body["companyIds"] = companyIds;
    if (note) body["note"] = note;
    if (duration) body["duration"] = duration;

    const data = await brevo("POST", "/crm/tasks", body);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "get_tasks",
  "Get CRM tasks from Brevo",
  {
    limit: z.number().optional().default(50),
    offset: z.number().optional().default(0),
    done: z.boolean().optional().describe("Filter by completion status"),
    contactId: z.string().optional(),
    dealId: z.string().optional(),
  },
  async ({ limit, offset, done, contactId, dealId }) => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (done !== undefined) params.set("filterBy[done]", String(done));
    if (contactId) params.set("filterBy[contactIds]", contactId);
    if (dealId) params.set("filterBy[dealIds]", dealId);
    const data = await brevo("GET", `/crm/tasks?${params}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "get_task_types",
  "Get available task types in Brevo CRM",
  {},
  async () => {
    const data = await brevo("GET", "/crm/tasktypes");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ── EMAIL CAMPAIGNS ───────────────────────────────────────────────────────────

server.tool(
  "get_email_campaigns",
  "Get all email campaigns from Brevo",
  {
    type: z.enum(["classic", "trigger"]).optional().default("classic"),
    status: z.enum(["draft", "sent", "archive", "queued", "suspended", "in_process"]).optional(),
    limit: z.number().optional().default(50),
    offset: z.number().optional().default(0),
    sort: z.enum(["asc", "desc"]).optional().default("desc"),
  },
  async ({ type, status, limit, offset, sort }) => {
    const params = new URLSearchParams({ type: type ?? "classic", limit: String(limit), offset: String(offset), sort: sort ?? "desc" });
    if (status) params.set("status", status);
    const data = await brevo("GET", `/emailCampaigns?${params}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "get_campaign_stats",
  "Get statistics for a specific email campaign",
  {
    campaignId: z.number().describe("Email campaign ID"),
  },
  async ({ campaignId }) => {
    const data = await brevo("GET", `/emailCampaigns/${campaignId}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ── TRANSACTIONAL EMAIL ───────────────────────────────────────────────────────

server.tool(
  "send_transactional_email",
  "Send a transactional email via Brevo",
  {
    to: z.array(z.object({ email: z.string(), name: z.string().optional() })).describe("Recipient(s)"),
    subject: z.string(),
    htmlContent: z.string().optional().describe("HTML email body"),
    textContent: z.string().optional().describe("Plain text email body"),
    senderName: z.string().optional().default("aidocr"),
    senderEmail: z.string().optional().describe("Verified sender email"),
    templateId: z.number().optional().describe("Brevo template ID (overrides html/text content)"),
    params: z.record(z.string(), z.unknown()).optional().describe("Template parameters"),
    replyTo: z.string().optional(),
    cc: z.array(z.object({ email: z.string(), name: z.string().optional() })).optional(),
    bcc: z.array(z.object({ email: z.string(), name: z.string().optional() })).optional(),
    tags: z.array(z.string()).optional(),
  },
  async ({ to, subject, htmlContent, textContent, senderName, senderEmail, templateId, params, replyTo, cc, bcc, tags }) => {
    const body: Record<string, unknown> = {
      to,
      subject,
      sender: { name: senderName ?? "aidocr", email: senderEmail },
    };
    if (htmlContent) body["htmlContent"] = htmlContent;
    if (textContent) body["textContent"] = textContent;
    if (templateId) body["templateId"] = templateId;
    if (params) body["params"] = params;
    if (replyTo) body["replyTo"] = { email: replyTo };
    if (cc?.length) body["cc"] = cc;
    if (bcc?.length) body["bcc"] = bcc;
    if (tags?.length) body["tags"] = tags;

    const data = await brevo("POST", "/smtp/email", body);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ── ACCOUNT ───────────────────────────────────────────────────────────────────

server.tool(
  "get_account",
  "Get Brevo account information and usage stats",
  {},
  async () => {
    const data = await brevo("GET", "/account");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "get_senders",
  "Get all verified senders in Brevo account",
  {},
  async () => {
    const data = await brevo("GET", "/senders");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "get_email_templates",
  "Get all email templates from Brevo",
  {
    limit: z.number().optional().default(50),
    offset: z.number().optional().default(0),
  },
  async ({ limit, offset }) => {
    const data = await brevo("GET", `/smtp/templates?limit=${limit}&offset=${offset}&sort=desc`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ─── Express + SSE Transport ──────────────────────────────────────────────────
const app = express();
app.use(express.json());

const transports = new Map<string, SSEServerTransport>();

app.get("/sse", async (req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  transports.set(transport.sessionId, transport);
  res.on("close", () => transports.delete(transport.sessionId));
  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const transport = transports.get(sessionId);
  if (!transport) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  await transport.handlePostMessage(req, res);
});

app.get("/health", (_, res) => res.json({ status: "ok", server: "brevo-mcp", version: "1.0.0" }));

app.listen(PORT, () => {
  console.log(`🚀 Brevo MCP Server running on port ${PORT}`);
  console.log(`   SSE endpoint: http://localhost:${PORT}/sse`);
});
