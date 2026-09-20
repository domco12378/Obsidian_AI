const path = require("path");
const fs = require("fs");
const http = require("http");
require("dotenv").config({
  path: path.join(__dirname, ".env")
});

const PORT = Number(process.env.PORT || 3000);
const OLLAMA_URL = "http://127.0.0.1:11434";
const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const CONNECTORS_FILE = path.join(__dirname, "connectors.json");

const NVIDIA_MODELS = [
  ["z-ai/glm-5.3-flash", "GLM 5.3 Flash"],
  ["z-ai/glm-5.3", "GLM 5.3"],
  ["z-ai/glm-5.2", "GLM 5.2"],
  ["qwen/qwen3.5-397b-a17b", "Qwen 3.5 397B"],
  ["qwen/qwen3.5-122b-a10b", "Qwen 3.5 122B"],
  ["qwen/qwen3-coder-480b-a35b-instruct", "Qwen 3 Coder 480B"],
  ["qwen/qwen3-next-80b-a3b-instruct", "Qwen 3 Next 80B"],
  ["deepseek-ai/deepseek-v4-flash", "DeepSeek V4 Flash"],
  ["deepseek-ai/deepseek-v4-pro", "DeepSeek V4 Pro"],
  ["nvidia/nemotron-3.5-lightning-30b-a3b", "Nemotron 3.5 Lightning 30B"],
  ["nvidia/nemotron-3-super-120b-a12b", "Nemotron 3 Super 120B"],
  ["nvidia/nemotron-3-ultra-550b-a55b", "Nemotron 3 Ultra 550B"],
  ["nvidia/llama-3.1-nemotron-ultra-253b-v1", "Nemotron Ultra 253B"],
  ["openai/gpt-oss-120b", "GPT-OSS 120B"],
  ["minimaxai/minimax-m3", "MiniMax M3"],
  ["moonshotai/kimi-k3", "Kimi K3"]
];

const SETTINGS_FILE = path.join(__dirname, "settings.json");

function loadSettings() {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) {
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ vaultPath: "" }, null, 2), "utf8");
    }
    const value = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    return {
      vaultPath: typeof value.vaultPath === "string" ? value.vaultPath : ""
    };
  } catch {
    return { vaultPath: "" };
  }
}

function saveSettings(value) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(value, null, 2), "utf8");
}

const settings = loadSettings();

let mcpSdkPromise = null;
const mcpSessions = new Map();

function loadConnectors() {
  try {
    if (!fs.existsSync(CONNECTORS_FILE)) {
      fs.writeFileSync(CONNECTORS_FILE, "[]\n", "utf8");
    }
    const raw = fs.readFileSync(CONNECTORS_FILE, "utf8");
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function saveConnectors(connectors) {
  fs.writeFileSync(CONNECTORS_FILE, JSON.stringify(connectors, null, 2), "utf8");
}

function publicConnector(connector) {
  return {
    id: connector.id,
    name: connector.name,
    url: connector.url,
    enabled: Boolean(connector.enabled),
    connected: Boolean(connector.connected),
    toolCount: Number(connector.toolCount || 0),
    error: connector.error || ""
  };
}

function sanitizeFileName(name) {
  const cleaned = String(name || "AI Note")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.+$/, "");

  return (cleaned || "AI Note").slice(0, 120);
}

function ensureJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", chunk => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });

    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON."));
      }
    });

    req.on("error", reject);
  });
}

function sseHeaders(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
}

function sse(res, type, payload = {}) {
  res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
}

function buildSystemPrompt({ mode, toolsEnabled }) {
  const toolText = toolsEnabled
    ? `
MCP tools may be available.
Use tools when they materially help complete the request.
Do not call tools unnecessarily.
When using tools, keep the user informed by doing the action rather than only describing it.
`
    : "";

  const reasoningText = mode === "fast"
    ? "Prioritize speed. Do not spend extra effort on hidden reasoning."
    : mode === "think"
      ? "Use balanced reasoning for accuracy."
      : "Use deeper reasoning for difficult planning, coding, analysis, or multi-step work.";

  return `
You are Obsidian AI, a local-first personal assistant.

${reasoningText}

${toolText}

When producing notes for Obsidian:
- Prefer clean Markdown.
- Use headings, bullet lists, numbered lists, tables, and code blocks when useful.
- Keep explanations practical.
- Do not add fake citations or pretend to have browsed the web.
- If a requested fact needs live web information and no web/search tool is available, say that clearly.

The user is using this app as a private workspace.
`.trim();
}

