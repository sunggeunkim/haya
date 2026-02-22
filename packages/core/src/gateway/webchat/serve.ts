import type { IncomingMessage, ServerResponse } from "node:http";

export interface WebChatOptions {
  nonce: string;
  wsProtocol: "ws" | "wss";
  host: string;
  port: number;
}

/**
 * Handle incoming HTTP requests for the web chat interface.
 * Returns true if the request was handled, false otherwise.
 */
export function handleWebChatRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: WebChatOptions,
): boolean {
  const url = req.url?.split("?")[0];

  if (url === "/chat" || url === "/chat/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(getIndexHtml(options));
    return true;
  }

  return false;
}

/**
 * Returns a complete HTML page with embedded CSS and JS for the web chat UI.
 * Everything is inlined to avoid serving separate static files.
 */
function getIndexHtml(options: WebChatOptions): string {
  const { nonce, wsProtocol, host, port } = options;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Haya Chat</title>
  <style nonce="${nonce}">
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #1a1a2e;
      color: #e4e4e4;
      height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    #app {
      width: 100%;
      max-width: 800px;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }

    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid #2a2a4a;
      flex-shrink: 0;
    }

    header h1 {
      font-size: 18px;
      font-weight: 600;
      color: #f0f0f0;
    }

    #connection-status {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: #888;
    }

    #status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #666;
      transition: background 0.3s;
    }

    #status-dot.connected {
      background: #4caf50;
    }

    #status-dot.connecting {
      background: #ff9800;
    }

    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .message {
      max-width: 80%;
      padding: 10px 14px;
      border-radius: 12px;
      font-size: 14px;
      line-height: 1.5;
      word-wrap: break-word;
      white-space: pre-wrap;
    }

    .message.user {
      align-self: flex-end;
      background: #2563eb;
      color: #fff;
      border-bottom-right-radius: 4px;
    }

    .message.assistant {
      align-self: flex-start;
      background: #2a2a4a;
      color: #e4e4e4;
      border-bottom-left-radius: 4px;
    }

    .message code {
      font-family: "SF Mono", "Fira Code", "Fira Mono", Menlo, Consolas, monospace;
      background: rgba(0, 0, 0, 0.2);
      padding: 1px 4px;
      border-radius: 3px;
      font-size: 13px;
    }

    .message pre {
      background: rgba(0, 0, 0, 0.3);
      padding: 8px 10px;
      border-radius: 6px;
      overflow-x: auto;
      margin: 6px 0;
    }

    .message pre code {
      background: none;
      padding: 0;
    }

    #typing-indicator {
      align-self: flex-start;
      padding: 10px 14px;
      font-size: 14px;
      color: #888;
      display: none;
    }

    #typing-indicator.visible {
      display: block;
    }

    #input-area {
      display: flex;
      gap: 8px;
      padding: 12px 16px;
      border-top: 1px solid #2a2a4a;
      flex-shrink: 0;
    }

    #message-input {
      flex: 1;
      background: #16162a;
      border: 1px solid #2a2a4a;
      border-radius: 8px;
      color: #e4e4e4;
      padding: 10px 12px;
      font-family: inherit;
      font-size: 14px;
      resize: none;
      min-height: 42px;
      max-height: 120px;
      outline: none;
      transition: border-color 0.2s;
    }

    #message-input:focus {
      border-color: #2563eb;
    }

    #message-input::placeholder {
      color: #666;
    }

    #send-btn {
      background: #2563eb;
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 0 16px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.2s;
      flex-shrink: 0;
    }

    #send-btn:hover {
      background: #1d4ed8;
    }

    #send-btn:disabled {
      background: #333;
      color: #666;
      cursor: not-allowed;
    }
  </style>
