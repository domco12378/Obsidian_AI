const state = {
  model: "ollama:qwen3.5:9b",
  mode: "fast",
  toolsEnabled: false,
  models: [],
  connectors: [],
  chats: [],
  conversation: [],
  controller: null,
  currentChatId: null,
  settings: {}
};

const $ = (id) => document.getElementById(id);

const els = {
  sidebar: $("sidebar"),
  mobileMenuBtn: $("mobileMenuBtn"),
  newChatBtn: $("newChatBtn"),
  chatSearch: $("chatSearch"),
  chatList: $("chatList"),
  connectorCount: $("connectorCount"),
  connectorsBtn: $("connectorsBtn"),
  headerConnectorsBtn: $("headerConnectorsBtn"),
  settingsBtn: $("settingsBtn"),
  modelButton: $("modelButton"),
  modelPopover: $("modelPopover"),
  modelName: $("modelName"),
  modelProvider: $("modelProvider"),
  modelLogo: $("modelLogo"),
  modelSearch: $("modelSearch"),
  modelOptions: $("modelOptions"),
  modeButton: $("modeButton"),
  modePopover: $("modePopover"),
  modeName: $("modeName"),
  modeIcon: $("modeIcon"),
  chatScroll: $("chatScroll"),
  welcome: $("welcome"),
  messages: $("messages"),
  typingRow: $("typingRow"),
  typingText: $("typingText"),
  messageInput: $("messageInput"),
  sendBtn: $("sendBtn"),
  toolsBtn: $("toolsBtn"),
  toolsLabel: $("toolsLabel"),
  clearChatBtn: $("clearChatBtn"),
  overlay: $("overlay"),
  connectorsModal: $("connectorsModal"),
  settingsModal: $("settingsModal"),
  connectorName: $("connectorName"),
  connectorUrl: $("connectorUrl"),
  connectorToken: $("connectorToken"),
  addConnectorBtn: $("addConnectorBtn"),
  connectorList: $("connectorList"),
  connectorMeta: $("connectorMeta"),
  vaultPath: $("vaultPath"),
  saveSettingsBtn: $("saveSettingsBtn"),
  toast: $("toast"),
  topbarSub: $("topbarSub")
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderMarkdownLite(text) {
  const blocks = [];
  let working = String(text ?? "");

  working = working.replace(/```([\s\S]*?)```/g, (_, code) => {
    const i = blocks.length;
    blocks.push(`<pre><code>${escapeHtml(code.trim())}</code></pre>`);
    return `@@CODE${i}@@`;
  });

  let html = escapeHtml(working);

  html = html
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/^\- (.+)$/gm, "<li>$1</li>")
    .replace(/^\* (.+)$/gm, "<li>$1</li>")
    .replace(/^\d+\.\s(.+)$/gm, "<li>$1</li>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\n{2,}/g, "</p><p>")
    .replace(/\n/g, "<br>");

  html = html.replace(/(<li>.*?<\/li>)(?:<br>)?/g, "$1");
  html = html.replace(/((?:<li>.*?<\/li>)+)/g, "<ul>$1</ul>");
  html = `<p>${html}</p>`;

  html = html.replace(/<p>\s*<\/p>/g, "");

  blocks.forEach((block, i) => {
    html = html.replace(`@@CODE${i}@@`, block);
  });

  return html;
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.add("hidden"), 2500);
}

function openModal(modal) {
  els.overlay.classList.remove("hidden");
  modal.classList.remove("hidden");
}

function closeModals() {
  els.overlay.classList.add("hidden");
  document.querySelectorAll(".modal").forEach((m) => m.classList.add("hidden"));
}

function togglePopover(popover) {
  const hidden = popover.classList.contains("hidden");
  document.querySelectorAll(".popover").forEach((p) => p.classList.add("hidden"));
  if (hidden) popover.classList.remove("hidden");
}

function resizeInput() {
  els.messageInput.style.height = "auto";
  els.messageInput.style.height = Math.min(els.messageInput.scrollHeight, 180) + "px";
}

