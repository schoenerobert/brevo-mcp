/**
 * Brevo MCP Auth Proxy
 * Forwards requests to native Brevo MCP, injecting Bearer token
 */
const express = require('express');
const app = express();
app.use(express.json({ limit: '5mb' }));

const BREVO_MCP_URL = 'https://mcp.brevo.com/v1/brevo/mcp';
const BREVO_TOKEN = process.env.BREVO_API_KEY || '';
const PORT = process.env.PORT || 3000;

app.post('/mcp', async (req, res) => {
  try {
    const response = await fetch(BREVO_MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BREVO_TOKEN}`,
      },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.json({ jsonrpc: '2.0', id: req.body?.id ?? null, error: { code: -32603, message: err.message } });
  }
});

app.get('/health', (_, res) => res.json({ status: 'ok', server: 'brevo-proxy', target: BREVO_MCP_URL }));

app.listen(PORT, () => console.log(`Brevo proxy on port ${PORT}`));