</head>
<body>
  <div id="app">
    <header>
      <h1>Haya Chat</h1>
      <div id="connection-status">
        <div id="status-dot"></div>
        <span id="status-text">Disconnected</span>
      </div>
    </header>
    <div id="messages">
      <div id="typing-indicator">Assistant is typing...</div>
    </div>
    <div id="input-area">
      <textarea id="message-input" placeholder="Type a message... (Enter to send, Shift+Enter for newline)" rows="1"></textarea>
      <button id="send-btn" disabled>Send</button>
    </div>
  </div>
  <script nonce="${nonce}">
    (function () {
      var WS_URL = "${wsProtocol}://${host}:${port}";
      var params = new URLSearchParams(window.location.search);
      var authToken = params.get("token") || "";
      var sessionId = generateHexId(16);

      var ws = null;
      var reconnectDelay = 1000;
      var maxReconnectDelay = 30000;
      var currentAssistantEl = null;
      var currentAssistantText = "";
      var isStreaming = false;

      var messagesEl = document.getElementById("messages");
      var typingEl = document.getElementById("typing-indicator");
      var inputEl = document.getElementById("message-input");
      var sendBtn = document.getElementById("send-btn");
      var statusDot = document.getElementById("status-dot");
      var statusText = document.getElementById("status-text");

      function generateHexId(bytes) {
        var arr = new Uint8Array(bytes);
        crypto.getRandomValues(arr);
        return Array.from(arr, function (b) {
          return b.toString(16).padStart(2, "0");
        }).join("");
      }

      function escapeHtml(str) {
        var div = document.createElement("div");
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
      }

      function generateUuid() {
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
          var r = (Math.random() * 16) | 0;
          var v = c === "x" ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
      }

      function scrollToBottom() {
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }

      function setConnectionStatus(state) {
        statusDot.className = state;
        if (state === "connected") {
          statusText.textContent = "Connected";
          sendBtn.disabled = false;
        } else if (state === "connecting") {
          statusText.textContent = "Connecting...";
          sendBtn.disabled = true;
        } else {
          statusText.textContent = "Disconnected";
          sendBtn.disabled = true;
        }
      }

      function addMessage(role, text) {
        var el = document.createElement("div");
        el.className = "message " + role;
        el.innerHTML = escapeHtml(text);
        messagesEl.insertBefore(el, typingEl);
        scrollToBottom();
        return el;
      }

      function showTyping() {
        isStreaming = true;
        typingEl.classList.add("visible");
        scrollToBottom();
      }

      function hideTyping() {
        isStreaming = false;
        typingEl.classList.remove("visible");
      }

      function connect() {
        var url = WS_URL + (authToken ? "?token=" + encodeURIComponent(authToken) : "");
        setConnectionStatus("connecting");

        ws = new WebSocket(url);

        ws.onopen = function () {
          setConnectionStatus("connected");
          reconnectDelay = 1000;
        };

        ws.onmessage = function (evt) {
          var msg;
          try {
            msg = JSON.parse(evt.data);
          } catch (e) {
            return;
          }

          if (msg.event === "chat.delta") {
            if (!currentAssistantEl) {
              currentAssistantEl = addMessage("assistant", "");
              currentAssistantText = "";
              showTyping();
            }
            currentAssistantText += (msg.data && msg.data.delta) || "";
            currentAssistantEl.innerHTML = escapeHtml(currentAssistantText);
            scrollToBottom();
          } else if (msg.event === "chat.response" || (msg.id && msg.result !== undefined)) {
            hideTyping();
            if (!currentAssistantEl && msg.result && msg.result.text) {
              addMessage("assistant", msg.result.text);
            } else if (currentAssistantEl && msg.result && msg.result.text) {
              currentAssistantText = msg.result.text;
              currentAssistantEl.innerHTML = escapeHtml(currentAssistantText);
            }
            currentAssistantEl = null;
            currentAssistantText = "";
            scrollToBottom();
          } else if (msg.error) {
            hideTyping();
            currentAssistantEl = null;
            currentAssistantText = "";
            addMessage("assistant", "Error: " + (msg.error.message || "Unknown error"));
          }
        };

        ws.onclose = function () {
          setConnectionStatus("");
          scheduleReconnect();
        };

        ws.onerror = function () {
          if (ws) ws.close();
        };
      }

      function scheduleReconnect() {
        setTimeout(function () {
          reconnectDelay = Math.min(reconnectDelay * 2, maxReconnectDelay);
          connect();
        }, reconnectDelay);
      }

      function sendMessage() {
        var text = inputEl.value.trim();
        if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;

        addMessage("user", text);
        inputEl.value = "";
        inputEl.style.height = "auto";

        var rpcMessage = {
          id: generateUuid(),
          method: "chat.send",
          params: {
            sessionId: sessionId,
            message: text,
          },
        };
        ws.send(JSON.stringify(rpcMessage));
      }

      sendBtn.addEventListener("click", sendMessage);

      inputEl.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
      });

      inputEl.addEventListener("input", function () {
        inputEl.style.height = "auto";
        inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + "px";
      });

      connect();
    })();
  </script>
</body>
</html>`;
}