function scrollBottom(smooth = true) {
  els.chatScroll.scrollTo({
    top: els.chatScroll.scrollHeight,
    behavior: smooth ? "smooth" : "auto"
  });
}

function setTyping(show, text = "Thinking…") {
  els.typingText.textContent = text;
  els.typingRow.classList.toggle("hidden", !show);
  if (show) scrollBottom();
}

function setConnectionText() {
  const localModels = state.models.filter((m) => m.provider === "ollama").length;
  $("connectionText").textContent = localModels ? `Ollama · ${localModels} local model${localModels === 1 ? "" : "s"}` : "Local AI";
}

function getSelectedModel() {
  return state.models.find((m) => m.id === state.model) || state.models[0];
}

function updateModelUi() {
  const model = getSelectedModel();
  if (!model) return;
  els.modelName.textContent = model.label;
  els.modelProvider.textContent = `${model.provider === "ollama" ? "Local · Ollama" : "Cloud · NVIDIA"}`;
  els.modelLogo.textContent = model.provider === "ollama" ? "Q" : "N";
  els.modelLogo.style.background = model.provider === "ollama"
    ? "rgba(180,155,255,.14)"
    : "rgba(114,170,255,.12)";
  els.topbarSub.textContent = state.controller ? "Generating…" : `${model.provider === "ollama" ? "Local" : "NVIDIA"} · ${state.mode}`;
  renderModelOptions();
}

function renderModelOptions() {
  const query = els.modelSearch.value.trim().toLowerCase();
  const visible = state.models.filter((m) => {
    const hay = `${m.label} ${m.model} ${m.provider}`.toLowerCase();
    return !query || hay.includes(query);
  });

  els.modelOptions.innerHTML = visible.map((m) => `
    <button class="model-option ${m.id === state.model ? "selected" : ""}" data-model="${escapeHtml(m.id)}">
      <span class="model-option-mark">${m.provider === "ollama" ? "Q" : "N"}</span>
      <span class="model-option-copy">
        <strong>${escapeHtml(m.label)}</strong>
        <small>${escapeHtml(m.provider === "ollama" ? "Ollama · local" : "NVIDIA · cloud")} · ${escapeHtml(m.model)}</small>
      </span>
      ${m.id === state.model ? `<span class="model-option-check">✓</span>` : ""}
    </button>
  `).join("");

  els.modelOptions.querySelectorAll("[data-model]").forEach((button) => {
    button.addEventListener("click", () => {
      state.model = button.dataset.model;
      savePrefs();
      updateModelUi();
      els.modelPopover.classList.add("hidden");
      showToast(`Model: ${getSelectedModel()?.label || state.model}`);
    });
  });
}

function updateModeUi() {
  const modes = {
    fast: ["⚡", "Fast"],
    think: ["◈", "Think"],
    deep: ["✦", "Deep"]
  };
  const [icon, name] = modes[state.mode];
  els.modeIcon.textContent = icon;
  els.modeName.textContent = name;

  document.querySelectorAll(".mode-option").forEach((option) => {
    option.classList.toggle("selected", option.dataset.mode === state.mode);
  });
  updateModelUi();
}

function addChatMessage(role, content = "", options = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = `message ${role}`;
  wrapper.dataset.messageId = crypto.randomUUID();

  const avatar = document.createElement("div");
  avatar.className = `avatar ${role === "assistant" ? "avatar-ai" : "avatar-user"}`;
  avatar.textContent = role === "assistant" ? "✦" : "D";

  const body = document.createElement("div");
  body.className = "message-body";

  const roleLabel = document.createElement("div");
  roleLabel.className = "message-role";
  roleLabel.textContent = role === "assistant" ? getSelectedModel()?.label || "Assistant" : "You";

  const copy = document.createElement("div");
  copy.className = "message-copy";
  copy.innerHTML = role === "assistant"
    ? renderMarkdownLite(content)
    : escapeHtml(content).replace(/\n/g, "<br>");

  if (options.streaming) {
    copy.classList.add("streaming-copy");
  }

  body.append(roleLabel, copy);

  if (role === "assistant" && !options.streaming) {
    const actions = document.createElement("div");
    actions.className = "message-actions";
    actions.innerHTML = `
      <button class="action-btn" data-copy>Copy</button>
      <button class="action-btn" data-save>Save to Obsidian</button>
    `;

    actions.querySelector("[data-copy]").addEventListener("click", async () => {
      await navigator.clipboard.writeText(content);
      showToast("Copied");
    });

    actions.querySelector("[data-save]").addEventListener("click", async () => {
      const title = prompt("Note name:", "AI Note");
      if (!title) return;

      const response = await fetch("/api/vault/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content })
      });

      const data = await response.json();
      if (!response.ok) {
        showToast(data.error || "Could not save note");
        return;
      }
      showToast(`Saved: ${data.path}`);
    });

    body.appendChild(actions);
  }

  wrapper.append(avatar, body);
  els.messages.appendChild(wrapper);

  scrollBottom();
  return { wrapper, copy };
}

