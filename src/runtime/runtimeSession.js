/**
 * runtimeSession.js - Runtime Session System
 *
 * 职责：
 *   1. 管理 sessionId（打开 popup 时创建）
 *   2. newRunId() 每次 run() 生成唯一 runId
 *   3. inject() 只透传 sessionId，不自动生成 runId
 *   4. 管理 ReAct Step Records（steps 数组）
 */

var RuntimeSession = {
  _sessionId: null,
  _runCounter: 0,
  steps: [],
  chatHistory: [],

  init: function() {
    this._sessionId = "s_" + Date.now() + "_" + this._randomStr(6);
    this._runCounter = 0;
    this.steps = [];
    this.chatHistory = [];
  },

  getSessionId: function() {
    if (!this._sessionId) this.init();
    return this._sessionId;
  },

  newRunId: function() {
    this._runCounter++;
    return "r" + this._runCounter + "_" + Date.now() + "_" + this._randomStr(4);
  },

  inject: function(payload) {
    if (!payload) payload = {};
    payload.sessionId = payload.sessionId || this.getSessionId();
    return payload;
  },

  /**
   * addStep(stepRecord)
   *
   * stepRecord: { step, observation, thought, action, toolInput, toolResult, done, timestamp }
   */
  addStep: function(record) {
    if (!record) return;
    record.timestamp = record.timestamp || Date.now();
    this.steps.push(record);
  },

  /**
   * getSteps(maxCount)
   *
   * 返回最近 N 步记录。不传参返回全部。
   */
  getSteps: function(maxCount) {
    var s = this.steps.slice();
    if (maxCount && s.length > maxCount) {
      s = s.slice(s.length - maxCount);
    }
    return s;
  },

  /**
   * buildStepSummary(maxSteps)
   *
   * 构建给 PromptBuilder 的步骤摘要文本。
   */
  buildStepSummary: function(maxSteps) {
    var steps = this.getSteps(maxSteps || 3);
    if (!steps.length) return "";

    var lines = ["", "Previous steps:", ""];
    for (var i = 0; i < steps.length; i++) {
      var s = steps[i];
      lines.push("Step " + s.step + ":");
      if (s.thought) lines.push("  Thought: " + s.thought);
      if (s.action && s.action !== "none") {
        lines.push("  Action: " + s.action);
        if (s.toolInput) lines.push("  Input: " + JSON.stringify(s.toolInput));
        if (s.toolResult) {
          lines.push("  Result: " + (s.toolResult.success ? "Success" : ("Failed - " + (s.toolResult.error || ""))));
        }
      }
      lines.push("");
    }
    return lines.join("\n");
  },

  clear: function() {
    this._sessionId = null;
    this._runCounter = 0;
    this.steps = [];
    this.chatHistory = [];
  },

  addChatMessage: function(role, content) {
    this.chatHistory.push({ role: role, content: content, timestamp: Date.now() });
  },

  getChatHistory: function() {
    return this.chatHistory.slice();
  },

  getChatMessagesForLLM: function() {
    var result = [];
    for (var i = 0; i < this.chatHistory.length; i++) {
      var msg = this.chatHistory[i];
      result.push({ role: msg.role, content: msg.content });
    }
    return result;
  },

  clearChatHistory: function() {
    this.chatHistory = [];
  },

  _randomStr: function(len) {
    var chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    var s = "";
    for (var i = 0; i < len; i++) {
      s += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return s;
  }
};