function normalizeHistory(history, message) {
  const clean = Array.isArray(history)
    ? history.filter(item =>
        item &&
        (item.role === "user" || item.role === "assistant") &&
        typeof item.content === "string" &&
        item.content.trim()
      ).slice(-16).map(item => ({
        role: item.role,
        content: item.content.trim()
      }))
    : [];

  const last = clean.at(-1);
  if (!last || last.role !== "user" || last.content !== message) {
    clean.push({ role: "user", content: message });
  }
  return clean;
}

async function fetchOllamaModels() {
  const response = await fetch(`${OLLAMA_URL}/api/tags`, {
    signal: AbortSignal.timeout(4000)
  });

  if (!response.ok) throw new Error(`Ollama model list failed (${response.status})`);

  const data = await response.json();
  return (data.models || []).map(model => ({
    id: `ollama:${model.name}`,
    provider: "ollama",
    model: model.name,
    label: model.name
  }));
}

async function getModels() {
  let local = [];

  try {
    local = await fetchOllamaModels();
  } catch {
    local = [];
  }

  const nvidia = NVIDIA_MODELS.map(([model, label]) => ({
    id: `nvidia:${model}`,
    provider: "nvidia",
    model,
    label
  }));

  return [...local, ...nvidia];
}

async function loadMcpSdk() {
  if (!mcpSdkPromise) {
    mcpSdkPromise = Promise.all([
      import("@modelcontextprotocol/client"),
      import("@modelcontextprotocol/client/sse")
    ]).then(([core, sse]) => ({
      Client: core.Client,
      StreamableHTTPClientTransport: core.StreamableHTTPClientTransport,
      SSEClientTransport: sse.SSEClientTransport
    }));
  }
  return mcpSdkPromise;
}

function getConnector(id) {
  return loadConnectors().find(c => c.id === id);
}

async function connectMcp(connector) {
  const cached = mcpSessions.get(connector.id);
  if (cached?.client) {
    try {
      const listed = await cached.client.listTools();
      return { ...cached, tools: listed.tools || [] };
    } catch {
      try { await cached.client.close(); } catch {}
      mcpSessions.delete(connector.id);
    }
  }

  const { Client, StreamableHTTPClientTransport, SSEClientTransport } = await loadMcpSdk();
  const headers = connector.token
    ? { Authorization: `Bearer ${connector.token}` }
    : undefined;

  let client;
  let transport;

  try {
    client = new Client(
      { name: "Obsidian AI", version: "2.0.0" },
      { versionNegotiation: { mode: "auto" } }
    );

    transport = new StreamableHTTPClientTransport(new URL(connector.url), {
      requestInit: headers ? { headers } : undefined
    });

    await client.connect(transport);
  } catch (primaryError) {
    try { await client?.close(); } catch {}

    client = new Client(
      { name: "Obsidian AI", version: "2.0.0" }
    );

    transport = new SSEClientTransport(new URL(connector.url), {
      requestInit: headers ? { headers } : undefined
    });

    await client.connect(transport);
  }

  const listed = await client.listTools();

  const session = {
    client,
    transport,
    tools: listed.tools || []
  };

  mcpSessions.set(connector.id, session);
  return session;
}

async function testConnector(id) {
  const connectors = loadConnectors();
  const index = connectors.findIndex(c => c.id === id);
  if (index < 0) throw new Error("Connector not found.");

  try {
    const session = await connectMcp(connectors[index]);
    connectors[index].connected = true;
    connectors[index].toolCount = session.tools.length;
    connectors[index].error = "";
    saveConnectors(connectors);
    return connectors;
  } catch (error) {
    connectors[index].connected = false;
    connectors[index].toolCount = 0;
    connectors[index].error = error?.message || "Connection failed";
    saveConnectors(connectors);
    throw error;
  }
}

function getEnabledConnectors() {
  return loadConnectors().filter(c => c.enabled);
}