function addToolStatus(text) {
  const node = document.createElement("div");
  node.className = "tool-status";
  node.innerHTML = `<span class="tool-status-dot"></span><span>${escapeHtml(text)}</span>`;
  els.messages.appendChild(node);
  scrollBottom();
  return node;
}

function clearChatView() {
  els.messages.innerHTML = "";
  els.welcome.classList.remove("hidden");
}

function hideWelcome() {
  els.welcome.classList.add("hidden");
}

function savePrefs() {
  localStorage.setItem("obsidian-ai-prefs", JSON.stringify({
    model: state.model,
    mode: state.mode,
    toolsEnabled: state.toolsEnabled
  }));
}

function loadPrefs() {
  try {
    const prefs = JSON.parse(localStorage.getItem("obsidian-ai-prefs") || "{}");
    if (prefs.model) state.model = prefs.model;
    if (prefs.mode) state.mode = prefs.mode;
    if (typeof prefs.toolsEnabled === "boolean") state.toolsEnabled = prefs.toolsEnabled;
  } catch {}
}

function saveChats() {
  localStorage.setItem("obsidian-ai-chats", JSON.stringify(state.chats.slice(-30)));
}

function loadChats() {
  try {
    state.chats = JSON.parse(localStorage.getItem("obsidian-ai-chats") || "[]");
  } catch {
    state.chats = [];
  }
}

function renderChatList() {
  const query = els.chatSearch.value.trim().toLowerCase();
  const chats = state.chats.filter((chat) => !query || chat.title.toLowerCase().includes(query));

  els.chatList.innerHTML = chats.map((chat) => `
    <div class="chat-row ${chat.id === state.currentChatId ? "active" : ""}" data-chat-id="${escapeHtml(chat.id)}">
      <div class="chat-row-title">${escapeHtml(chat.title)}</div>
      <div class="chat-row-time">${escapeHtml(chat.time)}</div>
    </div>
  `).join("");

  els.chatList.querySelectorAll("[data-chat-id]").forEach((row) => {
    row.addEventListener("click", () => loadChat(row.dataset.chatId));
  });
}

function createChat() {
  if (state.controller) stopGeneration();
  state.conversation = [];
  state.currentChatId = null;
  clearChatView();
  renderChatList();
  els.messageInput.value = "";
  resizeInput();
  els.messageInput.focus();
}

function saveCurrentChat() {
  const firstUser = state.conversation.find((m) => m.role === "user");
  if (!firstUser) return;

  const title = firstUser.content.slice(0, 52) + (firstUser.content.length > 52 ? "…" : "");
  const id = state.currentChatId || crypto.randomUUID();
  state.currentChatId = id;

  const existing = state.chats.find((c) => c.id === id);
  const chat = {
    id,
    title,
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    conversation: state.conversation
  };

  if (existing) Object.assign(existing, chat);
  else state.chats.push(chat);

  saveChats();
  renderChatList();
}

