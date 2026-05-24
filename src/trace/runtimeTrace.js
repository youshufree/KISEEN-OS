/**
 * RuntimeTrace - 运行时跟踪时间线
 *
 * 职责：
 *   1. 自动监听 RuntimeEvents 全部事件
 *   2. 存储最近 200 条，统一 entry schema
 *   3. 计算配对事件的 durationMs
 *   4. 支持 getAll() / clear()
 */

var RuntimeTrace = {
  logs: [],
  MAX_LOGS: 200,

  init: function() {
    var self = this;
    RuntimeEvents.on("*", function(payload) {
      self.add(payload);
    });
  },

  /**
   * add(payload)
   *
   * payload 已是统一结构 { type, timestamp, sessionId, runId, phase, payload }
   */
  add: function(payload) {
    var entry = {
      type: payload.type || "unknown",
      timestamp: payload.timestamp || Date.now(),
      phase: payload.phase || RuntimeState.getPhase(),
      sessionId: payload.sessionId || null,
      runId: payload.runId || null,
      payload: payload,
      durationMs: null
    };

    entry.durationMs = this._computeDuration(entry.type, entry.timestamp);

    this.logs.push(entry);

    if (this.logs.length > this.MAX_LOGS) {
      this.logs.splice(0, this.logs.length - this.MAX_LOGS);
    }
  },

  _computeDuration: function(eventName, now) {
    var startEvent = null;
    if (eventName === "llm_response") startEvent = "llm_request";
    else if (eventName === "tool_result") startEvent = "tool_execute";
    else if (eventName === "parse_success" || eventName === "parse_retry") startEvent = "parse_start";
    else if (eventName === "runtime_done" || eventName === "runtime_error") startEvent = "runtime_start";
    else if (eventName === "react_step_completed") startEvent = "react_step_started";
    else if (eventName === "react_loop_completed") startEvent = "react_loop_started";
    else if (eventName === "observation_serialized") startEvent = "observation_built";
    else if (eventName === "plan_step_completed") startEvent = "plan_step_started";
    else if (eventName === "plan_completed") startEvent = "plan_started";
    else if (eventName === "browser_action_completed") startEvent = "browser_action_started";
    else if (eventName === "browser_action_failed") startEvent = "browser_action_started";
    if (!startEvent) return null;
    for (var i = this.logs.length - 1; i >= 0; i--) {
      if (this.logs[i].type === startEvent) return now - this.logs[i].timestamp;
    }
    return null;
  },

  getAll: function() {
    return this.logs.slice();
  },

  clear: function() {
    this.logs = [];
  }
};
