/**
 * AgentRuntime - Browser Agent 运行时编排层
 *
 * 职责：
 *   1. Prompt → LLMProvider → sanitize → parse → Action 完整流水线
 *   2. JSON 解析失败自动重试 1 次
 *   3. 透传 RuntimeContext 到 Tool 层
 *   4. 所有状态写入 RuntimeState（单一状态源）
 *   5. 统一 _emit()：自动注入 sessionId / runId / phase / timestamp
 *   6. _isCancelled + _running 防并发
 *
 * AgentRuntime 不再维护独立 state / onStatusChange / _setStatus。
 */

function _tryParseJSON(rawContent) {
  try {
    var sanitized = sanitizeLLMOutput(rawContent);
    var parsed = JSON.parse(sanitized);
    return { parsed: parsed, error: null };
  } catch (e) {
    return { parsed: null, error: e };
  }
}

/**
 * _emit(type, payload, runId, sessionId)
 *
 * 标准化事件发射。所有事件必须通过此函数。
 * 结构：{ type, timestamp, sessionId, runId, phase, payload: {...} }
 */
function _emit(type, runId, sessionId, data) {
  var st = RuntimeState.get();
  RuntimeEvents.emit(type, {
    type: type,
    timestamp: Date.now(),
    sessionId: sessionId,
    runId: runId,
    phase: st.phase,
    payload: data || {}
  });
}

var AgentRuntime = {
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
      console.error("AgentRuntime.cancel: state set 失败（已容错）", e);
    }

    _emit("runtime_cancelled", this._currentRunId, RuntimeSession.getSessionId(), {
      error: "用户主动取消"
    });
  },

  run: async function(request) {
    var self = this;

    if (self._running) {
      throw new Error("AgentRuntime 正在执行中，请等待当前任务完成");
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
      RuntimeState.set(RuntimeStatus.BUILDING_PROMPT, { mode: request.mode });

      _emit("runtime_start", runId, sessionId, {
        mode: request.mode,
        template: request.template,
        timestamp: runStart
      });

      var prompt = PromptBuilder.build(request.template, request.pageContent, request.mode, request.question || "");
      if (!prompt) throw new Error("无法构建提示词");

      _emit("prompt_built", runId, sessionId);

      var messages = [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user }
      ];

      RuntimeState.set(RuntimeStatus.REQUESTING_LLM, { provider: "deepseek" });

      _emit("llm_request", runId, sessionId, { messages: messages });

      var result = await LLMProvider.call({
        apiKey: request.apiKey,
        messages: messages,
        signal: self._controller.signal,
        timeout: RUNTIME_LIMITS.REQUEST_TIMEOUT_MS
      });
      var rawContent = result.content;

      _emit("llm_response", runId, sessionId, { contentLength: rawContent.length });

      RuntimeState.set(RuntimeStatus.PARSING_RESPONSE);

      _emit("parse_start", runId, sessionId);

      var parseResult = _tryParseJSON(rawContent);
      var parsed = parseResult.parsed;

      if (!parsed) {
        RuntimeState.set(RuntimeStatus.RETRYING_PARSE);

        _emit("parse_retry", runId, sessionId, {
          error: parseResult.error ? parseResult.error.message : "未知错误"
        });

        messages.push({ role: "assistant", content: rawContent });
        messages.push({ role: "user", content: "你上次返回的内容不是合法 JSON。请严格只返回 JSON 对象。不要 markdown。不要解释。" });

        RuntimeState.set(RuntimeStatus.REQUESTING_LLM, { provider: "deepseek", isRetry: true });

        _emit("llm_request", runId, sessionId, { messages: messages, isRetry: true });

        var retryResult = await LLMProvider.call({
          apiKey: request.apiKey,
          messages: messages,
          signal: self._controller.signal,
          timeout: RUNTIME_LIMITS.REQUEST_TIMEOUT_MS
        });

        _emit("llm_response", runId, sessionId, {
          contentLength: retryResult.content.length, isRetry: true
        });

        RuntimeState.set(RuntimeStatus.PARSING_RESPONSE);

        var retryParse = _tryParseJSON(retryResult.content);
        if (retryParse.parsed) {
          parsed = retryParse.parsed;
        } else {
          throw new Error("AI 返回格式错误（已重试一次）: " + (parseResult.error ? parseResult.error.message : "未知解析错误"));
        }
      }

      _emit("parse_success", runId, sessionId);

      if (parsed.action && parsed.action !== "none") {
        RuntimeState.set(RuntimeStatus.EXECUTING_TOOL, { tool: parsed.action });

        _emit("tool_execute", runId, sessionId, {
          action: parsed.action, data: parsed.data
        });

        var actionResult = await ActionDispatcher.execute(parsed.action, parsed.data, request.context);
        parsed._actionResult = actionResult;

        _emit("tool_result", runId, sessionId, {
          action: parsed.action,
          success: actionResult && actionResult.success,
          durationMs: actionResult && actionResult.durationMs
        });
      }

      RuntimeState.set(RuntimeStatus.COMPLETED, { result: parsed });

      _emit("runtime_done", runId, sessionId, {
        totalMs: Date.now() - runStart
      });

      return parsed;

    } catch (err) {
      if (self._isCancelled) {
        _emit("runtime_error", runId, sessionId, {
          error: "已取消",
          totalMs: Date.now() - runStart
        });
      } else if (err.name === "AbortError") {
        RuntimeState.set(RuntimeStatus.FAILED, {
          error: "请求超时（超过 " + (RUNTIME_LIMITS.REQUEST_TIMEOUT_MS / 1000) + " 秒）"
        });
        _emit("runtime_error", runId, sessionId, {
          error: "请求超时",
          totalMs: Date.now() - runStart
        });
      } else {
        RuntimeState.set(RuntimeStatus.FAILED, { error: err.message });
        _emit("runtime_error", runId, sessionId, {
          error: err.message,
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
  }
};