function loadChat(id) {
  const chat = state.chats.find((c) => c.id === id);
  if (!chat) return;

  state.currentChatId = chat.id;
  state.conversation = [...chat.conversation];
  clearChatView();

  if (state.conversation.length) hideWelcome();

  for (const msg of state.conversation) {
    addChatMessage(msg.role === "user" ? "user" : "assistant", msg.content);
  }

  renderChatList();
  els.sidebar.classList.remove("open");
}

function updateToolsUi() {
  els.toolsLabel.textContent = state.toolsEnabled ? "Tools on" : "Tools off";
  els.toolsBtn.style.color = state.toolsEnabled ? "var(--text)" : "";
  savePrefs();
}

async function apiJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function loadModels() {
  const data = await apiJson("/api/models");
  state.models = data.models || [];
  if (!state.models.some((m) => m.id === state.model)) {
    state.model = state.models.find((m) => m.id === "ollama:qwen3.5:9b")?.id || state.models[0]?.id;
  }
  updateModelUi();
  setConnectionText();
}

async function loadConnectors() {
  const data = await apiJson("/api/connectors");
  state.connectors = data.connectors || [];
  els.connectorCount.textContent = state.connectors.filter((c) => c.enabled).length;
  els.connectorMeta.textContent = `${state.connectors.length} saved · ${state.connectors.filter((c) => c.enabled).length} enabled`;
  renderConnectors();
}