function prefixToolName(connectorId, toolName) {
  const a = String(connectorId).replace(/[^a-zA-Z0-9_]/g, "_");
  const b = String(toolName).replace(/[^a-zA-Z0-9_]/g, "_");
  return `mcp_${a}__${b}`.slice(0, 120);
}

async function collectTools() {
  const toolMap = new Map();
  const tools = [];
  const connectors = getEnabledConnectors();

  for (const connector of connectors) {
    try {
      const session = await connectMcp(connector);
      for (const tool of session.tools) {
        const modelToolName = prefixToolName(connector.id, tool.name);

        tools.push({
          type: "function",
          function: {
            name: modelToolName,
            description: `[${connector.name}] ${tool.description || tool.name}`.slice(0, 900),
            parameters: tool.inputSchema || {
              type: "object",
              properties: {}
            }
          }
        });

        toolMap.set(modelToolName, {
          connectorId: connector.id,
          originalName: tool.name
        });
      }
    } catch (error) {
      console.warn(`MCP connector ${connector.name} unavailable:`, error.message);
    }
  }

  return { tools, toolMap };
}

async function callMcpTool(toolName, args, toolMap) {
  const mapping = toolMap.get(toolName);
  if (!mapping) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  const connector = getConnector(mapping.connectorId);
  if (!connector || !connector.enabled) {
    throw new Error("That connector is disabled.");
  }

  const session = await connectMcp(connector);
  const result = await session.client.callTool({
    name: mapping.originalName,
    arguments: args || {}
  });

  const pieces = [];

  if (Array.isArray(result?.content)) {
    for (const item of result.content) {
      if (item?.type === "text") {
        pieces.push(item.text);
      } else if (item?.type === "resource") {
        pieces.push(JSON.stringify(item.resource));
      }
    }
  }

  if (!pieces.length && result?.structuredContent) {
    pieces.push(JSON.stringify(result.structuredContent, null, 2));
  }

  if (result?.isError) {
    pieces.unshift("MCP tool reported an error.");
  }

  return pieces.join("\n") || "(Tool returned no text.)";
}

function reasoningOptions(mode) {
  if (mode === "fast") {
    return { think: false, reasoning_effort: "low", max_tokens: 900 };
  }
  if (mode === "deep") {
    return { think: true, reasoning_effort: "max", max_tokens: 2400 };
  }
  return { think: true, reasoning_effort: "high", max_tokens: 1400 };
}

async function streamOllama({
  model,
  messages,
  mode,
  tools,
  toolMap,
  res,
  signal,
  status
}) {
  const options = reasoningOptions(mode);

  const body = {
    model,
    messages,
    stream: true,
    think: options.think
  };

  if (tools.length) body.tools = tools;

  let response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal
  });

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(raw || `Ollama request failed (${response.status}).`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let finalText = "";
  let thinking = "";
  const toolCalls = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;

      const chunk = JSON.parse(line);
      const message = chunk.message || {};

      if (message.thinking) {
        thinking += message.thinking;
        if (mode !== "fast" && !finalText) {
          status?.("Reasoning…");
        }
      }

      if (message.content) {
        finalText += message.content;
        sse(res, "delta", { text: message.content });
      }

      if (Array.isArray(message.tool_calls)) {
        toolCalls.push(...message.tool_calls);
      }
    }
  }

  if (!toolCalls.length || !tools.length) {
    return {
      text: finalText.trim(),
      messages
    };
  }

  messages.push({
    role: "assistant",
    content: finalText,
    ...(thinking ? { thinking } : {}),
    tool_calls: toolCalls
  });

  for (const call of toolCalls) {
    const toolName = call?.function?.name;
    const args = call?.function?.arguments || {};

    status?.(`Using ${toolName.replace(/^mcp_[^_]+__/, "")}…`);

    let resultText;

    try {
      resultText = await callMcpTool(toolName, args, toolMap);
    } catch (error) {
      resultText = `Tool error: ${error.message}`;
    }

    messages.push({
      role: "tool",
      tool_name: toolName,
      content: resultText
    });
  }

  const followup = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      think: options.think,
      tools
    }),
    signal
  });

  if (!followup.ok) {
    throw new Error(`Ollama follow-up failed (${followup.status}).`);
  }

  const followReader = followup.body.getReader();
  buffer = "";
  finalText = "";
  thinking = "";

  while (true) {
    const { value, done } = await followReader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;

      const chunk = JSON.parse(line);
      const message = chunk.message || {};

      if (message.thinking) {
        thinking += message.thinking;
        status?.("Finishing reasoning…");
      }

      if (message.content) {
        finalText += message.content;
        sse(res, "delta", { text: message.content });
      }
    }
  }

  return { text: finalText.trim(), messages };
}

