/**
 * BaseProvider — Provider 抽象基类
 *
 * 所有 LLM Provider（DeepSeek / OpenClaw）必须遵循此接口。
 *
 * 子类必须覆盖：
 *   - capabilities (getter, 返回能力声明对象)
 *   - send(messages, options) → { content: string }
 *
 * 子类可选覆盖：
 *   - testConnection() → { ok: boolean, message: string }
 *   - stream(messages, onChunk, options) → string
 *   - configure(config) → void
 */
var BaseProvider = {
  /**
   * capabilities
   *
   * 返回 Provider 能力声明，Runtime 据此自动决策行为。
   *
   * { streaming, vision, websocket, localRuntime, tools, apiKeyRequired,
   *   maxTokens, endpoint }
   */
  get capabilities() {
    throw new Error("BaseProvider: 子类必须实现 capabilities getter");
  },

  send: async function(messages, options) {
    throw new Error("BaseProvider: 子类必须实现 send()");
  },

  testConnection: async function() {
    return { ok: false, message: "当前 Provider 不支持连接测试" };
  },

  stream: async function(messages, onChunk, options) {
    throw new Error("BaseProvider: 当前 Provider 不支持流式输出");
  },

  hasCapability: function(name) {
    return !!this.capabilities[name];
  },

  toDescriptor: function() {
    return {
      capabilities: Object.assign({}, this.capabilities),
      providerType: this._providerType || "unknown"
    };
  }
};

// ==========================================
//   DeepSeekProvider
// ==========================================

var DeepSeekProvider = Object.create(BaseProvider);

DeepSeekProvider._providerType = "deepseek";
DeepSeekProvider._endpoint = "https://api.deepseek.com/chat/completions";
DeepSeekProvider._model = "deepseek-chat";
DeepSeekProvider._apiKey = "";

Object.defineProperty(DeepSeekProvider, "capabilities", {
  get: function() {
    return Object.freeze({
      streaming: false,
      vision: false,
      websocket: false,
      localRuntime: false,
      tools: false,
      apiKeyRequired: true,
      maxTokens: 64000,
      endpoint: this._endpoint
    });
  },
  enumerable: true
});

DeepSeekProvider.send = async function(messages, options) {
  var apiKey = options.apiKey || this._apiKey;
  var timeout = options.timeout || 30000;
  var externalSignal = options.signal || null;

  if (!apiKey) throw new Error("DeepSeekProvider: apiKey 未提供");
  if (!messages || !messages.length) throw new Error("DeepSeekProvider: messages 为空");

  var timeoutController = new AbortController();
  var timeoutId = setTimeout(function() {
    timeoutController.abort();
  }, timeout);

  var combinedSignal;
  if (externalSignal) {
    combinedSignal = AbortSignal.any
      ? AbortSignal.any([timeoutController.signal, externalSignal])
      : timeoutController.signal;
  } else {
    combinedSignal = timeoutController.signal;
  }

  if (externalSignal && !AbortSignal.any) {
    externalSignal.addEventListener("abort", function() {
      timeoutController.abort();
    }, { once: true });
  }

  var response;
  try {
    response = await fetch(this._endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + apiKey
      },
      body: JSON.stringify({
        model: this._model,
        messages: messages
      }),
      signal: combinedSignal
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    var errData = await response.json().catch(function() { return null; });
    throw new Error(
      errData && errData.error ? errData.error.message : "HTTP " + response.status
    );
  }

  var result = await response.json();
  var content = result.choices && result.choices[0]
    ? result.choices[0].message.content
    : "{}";

  return { content: content };
};

DeepSeekProvider.configure = function(config) {
  if (config.apiKey) this._apiKey = config.apiKey;
  if (config.model) this._model = config.model;
  if (config.endpoint) this._endpoint = config.endpoint;
};

// ==========================================
//   OpenClawProvider
// ==========================================

var OpenClawProvider = Object.create(BaseProvider);

OpenClawProvider._providerType = "openclaw";
OpenClawProvider._endpoint = "http://localhost:18789/hooks/agent";

Object.defineProperty(OpenClawProvider, "capabilities", {
  get: function() {
    return Object.freeze({
      streaming: false,
      vision: false,
      websocket: false,
      localRuntime: true,
      tools: false,
      apiKeyRequired: false,
      maxTokens: 32000,
      endpoint: this._endpoint
    });
  },
  enumerable: true
});

OpenClawProvider.send = async function(messages, options) {
  var timeout = options.timeout || 30000;
  var externalSignal = options.signal || null;

  var userMessage = "";
  if (messages && messages.length) {
    for (var i = 0; i < messages.length; i++) {
      if (messages[i].role === "user") {
        userMessage = messages[i].content;
      } else if (messages[i].role === "system") {
        userMessage = messages[i].content + "\n\n" + userMessage;
      }
    }
  }

  var timeoutController = new AbortController();
  var timeoutId = setTimeout(function() {
    timeoutController.abort();
  }, timeout);

  var combinedSignal;
  if (externalSignal) {
    combinedSignal = AbortSignal.any
      ? AbortSignal.any([timeoutController.signal, externalSignal])
      : timeoutController.signal;
  } else {
    combinedSignal = timeoutController.signal;
  }

  if (externalSignal && !AbortSignal.any) {
    externalSignal.addEventListener("abort", function() {
      timeoutController.abort();
    }, { once: true });
  }

  var response;
  try {
    response = await fetch(this._endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: userMessage, channel: "webchat" }),
      signal: combinedSignal
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    var errText = await response.text().catch(function() { return "HTTP " + response.status; });
    throw new Error("OpenClawProvider: " + errText);
  }

  var result = await response.json();

  var content = "{}";
  if (result.choices && result.choices[0] && result.choices[0].message) {
    content = result.choices[0].message.content;
  } else if (typeof result.content === "string") {
    content = result.content;
  } else if (typeof result.text === "string") {
    content = result.text;
  } else if (typeof result.message === "string") {
    content = result.message;
  } else if (typeof result === "string") {
    content = result;
  } else {
    content = JSON.stringify(result);
  }

  return { content: content };
};

OpenClawProvider.testConnection = async function() {
  try {
    var response = await fetch(this._endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "ping", channel: "webchat" }),
      signal: AbortSignal.timeout(5000)
    });
    if (response.ok) {
      return { ok: true, message: "✓ 已连接到 OpenClaw" };
    }
    return { ok: false, message: "HTTP " + response.status };
  } catch (err) {
    return { ok: false, message: err.message };
  }
};

OpenClawProvider.configure = function(config) {
  if (config.endpoint) this._endpoint = config.endpoint;
};
