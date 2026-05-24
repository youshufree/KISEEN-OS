/**
 * chatRuntime.js — 轻量对话运行时
 *
 * 职责：
 *   1. 管理多轮对话：user → LLM → assistant → user → ...
 *   2. 直接使用 chatHistory[] 构建 messages[]，不经过 PromptBuilder
 *   3. 不走 ReAct 循环，不执行 Tool
 *   4. 复用 RuntimeState / RuntimeEvents / RuntimeSession
 */

var CHAT_LIMITS = {
  MAX_HISTORY_LENGTH: 12000,
  REQUEST_TIMEOUT_MS: 60000
};

var ChatRuntime = {
  _controller: null,
  _isCancelled: false,
  _running: false,
  _currentRunId: null,

  cancel: function() {
    if (this._isCancelled) return;

    var phase = RuntimeState.getPhase();
    if (phase === RuntimeStatus.IDLE
        || phase === RuntimeStatus.COMPLETED
        || phase === RuntimeStatus.FAILED
        || phase === RuntimeStatus.CANCELLED) {
      return;
    }

    this._isCancelled = true;

    if (this._controller) {
      this._controller.abort();
      this._controller = null;
    }

    try {
      RuntimeState.set(RuntimeStatus.CANCELLED, { error: "用户主动取消" });
    } catch (e) {
      console.error("ChatRuntime.cancel: state set 失败（已容错）", e);
    }

    _emit("chat_cancelled", this._currentRunId, RuntimeSession.getSessionId(), {
      error: "用户主动取消"
    });
  },

  /**
   * send(request)
   *
   * request: { userMessage, apiKey, systemPrompt, imageBase64, imageMimeType }
   *
   * 流程：
   *   1. 构建 user 消息内容（纯文本或 Vision 格式）
   *   2. 从 chatHistory + 当前 user 消息构建 messages[]
   *   3. 调用 LLMProvider.call()
   *   4. 成功后追加 user + assistant 消息到 chatHistory
   *   5. 发射事件通知 UI
   */
  send: async function(request) {
    var self = this;

    if (self._running) {
      throw new Error("ChatRuntime 正在执行中，请等待当前任务完成");
    }
    self._running = true;

    var runStart = Date.now();
    var runId = RuntimeSession.newRunId();
    var sessionId = RuntimeSession.getSessionId();
    self._currentRunId = runId;
    self._isCancelled = false;

    RuntimeState.setSession(sessionId, runId);
    self._controller = new AbortController();

    try {
      RuntimeState.set(RuntimeStatus.BUILDING_PROMPT, { mode: "chat" });

      _emit("chat_start", runId, sessionId, {
        timestamp: runStart
      });

      var userContent;
      if (request.imageBase64) {
        userContent = [
          {
            type: "image_url",
            image_url: { url: "data:" + (request.imageMimeType || "image/jpeg") + ";base64," + request.imageBase64 }
          },
          { type: "text", text: request.userMessage }
        ];
      } else {
        userContent = request.userMessage;
      }

      var messages = [];

      if (request.systemPrompt) {
        messages.push({ role: "system", content: request.systemPrompt });
      }

      var historyMessages = RuntimeSession.getChatMessagesForLLM();
      for (var i = 0; i < historyMessages.length; i++) {
        messages.push(historyMessages[i]);
      }

      messages.push({ role: "user", content: userContent });

      _emit("chat_messages_built", runId, sessionId, {
        messageCount: messages.length
      });

      RuntimeState.set(RuntimeStatus.REQUESTING_LLM, { provider: "chat" });

      _emit("llm_request", runId, sessionId, { messages: messages });

      var result = await LLMProvider.call({
        apiKey: request.apiKey,
        messages: messages,
        signal: self._controller.signal,
        timeout: CHAT_LIMITS.REQUEST_TIMEOUT_MS
      });

      var assistantContent = result.content;

      _emit("llm_response", runId, sessionId, {
        contentLength: assistantContent.length
      });

      RuntimeSession.addChatMessage("user", userContent);
      RuntimeSession.addChatMessage("assistant", assistantContent);

      var currentUrl = PopupState.activeTab ? PopupState.activeTab.url : "";
      if (currentUrl) {
        ChatMemory.save(currentUrl, RuntimeSession.getChatHistory()).catch(function(e) {
          console.warn("ChatRuntime: 保存对话历史失败", e);
        });
      }

      RuntimeState.set(RuntimeStatus.COMPLETED, {
        result: {
          role: "assistant",
          content: assistantContent,
          chatHistory: RuntimeSession.getChatHistory()
        }
      });

      _emit("chat_done", runId, sessionId, {
        totalMs: Date.now() - runStart
      });

      return {
        role: "assistant",
        content: assistantContent,
        chatHistory: RuntimeSession.getChatHistory()
      };

    } catch (err) {
      if (self._isCancelled) {
        _emit("chat_error", runId, sessionId, {
          error: "已取消",
          totalMs: Date.now() - runStart
        });
      } else if (err.name === "AbortError") {
        RuntimeState.set(RuntimeStatus.FAILED, {
          error: "请求超时（超过 " + (CHAT_LIMITS.REQUEST_TIMEOUT_MS / 1000) + " 秒）"
        });
        _emit("chat_error", runId, sessionId, {
          error: "请求超时",
          totalMs: Date.now() - runStart
        });
      } else {
        var errorMsg = err.message || "未知错误";
        if (request.imageBase64 && (
            errorMsg.indexOf("image_url") !== -1
            || errorMsg.indexOf("unknown variant") !== -1
            || (errorMsg.indexOf("400") !== -1 && errorMsg.indexOf("deserialize") !== -1)
        )) {
          errorMsg = "当前模型不支持图片，请切换到支持 Vision 的模型";
        }
        RuntimeState.set(RuntimeStatus.FAILED, { error: errorMsg });
        _emit("chat_error", runId, sessionId, {
          error: errorMsg,
          totalMs: Date.now() - runStart
        });
      }
      throw err;
    } finally {
      self._controller = null;
      self._currentRunId = null;
      self._running = false;
      RuntimeState.reset();
    }
  },

  /**
   * loadHistory(url)
   *
   * 从持久化存储加载指定 URL 的对话历史到 RuntimeSession。
   * 返回: Promise<Array<{role, content}>>
   */
  loadHistory: async function(url) {
    if (!url) return [];
    var stored = await ChatMemory.load(url);
    if (stored && stored.length > 0) {
      var filtered = stored.filter(function(m) { return m.role !== "system"; });
      RuntimeSession.clearChatHistory();
      for (var i = 0; i < filtered.length; i++) {
        RuntimeSession.addChatMessage(filtered[i].role, filtered[i].content);
      }
      return filtered;
    }
    return [];
  },

  /**
   * clearHistory(url)
   *
   * 清空对话历史，开始新对话。
   * 同时清除持久化记录。
   */
  clearHistory: function(url) {
    RuntimeSession.clearChatHistory();
    if (url) {
      ChatMemory.clear(url).catch(function(e) {
        console.warn("ChatRuntime: 清空持久化记录失败", e);
      });
    }
  }
};
