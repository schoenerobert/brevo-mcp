/**
 * Brevo MCP SSE Proxy v2
 * Pipes SSE stream from native Brevo MCP, injecting Bearer token
 */
const express = require('express');
const app = express();
app.use(express.json({ limit: '5mb' }));

const BREVO_MCP_BASE = 'https://mcp.brevo.com/v1/brevo/mcp';
const BREVO_TOKEN = process.env.BREVO_API_KEY || '';
const PORT = process.env.PORT || 3000;

// SSE endpoint - Claude connects here first
app.get('/sse', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const upstream = await fetch(BREVO_MCP_BASE, {
      headers: {
        'Accept': 'text/event-stream',
        'Authorization': `Bearer ${BREVO_TOKEN}`,
      },
    });

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();

    req.on('close', () => reader.cancel());

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value));
    }
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
  }
  res.end();
});

// Messages endpoint - Claude sends tool calls here
app.post('/messages', async (req, res) => {
  const sessionId = req.query.sessionId;
  try {
    const response = await fetch(`${BREVO_MCP_BASE}/messages${sessionId ? '?sessionId=' + sessionId : ''}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BREVO_TOKEN}`,
      },
      body: JSON.stringify(req.body),
    });
    const text = await response.text();
    res.status(response.status).send(text);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Also handle plain POST /mcp for polling clients
app.post('/mcp', async (req, res) => {
  try {
    const response = await fetch(BREVO_MCP_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BREVO_TOKEN}`,
        'Accept': 'application/json',
      },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.json({ jsonrpc: '2.0', id: req.body?.id ?? null, error: { code: -32603, message: err.message } });
  }
});

app.get('/health', (_, res) => res.json({ status: 'ok', server: 'brevo-proxy', version: '2.0' }));

app.listen(PORT, () => console.log(`Brevo SSE proxy on port ${PORT}`));