async function nonStreamingOllama({
  model,
  messages,
  mode,
  tools,
  toolMap,
  res,
  signal,
  status
}) {
  const options = reasoningOptions(mode);

  let currentMessages = [...messages];
  let finalText = "";

  for (let round = 0; round < 5; round++) {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: currentMessages,
        stream: false,
        think: options.think,
        tools: tools.length ? tools : undefined
      }),
      signal
    });

    if (!response.ok) {
      const raw = await response.text();
      throw new Error(raw || `Ollama request failed (${response.status}).`);
    }

    const data = await response.json();
    const message = data?.message || {};

    currentMessages.push(message);

    if (message.tool_calls?.length) {
      for (const call of message.tool_calls) {
        status?.(`Using ${call.function.name.replace(/^mcp_[^_]+__/, "")}…`);

        let resultText;
        try {
          resultText = await callMcpTool(
            call.function.name,
            call.function.arguments || {},
            toolMap
          );
        } catch (error) {
          resultText = `Tool error: ${error.message}`;
        }

        currentMessages.push({
          role: "tool",
          tool_name: call.function.name,
          content: resultText
        });
      }
      continue;
    }

    finalText = String(message.content || "").trim();
    break;
  }

  if (!finalText) throw new Error("Ollama returned no answer.");

  sse(res, "delta", { text: finalText });
  return { text: finalText, messages: currentMessages };
}

async function callNvidia({
  model,
  messages,
  mode,
  tools,
  toolMap,
  res,
  signal,
  status
}) {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) throw new Error("NVIDIA_API_KEY is missing from .env.");

  const options = reasoningOptions(mode);
  let currentMessages = [...messages];

  for (let round = 0; round < 5; round++) {
    const response = await fetch(NVIDIA_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: currentMessages,
        stream: false,
        temperature: 0.35,
        reasoning_effort: options.reasoning_effort,
        clear_thinking: true,
        max_tokens: options.max_tokens,
        tools: tools.length ? tools : undefined,
        tool_choice: tools.length ? "auto" : undefined
      }),
      signal
    });

    const raw = await response.text();
    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(`NVIDIA returned invalid data (${response.status}).`);
    }

    if (!response.ok) {
      throw new Error(
        data?.error?.message ||
        data?.message ||
        `NVIDIA request failed (${response.status}).`
      );
    }

    const message = data?.choices?.[0]?.message;
    if (!message) throw new Error("NVIDIA returned no message.");

    currentMessages.push(message);

    if (message.tool_calls?.length) {
      for (const call of message.tool_calls) {
        status?.(`Using ${call.function?.name || "tool"}…`);

        let args = {};
        try {
          args = typeof call.function.arguments === "string"
            ? JSON.parse(call.function.arguments)
            : (call.function.arguments || {});
        } catch {
          args = {};
        }

        let resultText;
        try {
          resultText = await callMcpTool(
            call.function.name,
            args,
            toolMap
          );
        } catch (error) {
          resultText = `Tool error: ${error.message}`;
        }

        currentMessages.push({
          role: "tool",
          tool_call_id: call.id,
          content: resultText
        });
      }

      continue;
    }

    const finalText = String(message.content || "").trim();
    if (!finalText) throw new Error("NVIDIA returned an empty answer.");

    sse(res, "delta", { text: finalText });
    return { text: finalText, messages: currentMessages };
  }

  throw new Error("Tool loop exceeded the maximum number of rounds.");
}

