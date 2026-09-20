# Obsidian AI Studio

Local AI workspace with:

- Qwen 3.5 9B through Ollama as the default model.
- NVIDIA models through NVIDIA's OpenAI-compatible API.
- Streaming responses for the fast local path.
- Fast / Think / Deep reasoning modes.
- MCP connector manager using the current Model Context Protocol TypeScript client.
- Tool discovery and model tool-calling loops.
- Optional Save-to-Obsidian vault button.

## Install

In the project folder:

```powershell
npm install
```

Create `.env` from `.env.example` and put in your NVIDIA key.

Then:

```powershell
npm start
```

Open:

http://localhost:3000

## Ollama

Make sure Ollama is running and that the model exists:

```powershell
ollama list
```

The app uses `qwen3.5:9b` by default.

## MCP

Open **Connectors** in the app, add an MCP Streamable HTTP URL, and enable tool access.

The app tries Streamable HTTP first and falls back to legacy SSE for older servers.

Only enable connectors you trust. MCP tools can perform actions outside this application depending on the server.