function renderConnectors() {
  if (!state.connectors.length) {
    els.connectorList.innerHTML = `
      <div class="connector-card">
        <div class="connector-main">
          <div class="connector-badge">⊙</div>
          <div class="connector-copy">
            <strong>No connectors yet</strong>
            <span>Add a trusted MCP server above.</span>
          </div>
        </div>
      </div>
    `;
    return;
  }

  els.connectorList.innerHTML = state.connectors.map((c) => `
    <div class="connector-card">
      <div class="connector-main">
        <div class="connector-badge">${c.connected ? "✓" : "⊙"}</div>
        <div class="connector-copy">
          <strong>${escapeHtml(c.name)}</strong>
          <span>${escapeHtml(c.url)}</span>
        </div>
        <div class="connector-actions">
          <button class="small-btn" data-test="${escapeHtml(c.id)}">Test</button>
          <button class="small-btn" data-remove="${escapeHtml(c.id)}">Remove</button>
        </div>
      </div>
      <div class="connector-meta-row">
        <span>${c.toolCount || 0} tools ${c.error ? `· ${escapeHtml(c.error)}` : c.connected ? "· ready" : "· not connected"}</span>
        <label class="switch" title="Enable tool access">
          <input type="checkbox" data-toggle="${escapeHtml(c.id)}" ${c.enabled ? "checked" : ""}>
          <span></span>
        </label>
      </div>
    </div>
  `).join("");

  els.connectorList.querySelectorAll("[data-toggle]").forEach((input) => {
    input.addEventListener("change", async () => {
      const connectorId = input.dataset.toggle;
      const data = await apiJson(`/api/connectors/${encodeURIComponent(connectorId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: input.checked })
      });
      state.connectors = data.connectors;
      els.connectorCount.textContent = state.connectors.filter((c) => c.enabled).length;
      renderConnectors();
    });
  });

  els.connectorList.querySelectorAll("[data-test]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "…";
      try {
        await apiJson(`/api/connectors/${encodeURIComponent(button.dataset.test)}/test`, { method: "POST" });
        await loadConnectors();
        showToast("Connector connected");
      } catch (error) {
        showToast(error.message);
        await loadConnectors();
      } finally {
        button.disabled = false;
        button.textContent = "Test";
      }
    });
  });

  els.connectorList.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("Remove this connector?")) return;
      await apiJson(`/api/connectors/${encodeURIComponent(button.dataset.remove)}`, { method: "DELETE" });
      await loadConnectors();
      showToast("Connector removed");
    });
  });
}

async function addConnector() {
  const name = els.connectorName.value.trim() || "MCP Connector";
  const url = els.connectorUrl.value.trim();
  const token = els.connectorToken.value;

  if (!url) {
    showToast("Enter an MCP URL");
    return;
  }

  els.addConnectorBtn.disabled = true;
  els.addConnectorBtn.textContent = "Connecting…";

  try {
    const data = await apiJson("/api/connectors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, url, token, enabled: false })
    });

    state.connectors = data.connectors;
    els.connectorName.value = "";
    els.connectorUrl.value = "";
    els.connectorToken.value = "";
    renderConnectors();
    els.connectorCount.textContent = state.connectors.filter((c) => c.enabled).length;
    showToast("Connector added. Enable it to give the AI access to its tools.");
  } catch (error) {
    showToast(error.message);
  } finally {
    els.addConnectorBtn.disabled = false;
    els.addConnectorBtn.textContent = "Connect";
  }
}

async function loadSettings() {
  const data = await apiJson("/api/settings");
  state.settings = data.settings || {};
  els.vaultPath.value = state.settings.vaultPath || "";
}

async function saveSettings() {
  const vaultPath = els.vaultPath.value.trim();
  const data = await apiJson("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vaultPath })
  });
  state.settings = data.settings;
  closeModals();
  showToast("Settings saved");
}

function stopGeneration() {
  if (state.controller) {
    state.controller.abort();
    state.controller = null;
  }
  setTyping(false);
  els.sendBtn.disabled = false;
  els.sendBtn.textContent = "↑";
  els.topbarSub.textContent = `${getSelectedModel()?.provider === "ollama" ? "Local" : "NVIDIA"} · ${state.mode}`;
}

async function sendMessage(prefill = null) {
  if (state.controller) {
    stopGeneration();
    return;
  }

  const text = (prefill ?? els.messageInput.value).trim();
  if (!text) return;

  hideWelcome();
  addChatMessage("user", text);
  state.conversation.push({ role: "user", content: text });
  saveCurrentChat();

  els.messageInput.value = "";
  resizeInput();
  els.sendBtn.disabled = true;
  els.sendBtn.textContent = "■";
  state.controller = new AbortController();

  setTyping(true, state.toolsEnabled ? "Preparing tools…" : state.mode === "fast" ? "Generating…" : "Thinking…");

  const started = performance.now();
  let assistantText = "";
  let assistantMessage = null;

  try {
    const response = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        history: state.conversation,
        model: state.model,
        mode: state.mode,
        toolsEnabled: state.toolsEnabled
      }),
      signal: state.controller.signal
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.error || `Request failed (${response.status})`);
    }

    setTyping(false);

    assistantMessage = addChatMessage("assistant", "", { streaming: true });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";

      for (const event of events) {
        const line = event.split("\n").find((x) => x.startsWith("data:"));
        if (!line) continue;

        const payload = JSON.parse(line.slice(5).trim());

        if (payload.type === "status") {
          addToolStatus(payload.message);
        }

        if (payload.type === "delta") {
          assistantText += payload.text || "";
          assistantMessage.copy.innerHTML = renderMarkdownLite(assistantText);
          scrollBottom();
        }

        if (payload.type === "done") {
          assistantText = payload.text || assistantText;
          assistantMessage.copy.innerHTML = renderMarkdownLite(assistantText);
          assistantMessage.wrapper.querySelector(".message-body").appendChild(buildActionButtons(assistantText));
        }

        if (payload.type === "error") {
          throw new Error(payload.error || "AI error");
        }
      }
    }

    if (!assistantText.trim()) {
      throw new Error("The model returned an empty response.");
    }

    state.conversation.push({
      role: "assistant",
      content: assistantText
    });
    saveCurrentChat();

    const elapsed = Math.round(performance.now() - started);
    els.topbarSub.textContent = `${getSelectedModel()?.provider === "ollama" ? "Local" : "NVIDIA"} · ${elapsed} ms`;
  } catch (error) {
    if (error.name !== "AbortError") {
      if (assistantMessage) {
        assistantMessage.wrapper.remove();
      }
      addChatMessage("assistant", `⚠️ ${error.message}`);
      state.conversation.push({
        role: "assistant",
        content: `⚠️ ${error.message}`
      });
      saveCurrentChat();
    }
  } finally {
    state.controller = null;
    setTyping(false);
    els.sendBtn.disabled = false;
    els.sendBtn.textContent = "↑";
    els.messageInput.focus();
  }
}

function buildActionButtons(content) {
  const actions = document.createElement("div");
  actions.className = "message-actions";
  actions.innerHTML = `
    <button class="action-btn" data-copy>Copy</button>
    <button class="action-btn" data-save>Save to Obsidian</button>
  `;

  actions.querySelector("[data-copy]").addEventListener("click", async () => {
    await navigator.clipboard.writeText(content);
    showToast("Copied");
  });

  actions.querySelector("[data-save]").addEventListener("click", async () => {
    const title = prompt("Note name:", "AI Note");
    if (!title) return;

    try {
      const data = await apiJson("/api/vault/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content })
      });
      showToast(`Saved: ${data.path}`);
    } catch (error) {
      showToast(error.message);
    }
  });

  return actions;
}

document.querySelectorAll("[data-close]").forEach((button) => {
  button.addEventListener("click", closeModals);
});

els.overlay.addEventListener("click", closeModals);

els.mobileMenuBtn.addEventListener("click", () => {
  els.sidebar.classList.toggle("open");
});

els.newChatBtn.addEventListener("click", createChat);
els.clearChatBtn.addEventListener("click", createChat);

els.connectorsBtn.addEventListener("click", async () => {
  await loadConnectors();
  openModal(els.connectorsModal);
});

els.headerConnectorsBtn.addEventListener("click", async () => {
  await loadConnectors();
  openModal(els.connectorsModal);
});

els.settingsBtn.addEventListener("click", async () => {
  await loadSettings();
  openModal(els.settingsModal);
});

els.addConnectorBtn.addEventListener("click", addConnector);
els.saveSettingsBtn.addEventListener("click", saveSettings);

els.modelButton.addEventListener("click", () => togglePopover(els.modelPopover));
els.modeButton.addEventListener("click", () => togglePopover(els.modePopover));

els.modelSearch.addEventListener("input", renderModelOptions);

document.querySelectorAll(".mode-option").forEach((button) => {
  button.addEventListener("click", () => {
    state.mode = button.dataset.mode;
    updateModeUi();
    savePrefs();
    els.modePopover.classList.add("hidden");
  });
});

els.toolsBtn.addEventListener("click", () => {
  const enabledConnectors = state.connectors.filter((c) => c.enabled).length;
  if (!state.toolsEnabled && enabledConnectors === 0) {
    showToast("Enable at least one MCP connector first");
    openModal(els.connectorsModal);
    return;
  }
  state.toolsEnabled = !state.toolsEnabled;
  updateToolsUi();
});

els.sendBtn.addEventListener("click", () => sendMessage());

els.messageInput.addEventListener("input", () => {
  resizeInput();
  els.sendBtn.disabled = !els.messageInput.value.trim() && !state.controller;
});

els.messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});

els.chatSearch.addEventListener("input", renderChatList);

document.querySelectorAll(".prompt-card").forEach((card) => {
  card.addEventListener("click", () => sendMessage(card.dataset.prompt));
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".model-menu")) els.modelPopover.classList.add("hidden");
  if (!event.target.closest(".mode-menu")) els.modePopover.classList.add("hidden");
});

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    createChat();
  }

  if (event.key === "Escape") {
    if (state.controller) stopGeneration();
    closeModals();
    els.modelPopover.classList.add("hidden");
    els.modePopover.classList.add("hidden");
  }
});

window.addEventListener("beforeunload", () => {
  if (state.controller) state.controller.abort();
});

async function boot() {
  loadPrefs();
  loadChats();
  renderChatList();
  updateModeUi();
  updateToolsUi();

  try {
    await Promise.all([
      loadModels(),
      loadConnectors(),
      loadSettings()
    ]);
  } catch (error) {
    showToast(error.message);
  }

  if (!state.models.length) {
    showToast("No model detected. Start Ollama first.");
  }

  els.sendBtn.disabled = !els.messageInput.value.trim();
  els.messageInput.focus();
  resizeInput();
}

boot();