async function generateChat({
  modelId,
  mode,
  toolsEnabled,
  history,
  message,
  res,
  signal
}) {
  const separator = modelId.indexOf(":");
  if (separator < 1) throw new Error("Invalid model selection.");

  const provider = modelId.slice(0, separator);
  const model = modelId.slice(separator + 1);

  const system = {
    role: "system",
    content: buildSystemPrompt({ mode, toolsEnabled })
  };

  const modelHistory = [
    system,
    ...history
  ];

  const toolBundle = toolsEnabled
    ? await collectTools()
    : { tools: [], toolMap: new Map() };

  if (toolsEnabled && !toolBundle.tools.length) {
    sse(res, "status", { message: "No enabled MCP tools were available." });
  }

  const status = messageText => sse(res, "status", { message: messageText });

  if (provider === "ollama") {
    if (toolBundle.tools.length) {
      return streamOllama({
        model,
        messages: modelHistory,
        mode,
        tools: toolBundle.tools,
        toolMap: toolBundle.toolMap,
        res,
        signal,
        status
      });
    }

    return streamOllama({
      model,
      messages: modelHistory,
      mode,
      tools: [],
      toolMap: toolBundle.toolMap,
      res,
      signal,
      status
    });
  }

  if (provider === "nvidia") {
    return callNvidia({
      model,
      messages: modelHistory,
      mode,
      tools: toolBundle.tools,
      toolMap: toolBundle.toolMap,
      res,
      signal,
      status
    });
  }

  throw new Error(`Unknown provider: ${provider}`);
}

async function handleChatStream(req, res) {
  const body = await readBody(req);

  const message = typeof body.message === "string"
    ? body.message.trim()
    : "";

  if (!message) {
    ensureJson(res, 400, { error: "Message cannot be empty." });
    return;
  }

  const model = typeof body.model === "string"
    ? body.model
    : "ollama:qwen3.5:9b";

  const mode = ["fast", "think", "deep"].includes(body.mode)
    ? body.mode
    : "fast";

  const toolsEnabled = Boolean(body.toolsEnabled);
  const history = normalizeHistory(body.history, message);

  let clientAborted = false;
  res.on("close", () => {
    if (!res.writableEnded) clientAborted = true;
  });

  const controller = new AbortController();
  const abortTimer = setInterval(() => {
    if (clientAborted) controller.abort();
  }, 200);

  sseHeaders(res);

  try {
    const result = await generateChat({
      modelId: model,
      mode,
      toolsEnabled,
      history,
      message,
      res,
      signal: controller.signal
    });

    if (!clientAborted) {
      sse(res, "done", {
        text: result.text,
        model
      });
      res.end();
    }
  } catch (error) {
    if (!clientAborted) {
      sse(res, "error", {
        error: error?.message || "AI request failed."
      });
      res.end();
    }
  } finally {
    clearInterval(abortTimer);
  }
}

