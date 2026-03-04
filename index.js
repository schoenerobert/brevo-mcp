/**
 * Brevo MCP Server v3 - Streamable HTTP (same pattern as HubSpot MCP)
 * Plain JSON-RPC POST on /mcp → calls Brevo REST API directly
 */
const express = require('express');
const app = express();
app.use(express.json({ limit: '5mb' }));

const BREVO_API = 'https://api.brevo.com/v3';
const API_KEY = process.env.BREVO_API_KEY || '';
const PORT = process.env.PORT || 3000;

async function brevo(method, path, body = null) {
  const res = await fetch(`${BREVO_API}${path}`, {
    method,
    headers: { 'api-key': API_KEY, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`Brevo ${method} ${path}: ${res.status} ${await res.text()}`);
  if (res.status === 204) return { success: true };
  return res.json();
}

const TOOLS = [
  { name: 'get_account', description: 'Get Brevo account info, plan and credits.', inputSchema: { type: 'object', properties: {}, required: [] } },
  { name: 'get_contacts', description: 'List contacts. Optional: limit, offset, email search.', inputSchema: { type: 'object', properties: { limit: { type: 'number' }, offset: { type: 'number' } }, required: [] } },
  { name: 'get_contact', description: 'Get a contact by email.', inputSchema: { type: 'object', properties: { email: { type: 'string' } }, required: ['email'] } },
  { name: 'create_contact', description: 'Create a new contact in Brevo.', inputSchema: { type: 'object', properties: { email: { type: 'string' }, firstName: { type: 'string' }, lastName: { type: 'string' }, listIds: { type: 'array', items: { type: 'number' } } }, required: ['email'] } },
  { name: 'update_contact', description: 'Update a contact by email.', inputSchema: { type: 'object', properties: { email: { type: 'string' }, firstName: { type: 'string' }, lastName: { type: 'string' }, listIds: { type: 'array', items: { type: 'number' } } }, required: ['email'] } },
  { name: 'delete_contact', description: 'Delete a contact by email.', inputSchema: { type: 'object', properties: { email: { type: 'string' } }, required: ['email'] } },
  { name: 'get_lists', description: 'Get all contact lists.', inputSchema: { type: 'object', properties: {}, required: [] } },
  { name: 'send_transactional_email', description: 'Send a transactional email via Brevo.', inputSchema: { type: 'object', properties: { to: { type: 'array', items: { type: 'object', properties: { email: { type: 'string' }, name: { type: 'string' } }, required: ['email'] } }, subject: { type: 'string' }, htmlContent: { type: 'string' }, textContent: { type: 'string' }, senderName: { type: 'string' }, senderEmail: { type: 'string' } }, required: ['to', 'subject'] } },
  { name: 'get_email_campaigns', description: 'List email campaigns. Optional: status (draft/sent/archive/queued/suspended/in_process)', inputSchema: { type: 'object', properties: { status: { type: 'string' }, limit: { type: 'number' }, offset: { type: 'number' } }, required: [] } },
  { name: 'get_campaign', description: 'Get details of a specific email campaign by ID.', inputSchema: { type: 'object', properties: { campaignId: { type: 'number' } }, required: ['campaignId'] } },
  { name: 'create_email_campaign', description: 'Create a new email campaign.', inputSchema: { type: 'object', properties: { name: { type: 'string' }, subject: { type: 'string' }, htmlContent: { type: 'string' }, senderName: { type: 'string' }, senderEmail: { type: 'string' }, listIds: { type: 'array', items: { type: 'number' } }, scheduledAt: { type: 'string', description: 'ISO date string, optional' } }, required: ['name', 'subject', 'htmlContent', 'senderName', 'senderEmail', 'listIds'] } },
  { name: 'send_campaign_now', description: 'Send an email campaign immediately.', inputSchema: { type: 'object', properties: { campaignId: { type: 'number' } }, required: ['campaignId'] } },
  { name: 'get_senders', description: 'Get all verified senders.', inputSchema: { type: 'object', properties: {}, required: [] } },
  { name: 'get_templates', description: 'Get all email templates.', inputSchema: { type: 'object', properties: {}, required: [] } },
  { name: 'create_list', description: 'Create a new contact list in Brevo.', inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'List name' }, folderId: { type: 'number', description: 'Folder ID (default: 1)' } }, required: ['name'] } },
  { name: 'delete_list', description: 'Delete a contact list by ID.', inputSchema: { type: 'object', properties: { listId: { type: 'number' } }, required: ['listId'] } },
  { name: 'add_contacts_to_list', description: 'Add contacts to a list by email addresses.', inputSchema: { type: 'object', properties: { listId: { type: 'number' }, emails: { type: 'array', items: { type: 'string' } } }, required: ['listId', 'emails'] } },
  { name: 'remove_contacts_from_list', description: 'Remove contacts from a list by email addresses.', inputSchema: { type: 'object', properties: { listId: { type: 'number' }, emails: { type: 'array', items: { type: 'string' } } }, required: ['listId', 'emails'] } },
];

