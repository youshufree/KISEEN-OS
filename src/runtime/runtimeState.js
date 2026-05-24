/**
 * runtimeState.js - Runtime State Machine（单一状态源）
 *
 * 职责：
 *   1. 定义合法状态枚举 RuntimeStatus（含单轮 + ReAct Loop 状态）
 *   2. 状态跃迁守卫（RuntimeTransitions 白名单）
 *   3. 管理完整 Runtime 状态：phase / result / error / session / run / timestamps
 *   4. 是系统唯一状态源（Single Source of Truth）
 */

var RuntimeStatus = {
  IDLE: "idle",
  BUILDING_PROMPT: "building_prompt",
  REQUESTING_LLM: "requesting_llm",
  PARSING_RESPONSE: "parsing_response",
  RETRYING_PARSE: "retrying_parse",
  EXECUTING_TOOL: "executing_tool",
  OBSERVING: "observing",
  ACTING: "acting",
  PLANNING: "planning",
  RECOVERING: "recovering",
  LOOPING: "looping",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled"
};

var RuntimeTransitions = {};
// 单轮执行路径
RuntimeTransitions[RuntimeStatus.IDLE] = [RuntimeStatus.BUILDING_PROMPT, RuntimeStatus.OBSERVING, RuntimeStatus.PLANNING, RuntimeStatus.LOOPING];
RuntimeTransitions[RuntimeStatus.BUILDING_PROMPT] = [RuntimeStatus.REQUESTING_LLM, RuntimeStatus.FAILED, RuntimeStatus.CANCELLED];
RuntimeTransitions[RuntimeStatus.REQUESTING_LLM] = [RuntimeStatus.PARSING_RESPONSE, RuntimeStatus.COMPLETED, RuntimeStatus.FAILED, RuntimeStatus.CANCELLED];
RuntimeTransitions[RuntimeStatus.PARSING_RESPONSE] = [RuntimeStatus.EXECUTING_TOOL, RuntimeStatus.RETRYING_PARSE, RuntimeStatus.COMPLETED, RuntimeStatus.FAILED, RuntimeStatus.CANCELLED];
RuntimeTransitions[RuntimeStatus.RETRYING_PARSE] = [RuntimeStatus.REQUESTING_LLM, RuntimeStatus.FAILED, RuntimeStatus.CANCELLED];
RuntimeTransitions[RuntimeStatus.EXECUTING_TOOL] = [RuntimeStatus.COMPLETED, RuntimeStatus.FAILED, RuntimeStatus.CANCELLED];

// ReAct Loop 路径
RuntimeTransitions[RuntimeStatus.OBSERVING] = [RuntimeStatus.PLANNING, RuntimeStatus.ACTING, RuntimeStatus.COMPLETED, RuntimeStatus.FAILED, RuntimeStatus.CANCELLED];
RuntimeTransitions[RuntimeStatus.ACTING] = [RuntimeStatus.OBSERVING, RuntimeStatus.RECOVERING, RuntimeStatus.FAILED, RuntimeStatus.CANCELLED];
RuntimeTransitions[RuntimeStatus.PLANNING] = [RuntimeStatus.ACTING, RuntimeStatus.OBSERVING, RuntimeStatus.COMPLETED, RuntimeStatus.FAILED, RuntimeStatus.CANCELLED];
RuntimeTransitions[RuntimeStatus.RECOVERING] = [RuntimeStatus.OBSERVING, RuntimeStatus.COMPLETED, RuntimeStatus.FAILED, RuntimeStatus.CANCELLED];

// Loop 路径
RuntimeTransitions[RuntimeStatus.LOOPING] = [RuntimeStatus.OBSERVING, RuntimeStatus.ACTING, RuntimeStatus.COMPLETED, RuntimeStatus.FAILED, RuntimeStatus.CANCELLED, RuntimeStatus.IDLE];

// 终态
RuntimeTransitions[RuntimeStatus.COMPLETED] = [RuntimeStatus.IDLE];
RuntimeTransitions[RuntimeStatus.FAILED] = [RuntimeStatus.IDLE];
RuntimeTransitions[RuntimeStatus.CANCELLED] = [RuntimeStatus.IDLE];

var RuntimeState = {
  current: {
    phase: RuntimeStatus.IDLE,
    metadata: null,
    sessionId: null,
    runId: null,
    startedAt: null,
    updatedAt: null,
    result: null,
    error: null,
    loop: null
  },

  set: function(phase, meta) {
    var transitions = RuntimeTransitions[this.current.phase];
    if (!transitions || transitions.indexOf(phase) === -1) {
      throw new Error(
        "RuntimeState: 非法跃迁 " + this.current.phase + " → " + phase
      );
    }

    this.current.phase = phase;

    if (meta) {
      for (var key in meta) {
        if (meta.hasOwnProperty(key)) {
          this.current.metadata = this.current.metadata || {};
          this.current.metadata[key] = meta[key];
        }
      }
    }

    if (phase === RuntimeStatus.COMPLETED && meta && meta.result !== undefined) {
      this.current.result = meta.result;
    }
    if (phase === RuntimeStatus.FAILED && meta && meta.error !== undefined) {
      this.current.error = meta.error;
    }
    if (phase === RuntimeStatus.CANCELLED) {
      this.current.error = "cancelled";
    }

    if (!this.current.startedAt) {
      this.current.startedAt = Date.now();
    }
    this.current.updatedAt = Date.now();

    RuntimeEvents.emit("runtime_state_changed", this._toPayload());
  },

  setSession: function(sessionId, runId) {
    this.current.sessionId = sessionId;
    this.current.runId = runId;
    if (!this.current.startedAt) {
      this.current.startedAt = Date.now();
    }
    this.current.updatedAt = Date.now();
  },

  get: function() {
    return this.current;
  },

  getPhase: function() {
    return this.current.phase;
  },

  reset: function() {
    var phase = this.current.phase;
    var canReset = false;
    var targets = RuntimeTransitions[phase];
    if (targets && targets.indexOf(RuntimeStatus.IDLE) !== -1) {
      canReset = true;
    }
    if (!canReset) {
      console.warn("RuntimeState: reset 从 " + phase + " 跳过守卫（已容错）");
    }

    this.current = {
      phase: RuntimeStatus.IDLE,
      metadata: null,
      sessionId: this.current.sessionId,
      runId: null,
      startedAt: null,
      updatedAt: Date.now(),
      result: null,
      error: null,
      loop: null
    };

    RuntimeEvents.emit("runtime_state_changed", this._toPayload());
  },

  _toPayload: function() {
    return {
      phase: this.current.phase,
      metadata: this.current.metadata,
      sessionId: this.current.sessionId,
      runId: this.current.runId,
      startedAt: this.current.startedAt,
      updatedAt: this.current.updatedAt,
      result: this.current.result,
      error: this.current.error,
      loop: this.current.loop,
      timestamp: Date.now()
    };
  }
};