async function serveStatic(req, res) {
  let requestPath = decodeURIComponent(req.url.split("?")[0]);

  if (requestPath === "/") requestPath = "/index.html";

  const root = path.resolve(__dirname);
  const filePath = path.resolve(path.join(root, requestPath.replace(/^\/+/, "")));

  if (!filePath.startsWith(root)) {
    ensureJson(res, 403, { error: "Forbidden" });
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const mime = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg"
  }[ext] || "application/octet-stream";

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }

    res.writeHead(200, {
      "Content-Type": mime,
      "Cache-Control": "no-cache"
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/api/models") {
      ensureJson(res, 200, { models: await getModels() });
      return;
    }

    if (req.method === "GET" && req.url === "/api/connectors") {
      ensureJson(res, 200, { connectors: loadConnectors().map(publicConnector) });
      return;
    }

    if (req.method === "POST" && req.url === "/api/connectors") {
      const body = await readBody(req);
      const name = String(body.name || "MCP Connector").trim().slice(0, 80);
      const url = String(body.url || "").trim();
      const token = String(body.token || "");

      if (!/^https?:\/\//i.test(url)) {
        ensureJson(res, 400, { error: "MCP URL must start with http:// or https://." });
        return;
      }

      const connector = {
        id: crypto.randomUUID(),
        name: name || "MCP Connector",
        url,
        token,
        enabled: false,
        connected: false,
        toolCount: 0,
        error: ""
      };

      const connectors = loadConnectors();
      connectors.push(connector);
      saveConnectors(connectors);

      try {
        await testConnector(connector.id);
      } catch {
        // Keep the connector saved so the user can fix/test it later.
      }

      ensureJson(res, 200, {
        connectors: loadConnectors().map(publicConnector)
      });
      return;
    }

    const connectorMatch = req.url.match(/^\/api\/connectors\/([^/]+)$/);

    if (connectorMatch && req.method === "PATCH") {
      const id = decodeURIComponent(connectorMatch[1]);
      const body = await readBody(req);
      const connectors = loadConnectors();
      const index = connectors.findIndex(c => c.id === id);

      if (index < 0) {
        ensureJson(res, 404, { error: "Connector not found." });
        return;
      }

      if (typeof body.enabled === "boolean") {
        connectors[index].enabled = body.enabled;
        if (!body.enabled) {
          const cached = mcpSessions.get(id);
          if (cached?.client) {
            try { await cached.client.close(); } catch {}
          }
          mcpSessions.delete(id);
        }
      }

      saveConnectors(connectors);
      ensureJson(res, 200, {
        connectors: connectors.map(publicConnector)
      });
      return;
    }

    const connectorTestMatch = req.url.match(/^\/api\/connectors\/([^/]+)\/test$/);

    if (connectorTestMatch && req.method === "POST") {
      const id = decodeURIComponent(connectorTestMatch[1]);
      const connectors = await testConnector(id);
      ensureJson(res, 200, {
        connectors: connectors.map(publicConnector)
      });
      return;
    }

    if (connectorMatch && req.method === "DELETE") {
      const id = decodeURIComponent(connectorMatch[1]);
      const connectors = loadConnectors();
      const index = connectors.findIndex(c => c.id === id);

      if (index < 0) {
        ensureJson(res, 404, { error: "Connector not found." });
        return;
      }

      const cached = mcpSessions.get(id);
      if (cached?.client) {
        try { await cached.client.close(); } catch {}
      }
      mcpSessions.delete(id);

      connectors.splice(index, 1);
      saveConnectors(connectors);

      ensureJson(res, 200, {
        connectors: connectors.map(publicConnector)
      });
      return;
    }

    if (req.method === "GET" && req.url === "/api/settings") {
      ensureJson(res, 200, { settings });
      return;
    }

    if (req.method === "POST" && req.url === "/api/settings") {
      const body = await readBody(req);
      settings.vaultPath = typeof body.vaultPath === "string"
        ? body.vaultPath.trim()
        : "";

      saveSettings(settings);

      ensureJson(res, 200, { settings });
      return;
    }

    if (req.method === "POST" && req.url === "/api/vault/save") {
      const body = await readBody(req);
      const title = sanitizeFileName(body.title || "AI Note");
      const content = typeof body.content === "string"
        ? body.content
        : "";

      if (!settings.vaultPath) {
        ensureJson(res, 400, {
          error: "Set your Obsidian vault folder in Settings first."
        });
        return;
      }

      const vault = path.resolve(settings.vaultPath);

      if (!fs.existsSync(vault)) {
        ensureJson(res, 400, {
          error: "That Obsidian vault folder does not exist."
        });
        return;
      }

      const target = path.resolve(vault, `${title}.md`);

      if (!target.startsWith(vault + path.sep)) {
        ensureJson(res, 400, { error: "Invalid note path." });
        return;
      }

      fs.writeFileSync(target, content.trimEnd() + "\n", "utf8");

      ensureJson(res, 200, {
        path: target
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/chat/stream") {
      await handleChatStream(req, res);
      return;
    }

    if (req.method === "GET") {
      await serveStatic(req, res);
      return;
    }

    res.writeHead(405);
    res.end("Method Not Allowed");
  } catch (error) {
    console.error("SERVER ERROR:", error);

    if (!res.headersSent) {
      ensureJson(res, 500, {
        error: error?.message || "Internal server error."
      });
    } else {
      try {
        res.end();
      } catch {}
    }
  }
});


  server.listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log("======================================");
  console.log("          OBSIDIAN AI STUDIO");
  console.log("======================================");
  console.log(`Open on PC: http://localhost:${PORT}`);
  console.log(`Open on network: http://YOUR-PC-IP:${PORT}`);
  console.log("Default: Ollama → qwen3.5:9b");
  console.log("");
});