async function executeTool(name, args) {
  switch (name) {
    case 'get_account': return brevo('GET', '/account');
    case 'get_contacts': return brevo('GET', `/contacts?limit=${args.limit||50}&offset=${args.offset||0}`);
    case 'get_contact': return brevo('GET', `/contacts/${encodeURIComponent(args.email)}`);
    case 'create_contact': return brevo('POST', '/contacts', {
      email: args.email,
      attributes: { FIRSTNAME: args.firstName, LASTNAME: args.lastName },
      ...(args.listIds ? { listIds: args.listIds } : {}),
    });
    case 'update_contact': return brevo('PUT', `/contacts/${encodeURIComponent(args.email)}`, {
      attributes: { FIRSTNAME: args.firstName, LASTNAME: args.lastName },
      ...(args.listIds ? { listIds: args.listIds } : {}),
    });
    case 'delete_contact': return brevo('DELETE', `/contacts/${encodeURIComponent(args.email)}`);
    case 'get_lists': return brevo('GET', '/contacts/lists?limit=50');
    case 'send_transactional_email': return brevo('POST', '/smtp/email', {
      sender: { name: args.senderName || 'aidocr', email: args.senderEmail || 'noreply@aidocr.com' },
      to: args.to,
      subject: args.subject,
      ...(args.htmlContent ? { htmlContent: args.htmlContent } : {}),
      ...(args.textContent ? { textContent: args.textContent } : {}),
    });
    case 'get_email_campaigns': return brevo('GET', `/emailCampaigns?limit=${args.limit||50}&offset=${args.offset||0}${args.status?'&status='+args.status:''}`);
    case 'get_campaign': return brevo('GET', `/emailCampaigns/${args.campaignId}`);
    case 'create_email_campaign': return brevo('POST', '/emailCampaigns', {
      name: args.name, subject: args.subject, htmlContent: args.htmlContent,
      sender: { name: args.senderName, email: args.senderEmail },
      recipients: { listIds: args.listIds },
      ...(args.scheduledAt ? { scheduledAt: args.scheduledAt } : {}),
    });
    case 'send_campaign_now': return brevo('POST', `/emailCampaigns/${args.campaignId}/sendNow`);
    case 'get_senders': return brevo('GET', '/senders');
    case 'get_templates': return brevo('GET', '/smtp/templates?limit=50');
    case 'create_list': return brevo('POST', '/contacts/lists', { name: args.name, folderId: args.folderId || 1 });
    case 'delete_list': return brevo('DELETE', `/contacts/lists/${args.listId}`);
    case 'add_contacts_to_list': return brevo('POST', `/contacts/lists/${args.listId}/contacts/add`, { emails: args.emails });
    case 'remove_contacts_from_list': return brevo('POST', `/contacts/lists/${args.listId}/contacts/remove`, { emails: args.emails });
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

app.post('/mcp', async (req, res) => {
  const { method, params, id } = req.body;
  try {
    if (method === 'initialize') {
      return res.json({ jsonrpc: '2.0', id, result: {
        protocolVersion: params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'brevo-mcp', version: '3.0.0' }
      }});
    }
    if (['notifications/initialized', 'ping'].includes(method))
      return res.json({ jsonrpc: '2.0', id, result: {} });
    if (method === 'tools/list')
      return res.json({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    if (method === 'tools/call') {
      const result = await executeTool(params?.name, params?.arguments || {});
      return res.json({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } });
    }
    res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
  } catch (err) {
    res.json({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true } });
  }
});

app.get('/health', (_, res) => res.json({ status: 'ok', server: 'brevo-mcp', version: '3.0.0' }));
app.listen(PORT, () => console.log(`Brevo MCP v3 on port ${PORT}`));
