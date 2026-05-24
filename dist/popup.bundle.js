
// === events\runtimeEvents.js ===
/**
 * RuntimeEvents - 轻量运行时事件系统
 *
 * 职责：
 *   1. 发布/订阅模式（on / emit / off）
 *   2. 单个 listener 报错不影响其他 listener
 *   3. Scoped 模式：每个 Runtime 实例拥有独立事件通道
 *   4. 全局 on/emit 向后兼容（UI 监听器继续工作）
 *   5. 零依赖
 */

var RuntimeEvents = {
  _listeners: {},
  _scopedListeners: {},

  // ==========================================
  //   全局通道（向后兼容，UI 面使用）
  // ==========================================

  /**
   * on(eventName, handler)
   *
   * 订阅全局事件。同一 handler 不重复注册。
   */
  on: function(eventName, handler) {
    if (!this._listeners[eventName]) {
      this._listeners[eventName] = [];
    }
    var list = this._listeners[eventName];
    if (list.indexOf(handler) === -1) {
      list.push(handler);
    }
  },

  /**
   * emit(eventName, payload)
   *
   * 触发全局事件。每个 listener 在 try/catch 中执行。
   * 单个报错只 console.error，不中断其它 listener。
   * payload 自动注入 type 字段。
   * 同时触发 "*" 通配符 listener。
   */
  emit: function(eventName, payload) {
    var data = payload || {};
    data.type = eventName;

    this._fire(eventName, data);

    if (eventName !== "*") {
      this._fire("*", data);
    }
  },

  /**
   * off(eventName, handler)
   *
   * 取消订阅。不传 handler 则清空该事件所有 listener。
   */
  off: function(eventName, handler) {
    if (!this._listeners[eventName]) return;
    if (!handler) {
      delete this._listeners[eventName];
      return;
    }
    var list = this._listeners[eventName];
    var idx = list.indexOf(handler);
    if (idx !== -1) {
      list.splice(idx, 1);
    }
  },

  // ==========================================
  //   Scoped 通道（Runtime 实例隔离事件）
  // ==========================================

  /**
   * onScoped(runtimeId, eventName, handler)
   *
   * 订阅某个 Runtime 实例的私有事件。
   * 不同 runtimeId 的事件不会互相污染。
   */
  onScoped: function(runtimeId, eventName, handler) {
    if (!runtimeId) return;
    if (!this._scopedListeners[runtimeId]) {
      this._scopedListeners[runtimeId] = {};
    }
    var scope = this._scopedListeners[runtimeId];
    if (!scope[eventName]) {
      scope[eventName] = [];
    }
    var list = scope[eventName];
    if (list.indexOf(handler) === -1) {
      list.push(handler);
    }
  },

  /**
   * offScoped(runtimeId, eventName, handler)
   *
   * 取消 Scoped 订阅。
   */
  offScoped: function(runtimeId, eventName, handler) {
    if (!runtimeId) return;
    var scope = this._scopedListeners[runtimeId];
    if (!scope) return;
    if (!handler) {
      delete scope[eventName];
      return;
    }
    var list = scope[eventName];
    if (!list) return;
    var idx = list.indexOf(handler);
    if (idx !== -1) {
      list.splice(idx, 1);
    }
  },

  /**
   * emitScoped(runtimeId, eventName, payload)
   *
   * 触发 Scoped 事件 + 同时触发全局事件（带 runtimeId 标记）。
   *
   * 这样：
   *   - Scoped listener 只收到自己 runtime 的事件
   *   - 全局 listener（如 RuntimeTrace）收到所有事件，可据 runtimeId 过滤
   */
  emitScoped: function(runtimeId, eventName, payload) {
    var data = payload || {};
    data.type = eventName;
    data.runtimeId = runtimeId;

    if (runtimeId) {
      var scope = this._scopedListeners[runtimeId];
      if (scope && scope[eventName]) {
        var slist = scope[eventName];
        for (var si = 0; si < slist.length; si++) {
          try {
            slist[si](data);
          } catch (err) {
            console.error("RuntimeEvents: scoped listener 执行出错", runtimeId, eventName, err);
          }
        }
      }
    }

    this._fire(eventName, data);

    if (eventName !== "*") {
      this._fire("*", data);
    }
  },

  /**
   * removeScope(runtimeId)
   *
   * 移除某个 Runtime 实例的全部 scoped listener。
   * Runtime 销毁时调用。
   */
  removeScope: function(runtimeId) {
    if (!runtimeId) return;
    delete this._scopedListeners[runtimeId];
  },

  _fire: function(eventName, data) {
    var list = this._listeners[eventName];
    if (!list || !list.length) return;
    for (var i = 0; i < list.length; i++) {
      try {
        list[i](data);
      } catch (err) {
        console.error("RuntimeEvents: listener 执行出错", eventName, err);
      }
    }
  }
};


// === utils\runtimeLogger.js ===
var RuntimeLogger = {

  LEVELS: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, FATAL: 4, NONE: 5 },

  _level: 1,
  _labelMap: { 0: "DBG", 1: "INF", 2: "WRN", 3: "ERR", 4: "FTL" },

  configure: function(options) {
    options = options || {};
    if (options.level !== undefined) this._level = options.level;
  },

  setLevel: function(levelName) {
    var num = this.LEVELS[levelName];
    if (num !== undefined) this._level = num;
  },

  getLevel: function() {
    for (var key in this.LEVELS) {
      if (this.LEVELS[key] === this._level) return key;
    }
    return "INFO";
  },

  _shouldLog: function(levelNum) {
    return levelNum >= this._level;
  },

  _format: function(levelNum, tag, message) {
    var label = this._labelMap[levelNum] || "???";
    return "[" + label + "][" + tag + "] " + message;
  },

  debug: function(tag, message) {
    if (this._shouldLog(0)) console.debug(this._format(0, tag, message));
  },

  info: function(tag, message) {
    if (this._shouldLog(1)) console.log(this._format(1, tag, message));
  },

  warn: function(tag, message) {
    if (this._shouldLog(2)) console.warn(this._format(2, tag, message));
  },

  error: function(tag, message) {
    if (this._shouldLog(3)) console.error(this._format(3, tag, message));
  },

  fatal: function(tag, message) {
    if (this._shouldLog(4)) console.error(this._format(4, tag, message));
  }
};

RuntimeLogger.info("RuntimeLogger", "日志系统已初始化 level=" + RuntimeLogger.getLevel());


// === runtime\runtimeState.js ===
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
  THINKING: "thinking",
  ACTING: "acting",
  REFLECTING: "reflecting",
  PLANNING: "planning",
  EXECUTING_PLAN: "executing_plan",
  EXECUTING_STEP: "executing_step",
  EXECUTING_BROWSER_ACTION: "executing_browser_action",
  WAITING_PAGE_UPDATE: "waiting_page_update",
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
RuntimeTransitions[RuntimeStatus.PARSING_RESPONSE] = [RuntimeStatus.EXECUTING_TOOL, RuntimeStatus.RETRYING_PARSE, RuntimeStatus.COMPLETED, RuntimeStatus.FAILED, RuntimeStatus.CANCELLED, RuntimeStatus.REFLECTING];
RuntimeTransitions[RuntimeStatus.RETRYING_PARSE] = [RuntimeStatus.REQUESTING_LLM, RuntimeStatus.FAILED, RuntimeStatus.CANCELLED];
RuntimeTransitions[RuntimeStatus.EXECUTING_TOOL] = [RuntimeStatus.COMPLETED, RuntimeStatus.FAILED, RuntimeStatus.CANCELLED, RuntimeStatus.REFLECTING];

// ReAct Loop 路径
RuntimeTransitions[RuntimeStatus.OBSERVING] = [RuntimeStatus.THINKING, RuntimeStatus.PLANNING, RuntimeStatus.ACTING, RuntimeStatus.COMPLETED, RuntimeStatus.FAILED, RuntimeStatus.CANCELLED];
RuntimeTransitions[RuntimeStatus.THINKING] = [RuntimeStatus.ACTING, RuntimeStatus.COMPLETED, RuntimeStatus.FAILED, RuntimeStatus.CANCELLED];
RuntimeTransitions[RuntimeStatus.ACTING] = [RuntimeStatus.REFLECTING, RuntimeStatus.OBSERVING, RuntimeStatus.RECOVERING, RuntimeStatus.FAILED, RuntimeStatus.CANCELLED];
RuntimeTransitions[RuntimeStatus.REFLECTING] = [RuntimeStatus.OBSERVING, RuntimeStatus.COMPLETED, RuntimeStatus.FAILED, RuntimeStatus.CANCELLED];

// Plan-driven 路径
RuntimeTransitions[RuntimeStatus.PLANNING] = [RuntimeStatus.EXECUTING_PLAN, RuntimeStatus.ACTING, RuntimeStatus.OBSERVING, RuntimeStatus.COMPLETED, RuntimeStatus.FAILED, RuntimeStatus.CANCELLED];
RuntimeTransitions[RuntimeStatus.EXECUTING_PLAN] = [RuntimeStatus.EXECUTING_STEP, RuntimeStatus.OBSERVING, RuntimeStatus.EXECUTING_TOOL, RuntimeStatus.REQUESTING_LLM, RuntimeStatus.COMPLETED, RuntimeStatus.FAILED, RuntimeStatus.CANCELLED];
RuntimeTransitions[RuntimeStatus.EXECUTING_STEP] = [RuntimeStatus.OBSERVING, RuntimeStatus.EXECUTING_TOOL, RuntimeStatus.EXECUTING_BROWSER_ACTION, RuntimeStatus.REQUESTING_LLM, RuntimeStatus.RECOVERING, RuntimeStatus.EXECUTING_PLAN, RuntimeStatus.COMPLETED, RuntimeStatus.FAILED, RuntimeStatus.CANCELLED];
RuntimeTransitions[RuntimeStatus.EXECUTING_BROWSER_ACTION] = [RuntimeStatus.WAITING_PAGE_UPDATE, RuntimeStatus.EXECUTING_STEP, RuntimeStatus.RECOVERING, RuntimeStatus.EXECUTING_PLAN, RuntimeStatus.COMPLETED, RuntimeStatus.FAILED, RuntimeStatus.CANCELLED];
RuntimeTransitions[RuntimeStatus.WAITING_PAGE_UPDATE] = [RuntimeStatus.OBSERVING, RuntimeStatus.EXECUTING_STEP, RuntimeStatus.EXECUTING_PLAN, RuntimeStatus.COMPLETED, RuntimeStatus.FAILED, RuntimeStatus.CANCELLED];
RuntimeTransitions[RuntimeStatus.RECOVERING] = [RuntimeStatus.EXECUTING_STEP, RuntimeStatus.EXECUTING_PLAN, RuntimeStatus.OBSERVING, RuntimeStatus.COMPLETED, RuntimeStatus.FAILED, RuntimeStatus.CANCELLED];

// ReAct Loop 路径
RuntimeTransitions[RuntimeStatus.LOOPING] = [RuntimeStatus.OBSERVING, RuntimeStatus.THINKING, RuntimeStatus.ACTING, RuntimeStatus.COMPLETED, RuntimeStatus.FAILED, RuntimeStatus.CANCELLED, RuntimeStatus.IDLE];

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


// === runtime\runtimeSession.js ===
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


// === runtime\runtimeQueue.js ===
/**
 * runtimeQueue.js - Runtime 任务队列（最小版本）
 *
 * 职责：
 *   1. 同时只运行一个 Runtime
 *   2. 新任务进入队列，当前任务完成后自动执行下一个
 *   3. 队列最多保留 10 个，超出丢弃最旧
 *   4. cancelAll() 取消当前运行任务 + 清空队列
 */

var RuntimeQueue = {
  queue: [],
  running: false,
  MAX_QUEUE: 10,

  enqueue: function(task) {
    if (this.queue.length >= this.MAX_QUEUE) {
      this.queue.shift();
    }
    this.queue.push(task);
    if (!this.running) {
      this.next();
    }
  },

  next: function() {
    if (this.queue.length === 0) {
      this.running = false;
      return;
    }
    this.running = true;
    var task = this.queue.shift();
    var self = this;

    task.execute()
      .then(function(result) {
        if (task.onComplete) task.onComplete(result);
        self.next();
      })
      .catch(function(err) {
        if (task.onError) task.onError(err);
        self.next();
      });
  },

  cancelAll: function() {
    AgentRuntime.cancel();
    this.queue = [];
    this.running = false;
  }
};


// === trace\traceTypes.js ===
/**
 * traceTypes.js — Runtime Trace 分层 Schema 定义
 *
 * 设计原则：
 *   1. 分层记录：observation | planner | llm | action | result | recovery 各自独立
 *   2. 每层按需填充，不强制全量
 *   3. 字段名与未来 Replay / Training / Analytics 对齐
 *   4. 零依赖
 */

var TracePhase = {
  OBSERVE: "observe",
  THINK: "think",
  ACT: "act",
  RECOVER: "recover",
  REPLAN: "replan"
};

var TraceTypes = {

  /**
   * create(overrides) → 生成一条完整的 TraceEvent
   * overrides 可覆盖所有子层字段
   */
  create: function(overrides) {
    var o = overrides || {};

    return {
      traceId:    o.traceId    || TraceTypes._genId("t"),
      runtimeId:  o.runtimeId  || "",
      sessionId:  o.sessionId  || "",
      taskId:     o.taskId     || "",
      iteration:  o.iteration  || 0,
      timestamp:  o.timestamp  || Date.now(),
      phase:      o.phase      || "unknown",

      observation:  TraceTypes._buildObservation(o.observation),
      planner:      TraceTypes._buildPlanner(o.planner),
      llm:          TraceTypes._buildLLM(o.llm),
      action:       TraceTypes._buildAction(o.action),
      result:       TraceTypes._buildResult(o.result),
      recovery:     TraceTypes._buildRecovery(o.recovery)
    };
  },

  // ==========================================
  //   分层构建
  // ==========================================

  _buildObservation: function(data) {
    if (!data) return null;
    return {
      url:              data.url              || "",
      title:            data.title            || "",
      pageType:         data.pageType         || "unknown",
      domSummary:       data.domSummary       || "",
      interactiveCount: data.interactiveCount || 0,
      visibleCount:     data.visibleCount     || 0,
      formCount:        data.formCount        || 0,
      actionCount:      data.actionCount      || 0,
      snapshotHash:     data.snapshotHash     || ""
    };
  },

  _buildPlanner: function(data) {
    if (!data) return null;
    return {
      currentGoal:     data.currentGoal     || "",
      currentStep:     data.currentStep     || "",
      currentStepDesc: data.currentStepDesc || "",
      remainingSteps:  data.remainingSteps  || 0,
      planId:          data.planId          || "",
      planStatus:      data.planStatus      || "",
      totalSteps:      data.totalSteps      || 0,
      completedSteps:  data.completedSteps  || 0,
      failedSteps:     data.failedSteps     || 0
    };
  },

  _buildLLM: function(data) {
    if (!data) return null;
    return {
      prompt:      data.prompt      || "",
      response:    data.response    || "",
      tokens:      data.tokens      || 0,
      latency:     data.latency     || 0,
      provider:    data.provider    || "deepseek",
      model:       data.model       || "",
      temperature: data.temperature || null
    };
  },

  _buildAction: function(data) {
    if (!data) return null;
    return {
      type:         data.type         || "",
      target:       data.target       || null,
      selector:     data.selector     || "",
      params:       data.params       || null,
      semanticRole: data.semanticRole || ""
    };
  },

  _buildResult: function(data) {
    if (!data) return null;
    return {
      success:    data.success    || false,
      error:      data.error      || null,
      errorCategory: data.errorCategory || null,
      retry:      data.retry      || 0,
      durationMs: data.durationMs || 0,
      data:       data.data       || null,
      observation: data.observation || null
    };
  },

  _buildRecovery: function(data) {
    if (!data) return null;
    return {
      attempted:     data.attempted     || false,
      strategy:      data.strategy      || "",
      result:        data.result        || "",
      errorCategory: data.errorCategory || "",
      attemptNumber: data.attemptNumber || 0,
      reason:        data.reason        || ""
    };
  },

  // ==========================================
  //   便捷工厂方法 — 按 phase 构建
  // ==========================================

  /**
   * observeTrace(meta, observationData)
   */
  observeTrace: function(meta, observationData) {
    return this.create({
      runtimeId:  meta.runtimeId,
      sessionId:  meta.sessionId,
      taskId:     meta.taskId,
      iteration:  meta.iteration,
      timestamp:  meta.timestamp,
      phase:      TracePhase.OBSERVE,
      observation: observationData
    });
  },

  /**
   * thinkTrace(meta, plannerData, llmData)
   */
  thinkTrace: function(meta, plannerData, llmData) {
    return this.create({
      runtimeId:  meta.runtimeId,
      sessionId:  meta.sessionId,
      taskId:     meta.taskId,
      iteration:  meta.iteration,
      timestamp:  meta.timestamp,
      phase:      TracePhase.THINK,
      planner:    plannerData,
      llm:        llmData
    });
  },

  /**
   * actTrace(meta, actionData, resultData)
   */
  actTrace: function(meta, actionData, resultData) {
    return this.create({
      runtimeId:  meta.runtimeId,
      sessionId:  meta.sessionId,
      taskId:     meta.taskId,
      iteration:  meta.iteration,
      timestamp:  meta.timestamp,
      phase:      TracePhase.ACT,
      action:     actionData,
      result:     resultData
    });
  },

  /**
   * recoverTrace(meta, recoveryData, actionData, resultData)
   */
  recoverTrace: function(meta, recoveryData, actionData, resultData) {
    return this.create({
      runtimeId:  meta.runtimeId,
      sessionId:  meta.sessionId,
      taskId:     meta.taskId,
      iteration:  meta.iteration,
      timestamp:  meta.timestamp,
      phase:      TracePhase.RECOVER,
      recovery:   recoveryData,
      action:     actionData || null,
      result:     resultData || null
    });
  },

  /**
   * replanTrace(meta, reason, plannerData)
   */
  replanTrace: function(meta, reason, plannerData) {
    return this.create({
      runtimeId:  meta.runtimeId,
      sessionId:  meta.sessionId,
      taskId:     meta.taskId,
      iteration:  meta.iteration,
      timestamp:  meta.timestamp,
      phase:      TracePhase.REPLAN,
      planner:    plannerData || null,
      recovery:   { reason: reason || "" }
    });
  },

  // ==========================================
  //   工具
  // ==========================================

  _genId: function(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
};


// === trace\traceStore.js ===
/**
 * traceStore.js — Runtime Trace 持久化存储
 *
 * Phase 1 后端：chrome.storage.local
 * 接口抽象：save / query / getSession / getTimeline / clearSession / getStats
 *
 * 容量管理：
 *   - MAX_TRACES_PER_SESSION: 200  每条 session 最多保存条数
 *   - MAX_SESSIONS: 20             最多保留的 session 数
 *   - 超过限制时自动淘汰最早的 session
 *
 * 未来升级路径：
 *   chrome.storage.local → IndexedDB → SQLite WASM → Cloud Trace
 *   只需替换存储后端，接口不变
 */

var TraceStore = {

  STORAGE_KEY: "runtimeTraces",
  MAX_TRACES_PER_SESSION: 50,
  MAX_SESSIONS: 5,

  /**
   * save(traceEvent)
   *
   * 追加一条 TraceEvent 到 chrome.storage.local。
   * 自动按 session 分桶，超限自动淘汰。
   */
  save: function(traceEvent) {
    if (!traceEvent || !traceEvent.sessionId) {
      console.warn("[TraceStore] 缺少 sessionId，放弃保存");
      return;
    }

    var self = this;

    chrome.storage.local.get([this.STORAGE_KEY], function(result) {
      var data = result[self.STORAGE_KEY] || {};
      var sessionId = traceEvent.sessionId;

      if (!data[sessionId]) {
        data[sessionId] = [];
      }

      data[sessionId].push(traceEvent);

      if (data[sessionId].length > self.MAX_TRACES_PER_SESSION) {
        data[sessionId] = data[sessionId].slice(-self.MAX_TRACES_PER_SESSION);
      }

      var sessionIds = Object.keys(data);
      if (sessionIds.length > self.MAX_SESSIONS) {
        sessionIds.sort(function(a, b) {
          var tracesA = data[a] || [];
          var tracesB = data[b] || [];
          var timeA = tracesA.length > 0 ? tracesA[0].timestamp : 0;
          var timeB = tracesB.length > 0 ? tracesB[0].timestamp : 0;
          return timeA - timeB;
        });
        var toDelete = sessionIds.slice(0, sessionIds.length - self.MAX_SESSIONS);
        for (var i = 0; i < toDelete.length; i++) {
          delete data[toDelete[i]];
        }
      }

      chrome.storage.local.set({ [self.STORAGE_KEY]: data }, function() {
        if (chrome.runtime.lastError) {
          console.error("[TraceStore] 保存失败:", chrome.runtime.lastError.message);
        }
      });
    });
  },

  /**
   * query(sessionId, filter, callback)
   *
   * filter: { phase, minTimestamp, maxTimestamp, limit, offset }
   * 异步，通过 callback 返回结果。
   */
  query: function(sessionId, filter, callback) {
    filter = filter || {};
    var self = this;

    chrome.storage.local.get([this.STORAGE_KEY], function(result) {
      var data = result[self.STORAGE_KEY] || {};
      var traces = data[sessionId] || [];

      if (filter.phase) {
        traces = traces.filter(function(t) { return t.phase === filter.phase; });
      }
      if (filter.minTimestamp) {
        traces = traces.filter(function(t) { return t.timestamp >= filter.minTimestamp; });
      }
      if (filter.maxTimestamp) {
        traces = traces.filter(function(t) { return t.timestamp <= filter.maxTimestamp; });
      }

      traces.sort(function(a, b) { return a.timestamp - b.timestamp; });

      if (filter.offset) {
        traces = traces.slice(filter.offset);
      }
      if (filter.limit) {
        traces = traces.slice(0, filter.limit);
      }

      if (typeof callback === "function") {
        callback(traces);
      }
    });
  },

  /**
   * getSession(sessionId, callback)
   *
   * 返回该 session 的全部 trace，按时间排序。
   */
  getSession: function(sessionId, callback) {
    this.query(sessionId, {}, callback);
  },

  /**
   * getTimeline(sessionId, callback)
   *
   * 返回 Timeline 视图：每条 trace 只保留 id/phase/iteration/timestamp 概要。
   */
  getTimeline: function(sessionId, callback) {
    var self = this;
    chrome.storage.local.get([this.STORAGE_KEY], function(result) {
      var data = result[self.STORAGE_KEY] || {};
      var traces = data[sessionId] || [];

      traces.sort(function(a, b) { return a.timestamp - b.timestamp; });

      var timeline = [];
      for (var i = 0; i < traces.length; i++) {
        var t = traces[i];
        timeline.push({
          traceId:   t.traceId,
          phase:     t.phase,
          iteration: t.iteration,
          timestamp: t.timestamp,
          success:   t.result ? t.result.success : null
        });
      }

      if (typeof callback === "function") {
        callback(timeline);
      }
    });
  },

  /**
   * clearSession(sessionId, callback)
   */
  clearSession: function(sessionId, callback) {
    var self = this;
    chrome.storage.local.get([this.STORAGE_KEY], function(result) {
      var data = result[self.STORAGE_KEY] || {};
      delete data[sessionId];
      chrome.storage.local.set({ [self.STORAGE_KEY]: data }, function() {
        if (typeof callback === "function") {
          callback();
        }
      });
    });
  },

  /**
   * getStats(callback)
   *
   * 返回 { sessionCount, totalTraces, sizeKB, sessions: [...] }
   */
  getStats: function(callback) {
    var self = this;
    chrome.storage.local.get([this.STORAGE_KEY], function(result) {
      var data = result[self.STORAGE_KEY] || {};
      var sessionIds = Object.keys(data);
      var totalTraces = 0;
      var sessions = [];

      for (var i = 0; i < sessionIds.length; i++) {
        var sid = sessionIds[i];
        var traces = data[sid] || [];
        totalTraces += traces.length;

        var firstTs = traces.length > 0 ? traces[0].timestamp : 0;
        var lastTs = traces.length > 0 ? traces[traces.length - 1].timestamp : 0;
        var successCount = 0;
        var failureCount = 0;
        for (var j = 0; j < traces.length; j++) {
          if (traces[j].result) {
            if (traces[j].result.success) successCount++;
            else if (traces[j].result.error) failureCount++;
          }
        }

        sessions.push({
          sessionId: sid,
          traceCount: traces.length,
          firstTimestamp: firstTs,
          lastTimestamp: lastTs,
          successCount: successCount,
          failureCount: failureCount
        });
      }

      var sizeKB = 0;
      try {
        sizeKB = Math.round(JSON.stringify(data).length / 1024);
      } catch (e) {}

      if (typeof callback === "function") {
        callback({
          sessionCount: sessionIds.length,
          totalTraces: totalTraces,
          sizeKB: sizeKB,
          maxSessions: self.MAX_SESSIONS,
          maxTracesPerSession: self.MAX_TRACES_PER_SESSION,
          sessions: sessions
        });
      }
    });
  }
};


// === trace\runtimeTrace.js ===
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


// === providers\baseProvider.js ===
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


// === providers\llmProvider.js ===
/**
 * llmProvider.js — LLM 适配器层
 *
 * 基于 BaseProvider 的委托模式。
 * 上层代码通过 LLMProvider.call() 调用，不关心具体 Provider。
 */

var LLMProvider = {
  _current: null,
  _type: null,

  /**
   * setProvider(type, config)
   *
   * type: "deepseek" | "openclaw"
   * config: { apiKey, endpoint, model }
   */
  setProvider: function(type, config) {
    config = config || {};

    if (type === "deepseek") {
      this._current = DeepSeekProvider;
    } else if (type === "openclaw") {
      this._current = OpenClawProvider;
    } else {
      throw new Error("LLMProvider: 未知 provider 类型 " + type);
    }

    if (this._current && this._current.configure) {
      this._current.configure(config);
    }
    this._type = type;
  },

  /**
   * call(options)
   *
   * 委托给当前 provider 的 send()。
   * options: { messages, apiKey, signal, timeout }
   */
  call: async function(options) {
    if (!this._current) {
      throw new Error("LLMProvider: 未设置 provider，请先调用 setProvider()");
    }
    return await this._current.send(options.messages, {
      apiKey: options.apiKey,
      signal: options.signal,
      timeout: options.timeout
    });
  },

  /**
   * getCapabilities()
   */
  getCapabilities: function() {
    return this._current ? Object.assign({}, this._current.capabilities) : null;
  },

  /**
   * hasCapability(name)
   */
  hasCapability: function(name) {
    return this._current ? !!this._current.capabilities[name] : false;
  },

  /**
   * setConfig(options)
   *
   * 向后兼容接口。
   */
  setConfig: function(options) {
    if (!this._current) {
      console.warn("LLMProvider: setConfig 在未设置 provider 时调用");
      return;
    }
    if (this._current.configure) {
      this._current.configure(options);
    }
  }
};


// === tools\toolRegistry.js ===
/**
 * toolRegistry.js — Tool 注册表
 *
 * 职责：
 *   1. 声明所有可用 Tool（name / description / parameters / capability / executor）
 *   2. 不负责执行逻辑
 *   3. 新增 Tool 只需在此文件中添加条目
 */

var ToolRegistry = {
  highlight_keywords: {
    name: "highlight_keywords",
    description: "在网页中高亮显示指定的关键词列表",
    capability: "dom_manipulation",
    parameters: {
      keywords: { type: "array", items: "string", description: "要高亮的关键词列表" }
    },
    executor: async function(params, context) {
      if (!context || !context.activeTab || !context.activeTab.id) {
        throw new Error("Tool: 缺少 RuntimeContext.activeTab");
      }
      return chrome.tabs.sendMessage(context.activeTab.id, {
        type: "execute_action",
        action: "highlight_keywords",
        data: params
      });
    }
  }
};


// === tools\toolDispatcher.js ===
/**
 * toolDispatcher.js — Tool 执行分发器 + Action 兼容层
 *
 * 职责：
 *   1. 根据 toolName 查找 ToolRegistry 中的定义
 *   2. 执行 executor，返回统一 Result Schema
 *   3. 提供 getDefinitions / has / getByCapability / getCapabilities 查询
 *   4. 兼容旧 ActionDispatcher API（getActionNames / execute）
 *
 * 依赖：ToolRegistry（由 toolRegistry.js 定义）
 */

var ToolDispatcher = {
  execute: async function(toolName, params, context) {
    var startedAt = Date.now();
    var tool = ToolRegistry[toolName];
    if (!tool) {
      console.warn("ToolDispatcher: 未知工具", toolName);
      return {
        success: false,
        tool: toolName,
        data: null,
        error: "未知工具: " + toolName,
        durationMs: Date.now() - startedAt
      };
    }
    try {
      var result = await tool.executor(params, context);
      if (result && typeof result === "object") {
        result.tool = result.tool || toolName;
        result.durationMs = result.durationMs || (Date.now() - startedAt);
        return result;
      }
      return {
        success: true,
        tool: toolName,
        data: result,
        error: null,
        durationMs: Date.now() - startedAt
      };
    } catch (err) {
      console.error("ToolDispatcher: 执行失败", toolName, err);
      return {
        success: false,
        tool: toolName,
        data: null,
        error: err.message,
        durationMs: Date.now() - startedAt
      };
    }
  },

  getDefinitions: function() {
    return Object.values(ToolRegistry).map(function(t) {
      return { name: t.name, description: t.description, parameters: t.parameters, capability: t.capability };
    });
  },

  has: function(toolName) {
    return toolName in ToolRegistry;
  },

  getByCapability: function(capability) {
    var results = [];
    for (var name in ToolRegistry) {
      if (ToolRegistry.hasOwnProperty(name) && ToolRegistry[name].capability === capability) {
        results.push(ToolRegistry[name]);
      }
    }
    return results;
  },

  getCapabilities: function() {
    var caps = {};
    for (var name in ToolRegistry) {
      if (ToolRegistry.hasOwnProperty(name)) {
        var cap = ToolRegistry[name].capability;
        if (cap) {
          if (!caps[cap]) caps[cap] = [];
          caps[cap].push(name);
        }
      }
    }
    return caps;
  }
};

// ==========================================
//   ToolActionMapping — Action → Tool 映射表
//   兼容旧 ActionDispatcher API（getActionNames / execute）
// ==========================================

var ToolActionMapping = {
  highlight_keywords: {
    name: "highlight_keywords",
    label: "高亮关键词",
    tool: "highlight_keywords",
    validate: function(data) {
      return data && Array.isArray(data.keywords) && data.keywords.length > 0;
    },
    normalize: function(data) {
      return { keywords: data.keywords || [] };
    }
  },
  none: {
    name: "none",
    label: "无操作",
    tool: null,
    validate: function() { return true; },
    normalize: function() { return null; }
  }
};

var ActionDispatcher = {
  get: function(actionName) {
    return ToolActionMapping[actionName] || null;
  },

  exists: function(actionName) {
    return actionName in ToolActionMapping;
  },

  execute: async function(actionName, data, context) {
    var action = ToolActionMapping[actionName];
    if (!action) {
      console.warn("ActionDispatcher: 未知 action", actionName);
      return { success: false, error: "未知 action: " + actionName };
    }
    if (action.name === "none") return { success: true };

    if (!action.validate(data)) {
      console.warn("ActionDispatcher: 参数校验失败", actionName, data);
      return { success: false, error: "参数校验失败" };
    }

    var params = action.normalize(data);
    return ToolDispatcher.execute(action.tool, params, context);
  },

  getActionNames: function() {
    return Object.values(ToolActionMapping)
      .filter(function(a) { return a.name !== "none"; })
      .map(function(a) { return a.name; });
  }
};


// === prompts\promptBuilder.js ===
function _buildToolSchema() {
  var defs = ToolDispatcher.getDefinitions();
  if (!defs || defs.length === 0) return "";

  var lines = ["", "可用工具：", ""];
  for (var i = 0; i < defs.length; i++) {
    var d = defs[i];
    lines.push((i + 1) + ". " + d.name);
    lines.push("   作用: " + d.description);
    if (d.parameters) {
      var paramKeys = Object.keys(d.parameters);
      var paramTexts = [];
      for (var j = 0; j < paramKeys.length; j++) {
        var pk = paramKeys[j];
        var pd = d.parameters[pk];
        paramTexts.push(pk + ": " + (pd.type || "any") +
          (pd.items ? "<" + pd.items + ">" : ""));
      }
      lines.push("   参数: { " + paramTexts.join(", ") + " }");
    }
    lines.push("");
  }
  return lines.join("\n");
}

var PromptTemplates = {
  summarize: {
    name: "summarize",
    label: "网页分析",
    buildSystem: function(mode) {
      mode = mode || "content";
      var actionNames = ActionDispatcher.getActionNames();
      var actionList = actionNames.length > 0
        ? actionNames.map(function(n) { return '"' + n + '"'; }).join(" / ")
        : '"none"';

      var toolSchema = _buildToolSchema();

      var base = [
        "你是一个网页内容分析助手。",
        "",
        "请分析用户提供的网页内容，并决定是否需要执行操作。",
        toolSchema,
        "",
        "你必须返回合法 JSON，格式如下：",
        "{",
        '  "topic": "网页核心主题",',
        '  "summary": "100字以内总结",',
        '  "keywords": ["关键词1", "关键词2"],',
        '  "sentiment": "positive/neutral/negative",',
        '  "important_points": ["核心观点1", "核心观点2"],',
        '  "action": "' + actionList + '",',
        '  "data": {',
        '    "keywords": ["关键词1", "关键词2"]',
        "  }",
        "}",
        "",
        "要求：",
        "1. 必须返回合法 JSON",
        "2. 不要输出 markdown 代码块",
        "3. 不要添加额外解释",
        "4. keywords 最多 5 个",
        "5. important_points 最多 3 条",
        '6. action 可选值：' + actionList + ' 或 "none"',
        '7. 如果 action 是 "highlight_keywords"，data.keywords 必须是非空数组',
        '8. data 字段由你执行的 action 决定，参考上方工具的参数定义'
      ];

      switch (mode) {
        case "visual":
          return [
            "你是一个网页视觉元素分析师。",
            "",
            "用户将提供页面上所有图片的 URL 和描述信息（JSON 格式）。",
            "请根据图片的 alt 文本、标题和 caption 描述，分析这个页面的视觉内容。",
            "",
            "请判断：页面上的图片主要在展示什么？（产品？人物？风景？图表？）",
            "",
            "你必须返回合法 JSON，格式如下：",
            "{",
            '  "topic": "页面视觉主题",',
            '  "summary": "图片内容总结（100字以内）",',
            '  "keywords": ["视觉关键词1", "视觉关键词2"],',
            '  "sentiment": "positive/neutral/negative",',
            '  "important_points": ["视觉洞察1", "视觉洞察2"],',
            '  "action": "none",',
            '  "data": { "keywords": [] }',
            "}",
            "",
            "要求：",
            "1. 必须返回合法 JSON",
            "2. 不要输出 markdown 代码块",
            "3. keywords 最多 5 个",
            "4. important_points 最多 3 条",
            '5. action 固定为 "none"（视觉分析不需要高亮）'
          ].join("\n");

        case "full":
          return [
            "你是一个网页整体结构分析师。",
            "",
            "请分析用户提供的网页全局内容，包括导航、标题、正文、链接等。",
            "请总结：这个网站/页面是什么类型？核心功能是什么？页面布局和结构特点？",
            ""
          ].concat(base).join("\n");

        case "content":
        default:
          return base.join("\n");
      }
    },

    buildUser: function(pageContent) {
      return "网页内容：\n\n" + pageContent;
    }
  },

  qa: {
    name: "qa",
    label: "页面问答",
    buildSystem: function(mode) {
      return [
        "你是一个网页内容问答助手。",
        "",
        "用户会提供一段网页内容，然后提出一个问题。",
        "请根据网页内容回答用户的问题。",
        "如果网页内容中没有相关信息，请直接说明。",
        "",
        "你必须返回合法 JSON，格式如下：",
        "{",
        '  "answer": "你的回答内容"',
        "}",
        "",
        "要求：",
        "1. 必须返回合法 JSON",
        "2. 不要输出 markdown 代码块",
        "3. 不要添加额外解释",
        "4. answer 控制在 300 字以内"
      ].join("\n");
    },

    buildUser: function(pageContent, question) {
      return "网页内容：\n\n" + pageContent + "\n\n用户问题：" + (question || "");
    }
  },

  chat: {
    name: "chat",
    label: "多轮对话",
    buildSystem: function(mode, pageContent) {
      var lines = [
        "你是 OpenClaw Bridge 助手，一个智能助手。",
        "",
        "你拥有自己的知识库，可以独立回答用户的各种问题。",
        "同时，用户可能正在浏览一个网页，网页内容作为额外的参考资料提供给你。",
        "你可以结合自己的知识和网页内容来给出更准确、更有针对性的回答。",
        "",
        "身份规则：",
        "- 你是 OpenClaw Bridge 助手，不是网页中出现的任何其他 AI",
        "- 如果网页中包含其他 AI 的对话，那些不是你的对话，不要代入它们的身份",
        "",
        "请用中文回答，保持简洁明了。"
      ];

      if (pageContent) {
        lines.push("");
        lines.push("===== 用户当前浏览的网页内容（参考用，不要代入其中角色）=====");
        lines.push("");
        lines.push(pageContent);
        lines.push("");
        lines.push("===== 网页内容结束 =====");
      }

      return lines.join("\n");
    },

    buildUser: function(pageContent, question) {
      return question || "";
    }
  },

  react: {
    name: "react",
    label: "ReAct 循环 Agent",
    buildSystem: function(mode, previousSteps) {
      var toolSchema = _buildToolSchema();
      var actionNames = ActionDispatcher.getActionNames();
      var actionList = actionNames.length > 0
        ? actionNames.map(function(n) { return '"' + n + '"'; }).join(", ")
        : 'none';

      var capabilities = ToolDispatcher.getCapabilities();
      var capLines = [];
      for (var cap in capabilities) {
        if (capabilities.hasOwnProperty(cap)) {
          capLines.push("  - " + cap + ": " + capabilities[cap].join(", "));
        }
      }
      var capabilityText = capLines.length > 0
        ? "\n工具能力分类：\n" + capLines.join("\n")
        : "";

      return [
        "你是一个循环推理 Agent（ReAct Agent）。",
        "",
        "你的工作方式：",
        "1. 观察当前页面（包括页面类型、可交互元素、可用操作）",
        "2. 思考下一步应该做什么",
        "3. 执行一个工具操作",
        "4. 观察操作后的结果",
        "5. 重复直到任务完成",
        "",
        "观察信息包含：",
        "- 页面类型（文章/表单/列表/仪表盘/对话页/其他）",
        "- 可交互元素（按钮、链接、输入框等）",
        "- 可用操作列表",
        "- 页面文本内容",
        "",
        "每次只执行一步。如果任务完成，设置 done=true。",
        "",
        toolSchema,
        capabilityText,
        "",
        "当前目标：" + (mode || "分析并处理当前网页"),
        previousSteps,
        "",
        "你必须返回合法 JSON，格式如下：",
        "{",
        '  "thought": "你的推理过程：当前页面是什么，有哪些可交互元素，为什么要执行这个操作",',
        '  "action": "' + actionList + '",',
        '  "data": {},',
        '  "done": false,',
        '  "finalAnswer": null',
        "}",
        "",
        "如果任务完成：",
        "{",
        '  "thought": "任务已完成的总结",',
        '  "done": true,',
        '  "finalAnswer": "对用户的最终回答"',
        "}",
        "",
        "要求：",
        "1. 必须返回合法 JSON",
        "2. 不要输出 markdown 代码块",
        "3. 不要添加额外解释",
        "4. thought 必须包含推理过程，包括对页面可操作性的判断",
        "5. 每次只执行一个 action",
        "6. done=true 时不需要 action 字段",
        "7. finalAnswer 只在 done=true 时需要",
        "8. 如果当前页面已经足够回答，直接 done=true",
        "9. 优先利用页面中的可交互元素来完成操作"
      ].join("\n");
    },

    buildUser: function(observation) {
      return "当前页面观察：\n\n" + observation;
    }
  },

  planner: {
    name: "planner",
    label: "任务规划器",
    buildSystem: function(mode, previousSteps) {
      var capabilities = ToolDispatcher.getCapabilities();
      var capLines = [];
      for (var cap in capabilities) {
        if (capabilities.hasOwnProperty(cap)) {
          capLines.push("  - " + cap + ": " + capabilities[cap].join(", "));
        }
      }
      var capabilityText = capLines.length > 0
        ? capLines.join("\n")
        : "  (无可用能力)";

      var actionCapabilities = ActionRegistry.getCapabilities();
      var actionCapLines = [];
      for (var acap in actionCapabilities) {
        if (actionCapabilities.hasOwnProperty(acap)) {
          actionCapLines.push("  - " + acap + ": " + actionCapabilities[acap].join(", "));
        }
      }
      var actionCapabilityText = actionCapLines.length > 0
        ? actionCapLines.join("\n")
        : "  (无可用操作)";

      var toolSchema = _buildToolSchema();

      var actionDefs = ActionRegistry.getDefinitions();
      var actionSchemaLines = ["Browser Actions:"];
      for (var ad = 0; ad < actionDefs.length; ad++) {
        var adef = actionDefs[ad];
        var paramStr = "";
        for (var pk in adef.parameters) {
          if (adef.parameters.hasOwnProperty(pk)) {
            paramStr += pk + "(" + adef.parameters[pk].type + ") ";
          }
        }
        actionSchemaLines.push("  - " + adef.name + ": " + adef.description + " | 参数: " + paramStr);
      }
      var actionSchemaText = actionSchemaLines.join("\n");

      return [
        "你是一个任务规划器（Planner）。",
        "",
        "你的职责：根据用户任务和页面观察，制定执行计划。",
        "你只负责规划，不负责执行。",
        "",
        "可用工具能力：",
        capabilityText,
        "",
        toolSchema,
        "",
        "可用浏览器操作能力：",
        actionCapabilityText,
        "",
        actionSchemaText,
        "",
        "步骤类型说明：",
        '- observe: 重新观察页面（获取最新状态）',
        '- tool: 调用工具执行操作（需指定 tool 名称和 input）',
        '- browser_action: 执行浏览器操作（需指定 action 名称和 input）',
        '- respond: 生成最终回答（任务完成）',
        "",
        "browser_action 示例：",
        '{ "id": "step_2", "type": "browser_action", "action": "click_element", "input": { "selector": "#submit-btn" }, "description": "点击提交按钮", "reason": "提交表单" }',
        '{ "id": "step_3", "type": "browser_action", "action": "input_text", "input": { "selector": "input[name=q]", "text": "搜索内容" }, "description": "输入搜索词", "reason": "填写搜索框" }',
        "",
        "Tab 管理操作（跨标签页任务）：",
        "- open_tab: 打开新标签页并切换 Agent 目标到该 Tab，参数: { url: \"https://...\" }",
        "- switch_tab: 切换 Agent 操作目标到已有标签页，参数: { tabId: 数字 }",
        "- close_tab: 关闭指定标签页，参数: { tabId: 数字 }（可选，不传则关闭当前目标 Tab）",
        "- 如果任务需要在多个页面间操作，使用 open_tab / switch_tab 管理标签页",
        "- open_tab 后必须等待页面加载完成再执行后续操作",
        "- 跨 Tab 任务：先在来源页提取内容，switch_tab 切换目标页，再执行写入操作",
        "",
        previousSteps ? "之前的执行记录：\n" + previousSteps + "\n" : "",
        "你必须返回合法 JSON，格式如下：",
        "{",
        '  "goal": "任务目标",',
        '  "strategy": "执行策略说明",',
        '  "steps": [',
        '    {',
        '      "id": "step_1",',
        '      "type": "observe",',
        '      "description": "观察页面结构"',
        '      "tool": null,',
        '      "input": {},',
        '      "reason": "需要了解页面当前状态"',
        '    },',
        '    {',
        '      "id": "step_2",',
        '      "type": "browser_action",',
        '      "description": "点击搜索按钮",',
        '      "action": "click_element",',
        '      "input": { "selector": "#search-btn" },',
        '      "reason": "触发搜索"',
        '    },',
        '    {',
        '      "id": "step_3",',
        '      "type": "tool",',
        '      "description": "高亮关键词",',
        '      "tool": "highlight_keywords",',
        '      "input": { "keywords": ["关键词1"] },',
        '      "reason": "标记重要内容",',
        '    },',
        '    {',
        '      "id": "step_3",',
        '      "type": "respond",',
        '      "description": "生成最终回答",',
        '      "tool": null,',
        '      "input": {},',
        '      "reason": "所有操作完成，需要回答用户"',
        '    }',
        '  ]',
        "}",
        "",
        "要求：",
        "1. 必须返回合法 JSON",
        "2. 不要输出 markdown 代码块",
        "3. 不要添加额外解释",
        "4. steps 最多 5 步",
        "5. 最后一步必须是 type=respond",
        "6. type=tool 时必须指定 tool 和 input",
        "7. type=browser_action 时必须指定 action 和 input",
        "8. 每个步骤必须有 id、type、description、reason",
        "8. strategy 要简洁说明整体思路",
        "9. 如果任务简单，可以只有 1-2 步"
      ].join("\n");
    },

    buildUser: function(observation, question) {
      return "用户任务：" + (question || "分析当前网页") + "\n\n页面观察：\n\n" + (observation || "无观察数据");
    }
  }
};

var PromptBuilder = {
  build: function(templateName, pageContent, mode, question, previousSteps) {
    var template = PromptTemplates[templateName];
    if (!template) {
      console.error("PromptBuilder: 未知模板", templateName);
      return null;
    }

    var systemContent;
    if (templateName === "react") {
      systemContent = template.buildSystem(mode || "content", previousSteps || "");
    } else if (templateName === "planner") {
      systemContent = template.buildSystem(mode || "content", previousSteps || "");
    } else {
      systemContent = template.buildSystem(mode || "content");
    }

    return {
      system: systemContent,
      user: template.buildUser
        ? template.buildUser(pageContent, question)
        : "网页内容：\n\n" + pageContent
    };
  },

  getTemplate: function(templateName) {
    return PromptTemplates[templateName] || null;
  },

  getTemplateNames: function() {
    return Object.keys(PromptTemplates);
  }
};


// === observation\observationBuilder.js ===
var ObservationBuilder = {

  build: function(snapshot, context) {
    if (!snapshot) {
      return this._emptyObservation();
    }

    context = context || {};

    var pageType = snapshot.pageType || this._inferPageType(snapshot);
    var availableActions = this._inferAvailableActions(snapshot, pageType);
    var summary = this._buildSummary(snapshot, pageType);
    var semanticSummary = this._buildSemanticSummary(snapshot, pageType, availableActions);
    var observationText = this._buildObservationText(snapshot, pageType, availableActions, semanticSummary);

    var observation = {
      summary: summary,
      pageType: pageType,
      semanticSummary: semanticSummary,
      interactiveElements: snapshot.interactiveElements || [],
      availableActions: availableActions,
      forms: snapshot.forms || [],
      pageMeta: snapshot.pageMeta || {},
      observationText: observationText
    };

    RuntimeEvents.emit("observation_built", {
      type: "observation_built",
      timestamp: Date.now(),
      payload: {
        pageType: pageType,
        interactiveCount: (snapshot.interactiveElements || []).length,
        formCount: (snapshot.forms || []).length,
        actionCount: availableActions.length
      }
    });

    return observation;
  },

  _inferPageType: function(snapshot) {
    var forms = snapshot.forms || [];
    var interactiveElements = snapshot.interactiveElements || [];
    var links = snapshot.links || [];
    var inputs = snapshot.inputs || [];

    var visibleInteractive = [];
    for (var i = 0; i < interactiveElements.length; i++) {
      if (interactiveElements[i].visible) {
        visibleInteractive.push(interactiveElements[i]);
      }
    }

    if (forms.length > 0 && inputs.length > 3) return "form";

    if (links.length > 15 && visibleInteractive.length < 10) return "list";

    if (snapshot.textContent && snapshot.textContent.length > 500 && visibleInteractive.length < 5) {
      return "article";
    }

    if (snapshot.buttons && snapshot.buttons.length > 5 && forms.length === 0) {
      return "dashboard";
    }

    if (snapshot.pageMeta && snapshot.pageMeta.url) {
      var url = snapshot.pageMeta.url;
      if (url.indexOf("chat") !== -1 || url.indexOf("message") !== -1) {
        return "chat";
      }
    }

    if (visibleInteractive.length > 10 && forms.length === 0) {
      return "dashboard";
    }

    return "other";
  },

  _inferAvailableActions: function(snapshot, pageType) {
    var actions = [];
    var interactiveElements = snapshot.interactiveElements || [];
    var forms = snapshot.forms || [];

    for (var i = 0; i < interactiveElements.length; i++) {
      var el = interactiveElements[i];
      if (!el.visible) continue;

      if (el.tag === "button" && el.text) {
        actions.push("点击「" + el.text + "」按钮");
      } else if (el.tag === "a" && el.text) {
        actions.push("点击「" + el.text + "」链接");
      }

      if (actions.length >= 10) break;
    }

    for (var f = 0; f < forms.length; f++) {
      var form = forms[f];
      if (form.inputs && form.inputs.length > 0) {
        var inputNames = [];
        for (var j = 0; j < form.inputs.length; j++) {
          var input = form.inputs[j];
          if (input.name) inputNames.push(input.name);
          else if (input.placeholder) inputNames.push(input.placeholder);
        }
        if (inputNames.length > 0) {
          actions.push("填写表单（" + inputNames.slice(0, 3).join("、") + "）");
        }
      }
    }

    return actions;
  },

  _buildSummary: function(snapshot, pageType) {
    var meta = snapshot.pageMeta || {};
    var parts = [];

    if (meta.title) parts.push("标题：" + meta.title);
    parts.push("类型：" + this._pageTypeLabel(pageType));

    var interactiveCount = (snapshot.interactiveElements || []).length;
    var visibleCount = 0;
    for (var i = 0; i < (snapshot.interactiveElements || []).length; i++) {
      if (snapshot.interactiveElements[i].visible) visibleCount++;
    }
    parts.push("可交互元素：" + interactiveCount + " 个（可见 " + visibleCount + " 个）");

    if (snapshot.forms && snapshot.forms.length > 0) {
      parts.push("表单：" + snapshot.forms.length + " 个");
    }

    return parts.join(" | ");
  },

  // ==========================================
  //   语义摘要（启发式，不调 LLM）
  // ==========================================

  _buildSemanticSummary: function(snapshot, pageType, availableActions) {
    var layout = snapshot.layout || {};
    var meta = snapshot.pageMeta || {};
    var buttons = snapshot.buttons || [];
    var links = snapshot.links || [];
    var inputs = snapshot.inputs || [];
    var forms = snapshot.forms || [];

    var pagePurpose = this._describePurpose(pageType, meta, buttons, links, inputs);
    var functionalAreas = this._describeAreas(layout, buttons, links, inputs, forms);
    var recommendedApproach = this._suggestApproach(pageType, layout, buttons, inputs, forms);
    var primaryActions = this._pickPrimaryActions(availableActions, pageType, layout);
    var layoutHints = this._describeLayout(layout);

    return {
      pagePurpose: pagePurpose,
      functionalAreas: functionalAreas,
      recommendedApproach: recommendedApproach,
      primaryActions: primaryActions,
      layoutHints: layoutHints
    };
  },

  _describePurpose: function(pageType, meta, buttons, links, inputs) {
    var purposes = {
      article: "文章/阅读页面，主要内容为文字信息",
      form: "表单页面，用于填写和提交数据",
      list: "列表/导航页面，包含大量链接",
      dashboard: "仪表盘/应用页面，包含多个功能按钮",
      chat: "对话/聊天页面",
      other: "通用网页"
    };

    var purpose = purposes[pageType] || purposes.other;

    if (links.length > 20 && inputs.length < 2) {
      purpose += "，以链接导航为主";
    }
    if (buttons.length > 10) {
      purpose += "，包含大量操作按钮";
    }
    if (inputs.length > 5) {
      purpose += "，包含多个输入框";
    }

    return purpose;
  },

  _describeAreas: function(layout, buttons, links, inputs, forms) {
    var areas = [];

    if (layout.hasHeader || layout.hasNav) {
      var headerDesc = "顶部区域：";
      var headerParts = [];
      if (layout.hasNav) headerParts.push("导航栏");
      if (layout.hasSearchInput) headerParts.push("搜索框");
      headerDesc += headerParts.length > 0 ? headerParts.join("、") : "页面头部";
      areas.push({ name: "页面顶部", description: headerDesc, position: "顶部" });
    }

    areas.push({
      name: "主内容区",
      description: "页面主体内容区域" + (layout.dominantTag ? "（以" + layout.dominantTag + "元素为主）" : ""),
      position: "中部"
    });

    if (layout.hasSidebar) {
      areas.push({
        name: "侧边栏",
        description: "辅助导航或信息区域",
        position: layout.mainColumnCount > 1 ? "右侧" : "左侧"
      });
    }

    if (forms.length > 0) {
      areas.push({
        name: "表单区域",
        description: forms.length + " 个表单",
        position: "主内容区内"
      });
    }

    if (layout.hasFooter) {
      areas.push({
        name: "页面底部",
        description: "页脚区域",
        position: "底部"
      });
    }

    return areas;
  },

  _suggestApproach: function(pageType, layout, buttons, inputs, forms) {
    if (pageType === "form" && forms.length > 0) {
      var firstForm = forms[0];
      if (firstForm.inputs && firstForm.inputs.length > 0) {
        return "依次填写表单字段后提交";
      }
    }

    if (layout.hasSearchInput) {
      return "先在搜索框中输入关键词，再点击搜索结果";
    }

    if (pageType === "list" || pageType === "dashboard") {
      return "点击列表中第一个相关链接或按钮";
    }

    if (buttons.length > 0) {
      var primaryBtn = buttons[0];
      if (primaryBtn.text) {
        return "可直接点击「" + primaryBtn.text + "」按钮";
      }
    }

    return "观察页面内容后选择合适操作";
  },

  _pickPrimaryActions: function(availableActions, pageType, layout) {
    var actions = [];

    var searchKeywords = ["搜索", "search", "查找", "查询"];
    for (var i = 0; i < availableActions.length; i++) {
      var act = availableActions[i].toLowerCase();
      for (var k = 0; k < searchKeywords.length; k++) {
        if (act.indexOf(searchKeywords[k]) !== -1) {
          if (actions.indexOf(availableActions[i]) === -1) {
            actions.push(availableActions[i]);
          }
          break;
        }
      }
    }

    for (var j = 0; j < availableActions.length; j++) {
      if (actions.length >= 5) break;
      if (actions.indexOf(availableActions[j]) === -1) {
        actions.push(availableActions[j]);
      }
    }

    if (actions.length === 0 && availableActions.length > 0) {
      actions = availableActions.slice(0, 5);
    }

    return actions;
  },

  _describeLayout: function(layout) {
    var hints = [];

    if (layout.dominantTag === "a" && !layout.hasSearchInput) {
      hints.push("以链接为主的导航页面");
    }
    if (layout.dominantTag === "button") {
      hints.push("以按钮操作为主的应用页面");
    }
    if (layout.hasNav && layout.hasMainContent) {
      hints.push("标准页面布局：导航+内容");
    }

    return hints;
  },

  // ==========================================
  //   观察文本构建（包含语义摘要）
  // ==========================================

  _buildObservationText: function(snapshot, pageType, availableActions, semanticSummary) {
    var lines = [];
    var meta = snapshot.pageMeta || {};

    lines.push("=== 页面理解 ===");
    lines.push("");

    if (semanticSummary) {
      lines.push("📄 " + semanticSummary.pagePurpose);
      lines.push("");

      if (semanticSummary.functionalAreas && semanticSummary.functionalAreas.length > 0) {
        lines.push("页面结构：");
        for (var ai = 0; ai < semanticSummary.functionalAreas.length; ai++) {
          var area = semanticSummary.functionalAreas[ai];
          lines.push("  · " + area.name + "（" + area.position + "）：" + area.description);
        }
        lines.push("");
      }

      if (semanticSummary.recommendedApproach) {
        lines.push("💡 推荐方式：" + semanticSummary.recommendedApproach);
        lines.push("");
      }

      if (semanticSummary.layoutHints && semanticSummary.layoutHints.length > 0) {
        for (var lh = 0; lh < semanticSummary.layoutHints.length; lh++) {
          lines.push("ℹ️ " + semanticSummary.layoutHints[lh]);
        }
        lines.push("");
      }
    }

    lines.push("=== 页面信息 ===");
    if (meta.title) lines.push("标题：" + meta.title);
    if (meta.url) lines.push("URL：" + meta.url);
    lines.push("页面类型：" + this._pageTypeLabel(pageType));
    lines.push("");

    if (semanticSummary && semanticSummary.primaryActions && semanticSummary.primaryActions.length > 0) {
      lines.push("=== 建议操作 ===");
      for (var pk = 0; pk < semanticSummary.primaryActions.length; pk++) {
        lines.push("  " + (pk + 1) + ". " + semanticSummary.primaryActions[pk]);
      }
      lines.push("");
    }

    var visibleElements = [];
    var interactiveElements = snapshot.interactiveElements || [];
    for (var vi = 0; vi < interactiveElements.length; vi++) {
      if (interactiveElements[vi].visible) {
        visibleElements.push(interactiveElements[vi]);
      }
    }

    if (visibleElements.length > 0) {
      lines.push("=== 可交互元素（" + visibleElements.length + " 个可见）===");
      var maxEl = Math.min(visibleElements.length, 15);
      for (var j = 0; j < maxEl; j++) {
        var el = visibleElements[j];
        var desc = "  [" + el.tag.toUpperCase() + "]";
        if (el.text) desc += " 「" + el.text + "」";
        if (el.selector) desc += " selector=" + el.selector;
        if (el.type) desc += " type=" + el.type;
        lines.push(desc);
      }
      if (visibleElements.length > 15) {
        lines.push("  ... 还有 " + (visibleElements.length - 15) + " 个元素");
      }
    }

    var pageText = snapshot.textContent || "";
    if (pageText.length > 0) {
      var maxTextLen = 1200;
      var textPreview = pageText.substring(0, maxTextLen);
      lines.push("");
      lines.push("=== 页面内容 ===");
      lines.push(textPreview);
      if (pageText.length > maxTextLen) {
        lines.push("...（已截断，总长 " + pageText.length + " 字符）");
      }
    }

    return lines.join("\n");
  },

  // ==========================================
  //   工具方法
  // ==========================================

  _pageTypeLabel: function(pageType) {
    var labels = {
      article: "文章/阅读页",
      form: "表单页",
      list: "列表/导航页",
      dashboard: "仪表盘/应用页",
      chat: "对话页",
      other: "其他"
    };
    return labels[pageType] || "其他";
  },

  _emptyObservation: function() {
    return {
      summary: "无页面信息",
      pageType: "other",
      semanticSummary: null,
      interactiveElements: [],
      availableActions: [],
      forms: [],
      pageMeta: {},
      observationText: "无页面观察数据"
    };
  }
};


// === observation\observationSerializer.js ===
/**
 * ObservationSerializer - Observation Token 大小控制层
 *
 * 职责：
 *   1. 将 Observation 序列化为 LLM 可消费的文本
 *   2. 控制 Token 大小（maxTextLength / includeDOM / includeForms / includeImages）
 *   3. 避免 Observation 无限膨胀
 *   4. 发射 observation_serialized 事件
 *
 * 运行环境：SidePanel / Popup
 */

var ObservationSerializer = {

  DEFAULT_OPTIONS: {
    maxTextLength: 4000,
    includeDOM: true,
    includeForms: true,
    includeImages: false,
    maxInteractiveElements: 15,
    maxForms: 5,
    maxActions: 8
  },

  /**
   * serialize(observation, options)
   *
   * observation: ObservationBuilder.build() 的返回值
   * options: {
   *   maxTextLength: 4000,
   *   includeDOM: true,
   *   includeForms: true,
   *   includeImages: false,
   *   maxInteractiveElements: 15,
   *   maxForms: 5,
   *   maxActions: 8
   * }
   *
   * 返回：string（给 LLM 的观察文本）
   */
  serialize: function(observation, options) {
    if (!observation) return "无页面观察数据";

    var opts = this._mergeOptions(options);
    var lines = [];

    lines.push("=== 页面观察 ===");
    lines.push("");

    if (observation.summary) {
      lines.push(observation.summary);
      lines.push("");
    }

    if (observation.observationText) {
      var text = observation.observationText;
      if (text.length > opts.maxTextLength) {
        text = text.substring(0, opts.maxTextLength) + "\n...（内容已截断）";
      }
      lines.push(text);
    }

    if (opts.includeDOM && observation.interactiveElements) {
      var elements = observation.interactiveElements;
      var visibleElements = [];
      for (var i = 0; i < elements.length; i++) {
        if (elements[i].visible) visibleElements.push(elements[i]);
      }

      if (visibleElements.length > 0) {
        lines.push("");
        lines.push("=== DOM 可交互元素（" + visibleElements.length + " 个可见）===");

        var count = Math.min(visibleElements.length, opts.maxInteractiveElements);
        for (var j = 0; j < count; j++) {
          var el = visibleElements[j];
          var desc = "  " + (j + 1) + ". [" + el.tag.toUpperCase() + "]";
          if (el.text) desc += " 「" + el.text + "」";
          if (el.selector) desc += " selector=" + el.selector;
          if (el.type) desc += " type=" + el.type;
          if (el.href) desc += " href=" + el.href.substring(0, 80);
          lines.push(desc);
        }

        if (visibleElements.length > opts.maxInteractiveElements) {
          lines.push("  ... 还有 " + (visibleElements.length - opts.maxInteractiveElements) + " 个元素未显示");
        }
      }
    }

    if (opts.includeForms && observation.forms && observation.forms.length > 0) {
      lines.push("");
      lines.push("=== 表单结构 ===");

      var formCount = Math.min(observation.forms.length, opts.maxForms);
      for (var f = 0; f < formCount; f++) {
        var form = observation.forms[f];
        var formDesc = "  表单" + (f + 1);
        if (form.id) formDesc += " (#" + form.id + ")";
        if (form.action) formDesc += " action=" + form.action.substring(0, 80);
        formDesc += " method=" + (form.method || "get");
        lines.push(formDesc);

        if (form.inputs) {
          for (var inp = 0; inp < form.inputs.length && inp < 8; inp++) {
            var input = form.inputs[inp];
            var inputDesc = "    - " + input.tag;
            if (input.type) inputDesc += " type=" + input.type;
            if (input.name) inputDesc += " name=" + input.name;
            if (input.placeholder) inputDesc += " placeholder=\"" + input.placeholder + "\"";
            lines.push(inputDesc);
          }
          if (form.inputs.length > 8) {
            lines.push("    ... 还有 " + (form.inputs.length - 8) + " 个输入项");
          }
        }
      }
    }

    if (observation.availableActions && observation.availableActions.length > 0) {
      lines.push("");
      lines.push("=== 可用操作 ===");
      var actionCount = Math.min(observation.availableActions.length, opts.maxActions);
      for (var a = 0; a < actionCount; a++) {
        lines.push("  " + (a + 1) + ". " + observation.availableActions[a]);
      }
    }

    var result = lines.join("\n");

    RuntimeEvents.emit("observation_serialized", {
      type: "observation_serialized",
      timestamp: Date.now(),
      payload: {
        totalLength: result.length,
        interactiveCount: observation.interactiveElements ? observation.interactiveElements.length : 0,
        formCount: observation.forms ? observation.forms.length : 0,
        truncated: result.length >= opts.maxTextLength
      }
    });

    return result;
  },

  /**
   * serializeCompact(observation)
   *
   * 精简版序列化，只保留核心信息。
   * 用于 Token 预算紧张的场景。
   */
  serializeCompact: function(observation) {
    return this.serialize(observation, {
      maxTextLength: 2000,
      includeDOM: true,
      includeForms: false,
      includeImages: false,
      maxInteractiveElements: 8,
      maxForms: 2,
      maxActions: 5
    });
  },

  /**
   * getObservationStats(observation)
   *
   * 返回观察数据的统计信息，供 UI Trace 面板使用。
   */
  getObservationStats: function(observation) {
    if (!observation) return {};

    var interactiveCount = observation.interactiveElements ? observation.interactiveElements.length : 0;
    var visibleCount = 0;
    if (observation.interactiveElements) {
      for (var i = 0; i < observation.interactiveElements.length; i++) {
        if (observation.interactiveElements[i].visible) visibleCount++;
      }
    }

    return {
      pageType: observation.pageType || "unknown",
      interactiveCount: interactiveCount,
      visibleInteractiveCount: visibleCount,
      formCount: observation.forms ? observation.forms.length : 0,
      actionCount: observation.availableActions ? observation.availableActions.length : 0,
      observationSize: observation.observationText ? observation.observationText.length : 0
    };
  },

  _mergeOptions: function(options) {
    if (!options) return this.DEFAULT_OPTIONS;

    var merged = {};
    for (var key in this.DEFAULT_OPTIONS) {
      if (this.DEFAULT_OPTIONS.hasOwnProperty(key)) {
        merged[key] = options.hasOwnProperty(key) ? options[key] : this.DEFAULT_OPTIONS[key];
      }
    }
    return merged;
  }
};


// === observation\observationFetcher.js ===
var ObservationFetcher = {
  // 全局超时常量（毫秒）
  FETCH_TIMEOUT: 5000,

  /**
   * fetch(context) - 获取页面观察信息
   * @param {Object} context - {activeTab: {id, url, title}}
   * @returns {Promise<Object|null>}
   */
  fetch: async function(context) {
    if (!context || !context.activeTab || !context.activeTab.id) {
      return null;
    }

    try {
      // ✅ 使用 Promise.race() 实现超时控制
      var response = await Promise.race([
        this._fetchWithMessage(context.activeTab.id),
        this._timeout(this.FETCH_TIMEOUT)
      ]);

      if (response && response.snapshot) {
        return response.snapshot;
      }

      return null;
    } catch (e) {
      console.warn("[ObservationFetcher] 获取失败:", e.message);
      // 区分超时和其他错误
      if (e.message === 'OBSERVATION_TIMEOUT') {
        console.error("[ObservationFetcher] 超时: Content Script无响应");
      }
      return null;
    }
  },

  /**
   * 发送消息获取观察
   * @private
   */
  _fetchWithMessage: function(tabId) {
    return new Promise((resolve, reject) => {
      try {
        chrome.tabs.sendMessage(
          tabId,
          { action: "getObservation" },
          (response) => {
            // 检查chrome API错误
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            resolve(response);
          }
        );
      } catch (err) {
        reject(err);
      }
    });
  },

  /**
   * 超时Promise
   * @private
   */
  _timeout: function(ms) {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error('OBSERVATION_TIMEOUT'));
      }, ms);
    });
  }
};


// === planner\taskGraph.js ===
/**
 * TaskGraph - 任务图管理
 *
 * 职责：
 *   1. 将 Planner 输出的 Plan 转换为可执行的任务图
 *   2. 管理 Step 状态（pending / running / completed / failed / skipped）
 *   3. 提供 getNextStep() 供 Executor 消费
 *   4. 支持可序列化、可追踪、可恢复、可中断
 *   5. 不负责执行（由 planExecutor.js 负责）
 *
 * Step Schema:
 *   {
 *     id: "step_1",
 *     type: "observe" | "tool" | "respond",
 *     status: "pending" | "running" | "completed" | "failed" | "skipped",
 *     description: "...",
 *     tool: "highlight_keywords",      (仅 type=tool)
 *     input: {},                        (仅 type=tool)
 *     result: null,
 *     startedAt: null,
 *     completedAt: null
 *   }
 */

var StepStatus = {
  PENDING: "pending",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  SKIPPED: "skipped"
};

var TaskGraph = {
  _plan: null,
  _steps: [],
  _goal: "",
  _strategy: "",
  _createdAt: null,

  /**
   * create(plan)
   *
   * plan: Planner 输出的结构化 Plan
   *   { goal, strategy, steps: [{ id, type, description, tool?, reason? }] }
   *
   * 返回：TaskGraph 实例（this）
   */
  create: function(plan) {
    this._plan = plan;
    this._goal = plan.goal || "";
    this._strategy = plan.strategy || "";
    this._createdAt = Date.now();
    this._steps = [];

    var planSteps = plan.steps || [];
    for (var i = 0; i < planSteps.length; i++) {
      var s = planSteps[i];
      this._steps.push({
        id: s.id || ("step_" + (i + 1)),
        type: s.type || "respond",
        status: StepStatus.PENDING,
        description: s.description || "",
        tool: s.tool || null,
        reason: s.reason || null,
        input: s.input || {},
        result: null,
        startedAt: null,
        completedAt: null
      });
    }

    return this;
  },

  /**
   * getNextStep()
   *
   * 返回下一个 pending 状态的 step，如果没有则返回 null。
   */
  getNextStep: function() {
    for (var i = 0; i < this._steps.length; i++) {
      if (this._steps[i].status === StepStatus.PENDING) {
        return this._steps[i];
      }
    }
    return null;
  },

  /**
   * getStep(stepId)
   */
  getStep: function(stepId) {
    for (var i = 0; i < this._steps.length; i++) {
      if (this._steps[i].id === stepId) return this._steps[i];
    }
    return null;
  },

  /**
   * startStep(stepId)
   *
   * 将 step 状态从 pending → running。
   */
  startStep: function(stepId) {
    var step = this.getStep(stepId);
    if (!step) return false;
    if (step.status !== StepStatus.PENDING) return false;
    step.status = StepStatus.RUNNING;
    step.startedAt = Date.now();
    return true;
  },

  /**
   * completeStep(stepId, result)
   *
   * 将 step 状态从 running → completed。
   */
  completeStep: function(stepId, result) {
    var step = this.getStep(stepId);
    if (!step) return false;
    if (step.status !== StepStatus.RUNNING) return false;
    step.status = StepStatus.COMPLETED;
    step.result = result || null;
    step.completedAt = Date.now();
    return true;
  },

  /**
   * failStep(stepId, error)
   *
   * 将 step 状态从 running → failed。
   */
  failStep: function(stepId, error) {
    var step = this.getStep(stepId);
    if (!step) return false;
    if (step.status !== StepStatus.RUNNING) return false;
    step.status = StepStatus.FAILED;
    step.result = { error: error || "未知错误" };
    step.completedAt = Date.now();
    return true;
  },

  /**
   * skipStep(stepId)
   *
   * 将 step 状态从 pending → skipped。
   */
  skipStep: function(stepId) {
    var step = this.getStep(stepId);
    if (!step) return false;
    if (step.status !== StepStatus.PENDING) return false;
    step.status = StepStatus.SKIPPED;
    step.completedAt = Date.now();
    return true;
  },

  /**
   * markSkipped(stepId, reason)
   *
   * 将 step 状态从 running → skipped（错误恢复降级时使用）。
   */
  markSkipped: function(stepId, reason) {
    var step = this.getStep(stepId);
    if (!step) return false;
    step.status = StepStatus.SKIPPED;
    step.skipReason = reason || "";
    step.skippedAt = Date.now();
    step.completedAt = Date.now();
    RuntimeEvents.emit("step_skipped", { stepId: stepId, reason: reason });
    return true;
  },

  /**
   * getStatus()
   *
   * 返回整个 TaskGraph 的状态摘要。
   */
  getStatus: function() {
    var counts = {};
    counts[StepStatus.PENDING] = 0;
    counts[StepStatus.RUNNING] = 0;
    counts[StepStatus.COMPLETED] = 0;
    counts[StepStatus.FAILED] = 0;
    counts[StepStatus.SKIPPED] = 0;

    for (var i = 0; i < this._steps.length; i++) {
      var s = this._steps[i].status;
      if (counts.hasOwnProperty(s)) counts[s]++;
    }

    var isDone = counts[StepStatus.PENDING] === 0 && counts[StepStatus.RUNNING] === 0;
    var hasFailed = counts[StepStatus.FAILED] > 0;

    return {
      goal: this._goal,
      strategy: this._strategy,
      totalSteps: this._steps.length,
      pending: counts[StepStatus.PENDING],
      running: counts[StepStatus.RUNNING],
      completed: counts[StepStatus.COMPLETED],
      failed: counts[StepStatus.FAILED],
      skipped: counts[StepStatus.SKIPPED],
      isDone: isDone,
      hasFailed: hasFailed,
      createdAt: this._createdAt
    };
  },

  /**
   * getSteps()
   */
  getSteps: function() {
    return this._steps.slice();
  },

  /**
   * getGoal()
   */
  getGoal: function() {
    return this._goal;
  },

  /**
   * getStrategy()
   */
  getStrategy: function() {
    return this._strategy;
  },

  /**
   * isComplete()
   */
  isComplete: function() {
    var status = this.getStatus();
    return status.isDone;
  },

  /**
   * hasFailed()
   */
  hasFailed: function() {
    var status = this.getStatus();
    return status.hasFailed;
  },

  /**
   * serialize()
   *
   * 将 TaskGraph 序列化为 JSON，用于持久化或调试。
   */
  serialize: function() {
    return JSON.stringify({
      goal: this._goal,
      strategy: this._strategy,
      steps: this._steps,
      createdAt: this._createdAt
    }, null, 2);
  },

  /**
   * clear()
   *
   * 清空 TaskGraph。
   */
  clear: function() {
    this._plan = null;
    this._steps = [];
    this._goal = "";
    this._strategy = "";
    this._createdAt = null;
  }
};


// === planner\planner.js ===
/**
 * Planner - 任务规划器
 *
 * 职责：
 *   1. 将用户任务拆解为结构化 Plan
 *   2. 调用 LLM 生成 Plan（LLM 只负责规划，不负责执行）
 *   3. Plan 必须是可序列化的 JSON
 *   4. 读取 ToolDispatcher.getCapabilities() 让模型知道当前能力
 *   5. 发射 plan_created 事件
 *
 * 输入：
 *   { question, observation, availableTools, previousSteps, apiKey }
 *
 * 输出（Plan）：
 *   {
 *     goal: "...",
 *     strategy: "...",
 *     steps: [
 *       { id: "step_1", type: "observe", description: "..." },
 *       { id: "step_2", type: "tool", tool: "highlight_keywords", reason: "..." },
 *       { id: "step_3", type: "respond", description: "..." }
 *     ]
 *   }
 */

var Planner = {

  /**
   * buildPlan(request)
   *
   * request: {
   *   question: string,
   *   observation: string (序列化后的观察文本),
   *   availableTools: array (ToolDispatcher.getDefinitions()),
   *   previousSteps: string (之前的步骤摘要),
   *   apiKey: string
   * }
   *
   * 返回：Plan 对象
   */
  buildPlan: async function(request) {
    var prompt = PromptBuilder.build("planner",
      request.observation,
      null,
      request.question,
      request.previousSteps || ""
    );

    if (!prompt) throw new Error("Planner: 无法构建规划 Prompt");

    var messages = [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user }
    ];

    var sessionId = RuntimeSession.getSessionId();

    RuntimeEvents.emit("llm_request", {
      type: "llm_request",
      timestamp: Date.now(),
      sessionId: sessionId,
      runId: null,
      phase: RuntimeStatus.PLANNING,
      payload: { source: "planner" }
    });

    var result = await LLMProvider.call({
      apiKey: request.apiKey,
      messages: messages,
      timeout: 30000
    });

    var rawContent = result.content;

    RuntimeEvents.emit("llm_response", {
      type: "llm_response",
      timestamp: Date.now(),
      sessionId: sessionId,
      runId: null,
      phase: RuntimeStatus.PLANNING,
      payload: { source: "planner", contentLength: rawContent.length }
    });

    var sanitized = sanitizeLLMOutput(rawContent);
    var plan;
    try {
      plan = JSON.parse(sanitized);
    } catch (e) {
      var retryResult = await LLMProvider.call({
        apiKey: request.apiKey,
        messages: messages.concat([
          { role: "assistant", content: rawContent },
          { role: "user", content: "你上次返回的不是合法 JSON。请只返回 JSON 对象，格式为 { goal, strategy, steps }。" }
        ]),
        timeout: 30000
      });
      var retrySanitized = sanitizeLLMOutput(retryResult.content);
      plan = JSON.parse(retrySanitized);
      if (!plan) throw new Error("Planner: AI 返回格式错误（已重试）");
    }

    plan = this._validateAndFix(plan);

    RuntimeEvents.emit("plan_created", {
      type: "plan_created",
      timestamp: Date.now(),
      sessionId: sessionId,
      runId: null,
      phase: RuntimeStatus.PLANNING,
      payload: {
        goal: plan.goal,
        stepCount: plan.steps ? plan.steps.length : 0,
        strategy: plan.strategy
      }
    });

    return plan;
  },

  /**
   * _validateAndFix(plan)
   *
   * 校验 Plan 结构，补全缺失字段。
   */
  _validateAndFix: function(plan) {
    if (!plan) plan = {};
    if (!plan.goal) plan.goal = "未指定目标";
    if (!plan.strategy) plan.strategy = "直接执行";
    if (!plan.steps || !Array.isArray(plan.steps)) plan.steps = [];

    for (var i = 0; i < plan.steps.length; i++) {
      var step = plan.steps[i];
      if (!step.id) step.id = "step_" + (i + 1);

      var validTypes = ["observe", "tool", "browser_action", "respond"];
      if (!step.type || validTypes.indexOf(step.type) === -1) {
        step.type = "respond";
      }

      if (step.type === "tool" && !step.tool) {
        step.tool = "highlight_keywords";
      }

      if (step.type === "browser_action" && !step.action) {
        step.action = "click_element";
      }

      if (!step.description) step.description = "";
    }

    if (plan.steps.length === 0) {
      plan.steps.push({
        id: "step_1",
        type: "respond",
        description: "直接回答用户问题"
      });
    }

    var lastStep = plan.steps[plan.steps.length - 1];
    if (lastStep.type !== "respond") {
      plan.steps.push({
        id: "step_" + (plan.steps.length + 1),
        type: "respond",
        description: "生成最终回答"
      });
    }

    return plan;
  }
};


// === planner\planExecutor.js ===
/**
 * PlanExecutor - 计划执行器（含错误恢复）
 *
 * 职责：
 *   1. 从 TaskGraph 获取下一步，按类型执行
 *   2. 支持 step 类型：observe / tool / browser_action / respond
 *   3. 分层错误恢复：自动重试 → LLM 修复 → 跳过/终止
 *   4. 更新 TaskGraph 中的 step 状态
 *   5. 发射 plan_started / plan_step_started / plan_step_completed / plan_completed 事件
 *   6. 不负责规划（由 planner.js 负责）
 *   7. 不负责循环编排（由 ReactRuntimeLoop 负责）
 */

var ErrorType = {
  ELEMENT_NOT_FOUND: "element_not_found",
  ACTION_FAILED: "action_failed",
  LLM_PARSE_ERROR: "llm_parse_error",
  TIMEOUT: "timeout",
  NETWORK_ERROR: "network_error",
  UNKNOWN: "unknown"
};

var EXECUTOR_LIMITS = {
  MAX_STEP_RETRIES: 1,
  MAX_LLM_REPAIRS: 1,
  MAX_CONSECUTIVE_FAILURES: 3
};

var PlanExecutor = {

  _emitPlan: function(type, payload) {
    RuntimeEvents.emit(type, {
      type: type,
      timestamp: Date.now(),
      sessionId: RuntimeSession.getSessionId(),
      runId: null,
      phase: RuntimeState.getPhase(),
      payload: payload || {}
    });
  },

  /**
   * executePlan(taskGraph, context)
   *
   * taskGraph: TaskGraph 实例
   * context: { apiKey, activeTab, mode, pageContent, question, observation }
   *
   * 返回：{ finalAnswer, steps, done, aborted }
   */
  executePlan: async function(taskGraph, context) {
    var self = this;

    var stepRetryCount = {};
    var stepRepairCount = {};
    var consecutiveFailures = 0;

    self._emitPlan("plan_started", {
      goal: taskGraph.getGoal(),
      strategy: taskGraph.getStrategy(),
      totalSteps: taskGraph.getStatus().totalSteps
    });

    RuntimeState.set(RuntimeStatus.EXECUTING_PLAN, {
      goal: taskGraph.getGoal(),
      stepCount: taskGraph.getStatus().totalSteps
    });

    var finalAnswer = null;
    var observation = context.observation || context.pageContent || "";

    while (!taskGraph.isComplete()) {
      var step = taskGraph.getNextStep();
      if (!step) break;

      self._emitPlan("plan_step_started", {
        stepId: step.id,
        stepType: step.type,
        description: step.description
      });

      RuntimeState.set(RuntimeStatus.EXECUTING_STEP, {
        stepId: step.id,
        stepType: step.type
      });

      taskGraph.startStep(step.id);

      var stepResult = await self._executeStepWithRecovery(
        step, context, observation,
        stepRetryCount, stepRepairCount
      );

      if (stepResult.status === "success") {
        if (stepResult.result) {
          if (step.type === "observe" && stepResult.result.observation) {
            observation = stepResult.result.observation;
          } else if (step.type === "browser_action" && stepResult.result.pageChanged) {
            var reobserve = await self._executeObserve(step, context);
            if (reobserve && reobserve.observation) {
              observation = reobserve.observation;
            }
          } else if (step.type === "respond" && stepResult.result.answer) {
            finalAnswer = stepResult.result.answer;
          }
        }
        taskGraph.completeStep(step.id, stepResult.result);
        consecutiveFailures = 0;

        self._emitPlan("plan_step_completed", {
          stepId: step.id,
          stepType: step.type,
          success: true
        });

      } else if (stepResult.status === "skipped") {
        taskGraph.markSkipped(step.id, stepResult.reason);
        consecutiveFailures = 0;

        self._emitPlan("plan_step_completed", {
          stepId: step.id,
          stepType: step.type,
          success: false,
          skipped: true,
          reason: stepResult.reason
        });

      } else if (stepResult.status === "aborted") {
        taskGraph.markSkipped(step.id, "计划被 LLM 终止");
        finalAnswer = stepResult.finalAnswer || finalAnswer;

        self._emitPlan("plan_step_completed", {
          stepId: step.id,
          stepType: step.type,
          success: false,
          aborted: true
        });

        break;

      } else {
        taskGraph.failStep(step.id, stepResult.error);
        consecutiveFailures++;

        self._emitPlan("plan_step_completed", {
          stepId: step.id,
          stepType: step.type,
          success: false,
          error: stepResult.error
        });

        if (step.type === "respond") {
          finalAnswer = "执行失败：" + stepResult.error;
        }

        if (consecutiveFailures >= EXECUTOR_LIMITS.MAX_CONSECUTIVE_FAILURES) {
          self._emitPlan("plan_completed", {
            goal: taskGraph.getGoal(),
            aborted: true,
            reason: "连续失败次数超过限制 (" + EXECUTOR_LIMITS.MAX_CONSECUTIVE_FAILURES + ")"
          });

          return {
            finalAnswer: finalAnswer || "任务执行失败：连续多个步骤失败",
            steps: taskGraph.getSteps(),
            done: true,
            aborted: true,
            hasFailed: true
          };
        }
      }
    }

    var status = taskGraph.getStatus();

    self._emitPlan("plan_completed", {
      goal: taskGraph.getGoal(),
      completedSteps: status.completed,
      failedSteps: status.failed,
      skippedSteps: status.skipped,
      finalAnswer: finalAnswer
    });

    return {
      finalAnswer: finalAnswer,
      steps: taskGraph.getSteps(),
      done: status.isDone,
      aborted: false,
      hasFailed: status.hasFailed
    };
  },

  /**
   * _executeStepWithRecovery(step, context, observation, retryCounts, repairCounts)
   *
   * 分层错误恢复：
   *   1. 正常执行
   *   2. 失败 → 自动重试（重新 observe）
   *   3. 重试仍失败 → LLM 修复决策
   *   4. 修复失败 → skip / abort
   */
  _executeStepWithRecovery: async function(step, context, observation, stepRetryCount, stepRepairCount) {
    var self = this;
    var retryCount = stepRetryCount[step.id] || 0;
    var repairCount = stepRepairCount[step.id] || 0;

    try {
      var result = await self._executeStep(step, context, observation);
      return { status: "success", result: result };

    } catch (err) {
      var errorType = self._classifyError(err);

      if (retryCount < EXECUTOR_LIMITS.MAX_STEP_RETRIES) {
        stepRetryCount[step.id] = retryCount + 1;

        RuntimeState.set(RuntimeStatus.RECOVERING, {
          stepId: step.id,
          recoveryType: "retry",
          attempt: retryCount + 1,
          error: err.message
        });

        self._emitPlan("step_retry", {
          stepId: step.id,
          attempt: retryCount + 1,
          error: err.message,
          errorType: errorType
        });

        var freshObservation = await self._executeObserve(step, context);
        if (freshObservation && freshObservation.observation) {
          observation = freshObservation.observation;
        }

        try {
          var retryResult = await self._executeStep(step, context, observation);
          return { status: "success", result: retryResult };
        } catch (retryErr) {
          err = retryErr;
          errorType = self._classifyError(retryErr);
        }
      }

      if (repairCount < EXECUTOR_LIMITS.MAX_LLM_REPAIRS) {
        stepRepairCount[step.id] = repairCount + 1;

        self._emitPlan("step_llm_repair", {
          stepId: step.id,
          attempt: repairCount + 1,
          error: err.message,
          errorType: errorType
        });

        try {
          var decision = await self._askLLMForRepair({
            step: step,
            error: err.message,
            errorType: errorType,
            observation: observation,
            context: context
          });

          if (decision.decision === "retry" && decision.newParams) {
            if (step.input) {
              for (var key in decision.newParams) {
                if (decision.newParams.hasOwnProperty(key)) {
                  step.input[key] = decision.newParams[key];
                }
              }
            }
            try {
              var repairResult = await self._executeStep(step, context, observation);
              return { status: "success", result: repairResult };
            } catch (repairErr) {
              return { status: "skipped", reason: "修复重试失败: " + repairErr.message };
            }
          }

          if (decision.decision === "skip") {
            return { status: "skipped", reason: decision.reason || err.message };
          }

          if (decision.decision === "abort") {
            return { status: "aborted", finalAnswer: decision.finalAnswer };
          }

        } catch (repairErr) {
          return { status: "skipped", reason: "LLM 修复失败: " + repairErr.message };
        }
      }

      return { status: "failed", error: err.message };
    }
  },

  /**
   * _executeStep(step, context, observation)
   *
   * 执行单个 step（不含恢复逻辑）。
   */
  _executeStep: async function(step, context, observation) {
    var self = this;

    if (step.type === "observe") {
      return await self._executeObserve(step, context);
    } else if (step.type === "tool") {
      return await self._executeTool(step, context);
    } else if (step.type === "browser_action") {
      return await self._executeBrowserAction(step, context);
    } else if (step.type === "respond") {
      return await self._executeRespond(step, context, observation);
    } else {
      return { skipped: true, reason: "未知 step 类型: " + step.type };
    }
  },

  /**
   * _classifyError(err)
   *
   * 根据错误信息分类错误类型。
   */
  _classifyError: function(err) {
    var msg = (err.message || "").toLowerCase();
    if (msg.indexOf("not found") !== -1 || msg.indexOf("element") !== -1 || msg.indexOf("selector") !== -1) {
      return ErrorType.ELEMENT_NOT_FOUND;
    }
    if (msg.indexOf("timeout") !== -1 || msg.indexOf("超时") !== -1) {
      return ErrorType.TIMEOUT;
    }
    if (msg.indexOf("network") !== -1 || msg.indexOf("fetch") !== -1 || msg.indexOf("http") !== -1) {
      return ErrorType.NETWORK_ERROR;
    }
    if (msg.indexOf("json") !== -1 || msg.indexOf("parse") !== -1) {
      return ErrorType.LLM_PARSE_ERROR;
    }
    if (msg.indexOf("click") !== -1 || msg.indexOf("input") !== -1 || msg.indexOf("scroll") !== -1) {
      return ErrorType.ACTION_FAILED;
    }
    return ErrorType.UNKNOWN;
  },

  /**
   * _askLLMForRepair(options)
   *
   * 询问 LLM 如何处理失败的 step。
   * 返回：{ decision: "retry"|"skip"|"abort", newParams?, reason?, finalAnswer? }
   */
  _askLLMForRepair: async function(options) {
    var step = options.step;
    var error = options.error;
    var errorType = options.errorType;
    var observation = options.observation;
    var context = options.context;

    var systemPrompt = [
      "你是一个 Browser Agent 的错误恢复助手。",
      "",
      "一个计划步骤执行失败了，你需要决定如何处理。",
      "",
      "可选决策：",
      "1. retry - 用新的参数重试（适合元素定位失败、参数错误等可修复情况）",
      "2. skip  - 跳过该步骤继续执行后续步骤（适合非关键步骤）",
      "3. abort - 终止计划并生成最终回答（适合无法继续的情况）",
      "",
      "返回合法 JSON，格式如下：",
      "retry: { \"decision\": \"retry\", \"newParams\": { ... }, \"reason\": \"...\" }",
      "skip:  { \"decision\": \"skip\", \"reason\": \"...\" }",
      "abort: { \"decision\": \"abort\", \"finalAnswer\": \"对用户的最终说明\" }"
    ].join("\n");

    var stepInfo = {
      id: step.id,
      type: step.type,
      description: step.description,
      action: step.action || step.tool,
      input: step.input
    };

    var userPrompt = [
      "失败步骤：",
      JSON.stringify(stepInfo, null, 2),
      "",
      "错误信息：" + error,
      "错误类型：" + errorType,
      "",
      "当前页面状态：",
      observation ? observation.substring(0, 500) : "无法获取",
      "",
      "请决定如何处理。"
    ].join("\n");

    try {
      var result = await LLMProvider.call({
        apiKey: context.apiKey,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        timeout: 15000
      });

      var cleaned = sanitizeLLMOutput(result.content);
      var parsed = JSON.parse(cleaned);

      if (parsed.decision === "retry" || parsed.decision === "skip" || parsed.decision === "abort") {
        return parsed;
      }

      return { decision: "skip", reason: "LLM 返回了无法识别的决策" };
    } catch (e) {
      return { decision: "skip", reason: "LLM 修复请求失败: " + e.message };
    }
  },

  /**
   * _executeObserve(step, context)
   */
  _executeObserve: async function(step, context) {
    RuntimeState.set(RuntimeStatus.OBSERVING);

    var snapshot = null;
    if (context.activeTab && context.activeTab.id) {
      try {
        var response = await chrome.tabs.sendMessage(context.activeTab.id, {
          action: "getObservation"
        });
        if (response && response.snapshot) {
          snapshot = response.snapshot;
        }
      } catch (e) {
        console.warn("PlanExecutor: 获取 Observation 失败", e);
      }
    }

    var observation;
    if (snapshot) {
      var built = ObservationBuilder.build(snapshot, { activeTab: context.activeTab });
      observation = ObservationSerializer.serialize(built, {
        maxTextLength: 4000,
        includeDOM: true,
        includeForms: true,
        includeImages: false
      });
    } else {
      observation = context.pageContent || "";
    }

    return { observation: observation };
  },

  /**
   * _executeTool(step, context)
   */
  _executeTool: async function(step, context) {
    RuntimeState.set(RuntimeStatus.EXECUTING_TOOL);

    var toolName = step.tool;
    var toolInput = step.input || {};

    if (!toolName || !ToolDispatcher.has(toolName)) {
      return { success: false, error: "未知工具: " + (toolName || "未指定") };
    }

    var result = await ToolDispatcher.execute(toolName, toolInput, {
      activeTab: context.activeTab
    });

    return result;
  },

  /**
   * _executeBrowserAction(step, context)
   */
  _executeBrowserAction: async function(step, context) {
    RuntimeState.set(RuntimeStatus.EXECUTING_BROWSER_ACTION);

    var actionName = step.action;
    var actionInput = step.input || {};

    if (!actionName || !ActionRegistry.has(actionName)) {
      return { success: false, error: "未知 browser action: " + (actionName || "未指定") };
    }

    var safetyCheck = BrowserActionRuntime.canExecute(actionName, actionInput);
    if (!safetyCheck.allowed) {
      BrowserActionRuntime.actionBlocked(actionName, safetyCheck.reason);
      return { success: false, error: "安全策略阻止: " + safetyCheck.reason };
    }

    BrowserActionRuntime.beforeAction(actionName, actionInput);

    try {
      var result = await ActionExecutor.execute(actionName, actionInput, {
        activeTab: context.activeTab
      });

      if (result.success) {
        BrowserActionRuntime.afterAction(actionName, result);

        if (result.pageChanged) {
          RuntimeState.set(RuntimeStatus.WAITING_PAGE_UPDATE, {
            action: actionName
          });
        }
      } else {
        BrowserActionRuntime.actionFailed(actionName, result.error);
      }

      return result;
    } catch (err) {
      BrowserActionRuntime.actionFailed(actionName, err.message);
      return { success: false, error: err.message, pageChanged: false };
    }
  },

  /**
   * _executeRespond(step, context, observation)
   */
  _executeRespond: async function(step, context, observation) {
    RuntimeState.set(RuntimeStatus.REQUESTING_LLM);

    var prompt = PromptBuilder.build("qa", observation, context.mode, context.question, "");

    if (!prompt) {
      return { answer: observation ? observation.substring(0, 500) : "无法生成回答" };
    }

    var messages = [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user }
    ];

    var result = await LLMProvider.call({
      apiKey: context.apiKey,
      messages: messages,
      timeout: 30000
    });

    var rawContent = result.content;

    var answer;
    try {
      var sanitized = sanitizeLLMOutput(rawContent);
      var parsed = JSON.parse(sanitized);
      answer = parsed.answer || rawContent;
    } catch (e) {
      answer = rawContent;
    }

    return { answer: answer };
  }
};


// === tools\actionRegistry.js ===
/**
 * ActionRegistry - Browser Action 注册中心
 *
 * 职责：
 *   1. 注册所有 Browser Actions（click_element / input_text / scroll_page / navigate_url）
 *   2. 每个 Action 包含 capability / description / parameters / safety 配置
 *   3. 提供 getDefinitions() 供 Planner 读取可用操作
 *   4. 提供 getCapabilities() 按能力分类
 *
 * 运行环境：SidePanel / Popup
 */

var ActionRegistry = {

  _actions: {
    click_element: {
      name: "click_element",
      capability: "browser_action",
      description: "点击页面上的元素（按钮、链接等）",
      parameters: {
        selector: { type: "string", required: true, description: "CSS 选择器" }
      },
      safety: {
        cooldownMs: 500,
        dangerous: false
      }
    },

    input_text: {
      name: "input_text",
      capability: "browser_action",
      description: "在输入框中输入文本",
      parameters: {
        selector: { type: "string", required: true, description: "CSS 选择器" },
        text: { type: "string", required: true, description: "要输入的文本" }
      },
      safety: {
        cooldownMs: 300,
        dangerous: false
      }
    },

    scroll_page: {
      name: "scroll_page",
      capability: "browser_action",
      description: "滚动页面",
      parameters: {
        direction: { type: "string", required: true, description: "滚动方向：up / down" },
        amount: { type: "number", required: false, description: "滚动像素数，默认 500" }
      },
      safety: {
        cooldownMs: 300,
        dangerous: false
      }
    },

    navigate_url: {
      name: "navigate_url",
      capability: "browser_action",
      description: "导航到指定 URL",
      parameters: {
        url: { type: "string", required: true, description: "目标 URL" }
      },
      safety: {
        cooldownMs: 500,
        dangerous: true
      }
    },

    open_tab: {
      name: "open_tab",
      capability: "tab_management",
      description: "打开一个新标签页并将 Agent 目标切换到该 Tab",
      parameters: {
        url: { type: "string", required: true, description: "要打开的 URL（仅限 http/https）" }
      },
      safety: {
        cooldownMs: 1000,
        dangerous: true
      }
    },

    switch_tab: {
      name: "switch_tab",
      capability: "tab_management",
      description: "将 Agent 操作目标切换到已有的标签页",
      parameters: {
        tabId: { type: "number", required: true, description: "目标 Tab 的 ID" }
      },
      safety: {
        cooldownMs: 300,
        dangerous: false
      }
    },

    close_tab: {
      name: "close_tab",
      capability: "tab_management",
      description: "关闭指定标签页（不允许关闭最后一个 Tab）",
      parameters: {
        tabId: { type: "number", required: false, description: "要关闭的 Tab ID，不传则关闭当前 Agent 目标 Tab" }
      },
      safety: {
        cooldownMs: 500,
        dangerous: true
      }
    },

    click: {
      name: "click",
      capability: "browser_action",
      description: "点击页面元素",
      parameters: {
        selector: { type: "string", required: false, description: "CSS 选择器" },
        text: { type: "string", required: false, description: "元素文本" }
      },
      safety: {
        cooldownMs: 300,
        dangerous: false
      }
    },

    input: {
      name: "input",
      capability: "browser_action",
      description: "在输入框中输入文本",
      parameters: {
        selector: { type: "string", required: true, description: "CSS 选择器" },
        value: { type: "string", required: true, description: "要输入的文本" }
      },
      safety: {
        cooldownMs: 300,
        dangerous: false
      }
    },

    scroll: {
      name: "scroll",
      capability: "browser_action",
      description: "滚动页面",
      parameters: {
        direction: { type: "string", required: false, description: "滚动方向" },
        amount: { type: "number", required: false, description: "滚动像素数" }
      },
      safety: {
        cooldownMs: 200,
        dangerous: false
      }
    },

    extract: {
      name: "extract",
      capability: "browser_action",
      description: "提取页面内容",
      parameters: {
        selector: { type: "string", required: true, description: "CSS 选择器" }
      },
      safety: {
        cooldownMs: 200,
        dangerous: false
      }
    },

    wait_element: {
      name: "wait_element",
      capability: "browser_action",
      description: "等待元素出现",
      parameters: {
        selector: { type: "string", required: true, description: "CSS 选择器" },
        timeout: { type: "number", required: false, description: "超时毫秒数" }
      },
      safety: {
        cooldownMs: 100,
        dangerous: false
      }
    },

    hover: {
      name: "hover",
      capability: "browser_action",
      description: "悬停在元素上，触发 hover 菜单或提示",
      parameters: {
        selector: { type: "string", required: false, description: "CSS 选择器" },
        text: { type: "string", required: false, description: "元素文本" }
      },
      safety: {
        cooldownMs: 200,
        dangerous: false
      }
    },

    press_key: {
      name: "press_key",
      capability: "browser_action",
      description: "按下键盘按键（Enter/Tab/Escape/ArrowDown/ArrowUp 等）",
      parameters: {
        key: { type: "string", required: true, description: "按键名称：Enter, Tab, Escape, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Backspace, Delete, PageDown, PageUp, Home, End" },
        selector: { type: "string", required: false, description: "先聚焦到此元素再按键" }
      },
      safety: {
        cooldownMs: 200,
        dangerous: false
      }
    },

    scroll_to_element: {
      name: "scroll_to_element",
      capability: "browser_action",
      description: "滚动页面直到指定元素出现在视野中",
      parameters: {
        selector: { type: "string", required: true, description: "CSS 选择器" }
      },
      safety: {
        cooldownMs: 200,
        dangerous: false
      }
    },

    scroll_to_bottom: {
      name: "scroll_to_bottom",
      capability: "browser_action",
      description: "滚动到页面底部，常用于加载更多内容",
      parameters: {},
      safety: {
        cooldownMs: 500,
        dangerous: false
      }
    },

    select_option: {
      name: "select_option",
      capability: "browser_action",
      description: "选择下拉框（SELECT）中的选项",
      parameters: {
        selector: { type: "string", required: true, description: "SELECT 元素的 CSS 选择器" },
        value: { type: "string", required: false, description: "选项的 value 值" },
        label: { type: "string", required: false, description: "选项的显示文本" }
      },
      safety: {
        cooldownMs: 300,
        dangerous: false
      }
    },

    extract_attribute: {
      name: "extract_attribute",
      capability: "browser_action",
      description: "提取元素的指定属性值（如 href、src、data-*）",
      parameters: {
        selector: { type: "string", required: true, description: "CSS 选择器" },
        attr: { type: "string", required: false, description: "属性名，默认 href" }
      },
      safety: {
        cooldownMs: 200,
        dangerous: false
      }
    }
  },

  get: function(actionName) {
    return this._actions[actionName] || null;
  },

  has: function(actionName) {
    return actionName in this._actions;
  },

  getDefinitions: function() {
    var results = [];
    for (var name in this._actions) {
      if (this._actions.hasOwnProperty(name)) {
        var action = this._actions[name];
        results.push({
          name: action.name,
          capability: action.capability,
          description: action.description,
          parameters: action.parameters
        });
      }
    }
    return results;
  },

  getCapabilities: function() {
    var caps = {};
    for (var name in this._actions) {
      if (this._actions.hasOwnProperty(name)) {
        var action = this._actions[name];
        var cap = action.capability;
        if (!caps[cap]) caps[cap] = [];
        caps[cap].push(name);
      }
    }
    return caps;
  },

  getSafetyConfig: function(actionName) {
    var action = this._actions[actionName];
    if (!action) return null;
    return action.safety || {};
  },

  getAllNames: function() {
    var names = [];
    for (var name in this._actions) {
      if (this._actions.hasOwnProperty(name)) {
        names.push(name);
      }
    }
    return names;
  }
};


// === tools\actionExecutor.js ===
/**
 * ActionExecutor - Browser Action 执行器
 *
 * 职责：
 *   1. 执行 Browser Action（通过 chrome.tabs.sendMessage 发到 Content Script）
 *   2. 执行前调用 ElementLocator 做安全检查（Content Script 端）
 *   3. 执行后检测页面变化
 *   4. 返回标准化 Result Schema
 *
 * 执行流：
 *   Action → ElementLocator (Content Script) → Safety Check → Execute → Result
 *
 * 运行环境：SidePanel / Popup
 */

var ActionExecutor = {

  /**
   * execute(actionName, params, context)
   *
   * actionName: "click_element" / "input_text" / "scroll_page" / "navigate_url"
   * params: { selector, text, direction, amount, url }
   * context: { activeTab }
   *
   * 返回：
   *   {
   *     success: boolean,
   *     action: string,
   *     selector: string | null,
   *     durationMs: number,
   *     error: string | null,
   *     pageChanged: boolean
   *   }
   */
  execute: async function(actionName, params, context) {
    var startedAt = Date.now();
    var self = this;

    if (!ActionRegistry.has(actionName)) {
      return {
        success: false,
        action: actionName,
        selector: params.selector || null,
        durationMs: Date.now() - startedAt,
        error: "未知 Action: " + actionName,
        pageChanged: false
      };
    }

    if (actionName === "open_tab") {
      return await self._executeOpenTab(params, startedAt);
    }

    if (actionName === "switch_tab") {
      return await self._executeSwitchTab(params, startedAt);
    }

    if (actionName === "close_tab") {
      return await self._executeCloseTab(params, startedAt);
    }

    if (!context || !context.activeTab || !context.activeTab.id) {
      return {
        success: false,
        action: actionName,
        selector: params.selector || null,
        durationMs: Date.now() - startedAt,
        error: "缺少 activeTab",
        pageChanged: false
      };
    }

    var beforeState = await self._capturePageState(context.activeTab.id);

    if (actionName === "navigate_url") {
      return await self._executeNavigate(params, context, startedAt, beforeState);
    }

    var response = await chrome.tabs.sendMessage(context.activeTab.id, {
      type: "execute_browser_action",
      action: actionName,
      data: params
    });

    var result = response || {
      success: false,
      action: actionName,
      selector: params.selector || null,
      durationMs: Date.now() - startedAt,
      error: "Content Script 无响应",
      pageChanged: false
    };

    if (result.success) {
      await self._waitForPageUpdate(context.activeTab.id, 500);
      var afterState = await self._capturePageState(context.activeTab.id);
      result.pageChanged = self._detectPageChange(beforeState, afterState);
    } else {
      result.pageChanged = false;
    }

    result.durationMs = Date.now() - startedAt;
    return result;
  },

  _executeNavigate: async function(params, context, startedAt, beforeState) {
    var url = params.url;
    if (!url) {
      return {
        success: false,
        action: "navigate_url",
        selector: null,
        durationMs: Date.now() - startedAt,
        error: "缺少 url 参数",
        pageChanged: false
      };
    }

    var blocked = BrowserActionRuntime.checkDangerousUrl(url);
    if (blocked) {
      return {
        success: false,
        action: "navigate_url",
        selector: null,
        durationMs: Date.now() - startedAt,
        error: "URL 被安全策略阻止: " + blocked,
        pageChanged: false
      };
    }

    try {
      await chrome.tabs.update(context.activeTab.id, { url: url });
      await self._waitForPageUpdate(context.activeTab.id, 2000);

      return {
        success: true,
        action: "navigate_url",
        selector: null,
        durationMs: Date.now() - startedAt,
        error: null,
        pageChanged: true
      };
    } catch (err) {
      return {
        success: false,
        action: "navigate_url",
        selector: null,
        durationMs: Date.now() - startedAt,
        error: "导航失败: " + err.message,
        pageChanged: false
      };
    }
  },

  _capturePageState: async function(tabId) {
    try {
      var response = await chrome.tabs.sendMessage(tabId, {
        action: "getPageState"
      });
      return response || {};
    } catch (e) {
      return {};
    }
  },

  _waitForPageUpdate: async function(tabId, maxWaitMs) {
    var waited = 0;
    var interval = 100;
    while (waited < maxWaitMs) {
      await new Promise(function(resolve) { setTimeout(resolve, interval); });
      waited += interval;
    }
  },

  _detectPageChange: function(before, after) {
    if (!before || !after) return false;
    if (before.url !== after.url) return true;
    if (before.title !== after.title) return true;
    if (before.domLength !== after.domLength) return true;
    return false;
  },

  _executeOpenTab: async function(params, startedAt) {
    var url = params.url;
    if (!url) {
      return {
        success: false,
        action: "open_tab",
        selector: null,
        durationMs: Date.now() - startedAt,
        error: "缺少 url 参数",
        pageChanged: false
      };
    }

    var blocked = BrowserActionRuntime.checkBlockedProtocol(url);
    if (blocked) {
      return {
        success: false,
        action: "open_tab",
        selector: null,
        durationMs: Date.now() - startedAt,
        error: "URL 被安全策略阻止: " + blocked,
        pageChanged: false
      };
    }

    try {
      var tab = await TabRegistry.openTab(url);
      await TabRegistry.waitForTabLoad(tab.id, 10000);
      TabRegistry.setAgentTab(tab.id);

      var updatedTab = TabRegistry.getAgentTab();

      return {
        success: true,
        action: "open_tab",
        selector: null,
        durationMs: Date.now() - startedAt,
        error: null,
        pageChanged: true,
        tabId: tab.id,
        url: updatedTab ? updatedTab.url : url
      };
    } catch (err) {
      return {
        success: false,
        action: "open_tab",
        selector: null,
        durationMs: Date.now() - startedAt,
        error: "打开 Tab 失败: " + err.message,
        pageChanged: false
      };
    }
  },

  _executeSwitchTab: async function(params, startedAt) {
    var tabId = params.tabId;
    if (!tabId) {
      return {
        success: false,
        action: "switch_tab",
        selector: null,
        durationMs: Date.now() - startedAt,
        error: "缺少 tabId 参数",
        pageChanged: false
      };
    }

    var entry = TabRegistry._tabs[tabId];
    if (!entry) {
      return {
        success: false,
        action: "switch_tab",
        selector: null,
        durationMs: Date.now() - startedAt,
        error: "Tab 不存在: " + tabId,
        pageChanged: false
      };
    }

    TabRegistry.setAgentTab(tabId);

    return {
      success: true,
      action: "switch_tab",
      selector: null,
      durationMs: Date.now() - startedAt,
      error: null,
      pageChanged: true,
      tabId: tabId
    };
  },

  _executeCloseTab: async function(params, startedAt) {
    var targetId = params.tabId || TabRegistry.getAgentTabId();
    if (!targetId) {
      return {
        success: false,
        action: "close_tab",
        selector: null,
        durationMs: Date.now() - startedAt,
        error: "没有指定要关闭的 Tab",
        pageChanged: false
      };
    }

    try {
      await TabRegistry.closeTab(targetId);
      return {
        success: true,
        action: "close_tab",
        selector: null,
        durationMs: Date.now() - startedAt,
        error: null,
        pageChanged: true,
        tabId: targetId
      };
    } catch (err) {
      return {
        success: false,
        action: "close_tab",
        selector: null,
        durationMs: Date.now() - startedAt,
        error: "关闭 Tab 失败: " + err.message,
        pageChanged: false
      };
    }
  }
};

var self = ActionExecutor;


// === tools\browserActionRuntime.js ===
/**
 * BrowserActionRuntime - Browser Action 生命周期管理 + 安全层
 *
 * 职责：
 *   1. 管理 Browser Action 生命周期（beforeAction / afterAction / actionFailed / actionCancelled）
 *   2. 安全层：Action Cooldown / Dangerous Selector Blocking / Max Actions Per Run
 *   3. 发射 browser_action_started / browser_action_completed / browser_action_failed / browser_action_blocked 事件
 *   4. 页面变化检测
 *
 * 运行环境：SidePanel / Popup
 */

var BrowserActionRuntime = {

  _lastActionTime: {},
  _actionCount: 0,
  _maxActionsPerRun: 50,
  _cooldownMs: 500,
  _dangerousSelectors: [
    "[type='password']",
    "input[autocomplete='cc-number']",
    "input[autocomplete='cc-csc']",
    "[data-payment]",
    "[data-delete]",
    "[data-danger]"
  ],
  _dangerousUrlPatterns: [
    /\/pay/i,
    /\/checkout/i,
    /\/delete/i,
    /\/remove/i,
    /javascript:/i
  ],
  _blockedProtocols: [
    "javascript:",
    "chrome://",
    "chrome-extension://",
    "file://",
    "about:",
    "devtools://",
    "view-source:",
    "edge://"
  ],

  /**
   * canExecute(actionName, params)
   *
   * 安全检查：是否允许执行此 Action。
   * 返回：{ allowed: boolean, reason: string }
   */
  canExecute: function(actionName, params, bypassCooldown) {
    if (this._actionCount >= this._maxActionsPerRun) {
      console.warn("[BrowserAction] canExecute BLOCKED: actionCount", this._actionCount, ">= max", this._maxActionsPerRun);
      return { allowed: false, reason: "已达到单次运行最大 Action 数量 (" + this._maxActionsPerRun + ")" };
    }

    if (!bypassCooldown) {
      var lastTime = this._lastActionTime[actionName] || 0;
      var now = Date.now();
      var safetyConfig = ActionRegistry.getSafetyConfig(actionName);
      var cooldown = safetyConfig ? (safetyConfig.cooldownMs || this._cooldownMs) : this._cooldownMs;

      if (now - lastTime < cooldown) {
        console.warn("[BrowserAction] canExecute COOLDOWN:", actionName, "elapsed:", now - lastTime, "ms, need:", cooldown, "ms");
        return { allowed: false, reason: "Action 冷却中，请等待 " + (cooldown - (now - lastTime)) + "ms" };
      }
    }

    if (params && params.selector) {
      var blocked = this.checkDangerousSelector(params.selector);
      if (blocked) {
        return { allowed: false, reason: "危险选择器被阻止: " + blocked };
      }
    }

    if (actionName === "open_tab" && params && params.url) {
      var urlBlocked = this.checkBlockedProtocol(params.url);
      if (urlBlocked) {
        return { allowed: false, reason: urlBlocked };
      }
    }

    if (actionName === "close_tab") {
      var allTabs = TabRegistry.getAll();
      if (allTabs.length <= 1) {
        return { allowed: false, reason: "不允许关闭最后一个标签页" };
      }
    }

    return { allowed: true, reason: "" };
  },

  /**
   * checkDangerousSelector(selector)
   *
   * 检查 selector 是否匹配危险元素。
   * 返回 null（安全）或 阻止原因。
   */
  checkDangerousSelector: function(selector) {
    if (!selector) return null;

    for (var i = 0; i < this._dangerousSelectors.length; i++) {
      if (selector.indexOf(this._dangerousSelectors[i]) !== -1) {
        return "匹配危险选择器: " + this._dangerousSelectors[i];
      }
    }

    return null;
  },

  /**
   * checkDangerousUrl(url)
   *
   * 检查 URL 是否危险。
   * 返回 null（安全）或 阻止原因。
   */
  checkDangerousUrl: function(url) {
    if (!url) return "URL 为空";

    if (url.indexOf("javascript:") === 0) {
      return "javascript: 协议被禁止";
    }

    for (var i = 0; i < this._dangerousUrlPatterns.length; i++) {
      if (this._dangerousUrlPatterns[i].test(url)) {
        return "URL 匹配危险模式: " + this._dangerousUrlPatterns[i].source;
      }
    }

    return null;
  },

  /**
   * checkBlockedProtocol(url)
   *
   * 检查 URL 是否使用被禁止的协议（open_tab 专用）。
   * 返回 null（安全）或 阻止原因。
   */
  checkBlockedProtocol: function(url) {
    if (!url) return "URL 为空";

    var lowerUrl = url.toLowerCase();
    for (var i = 0; i < this._blockedProtocols.length; i++) {
      if (lowerUrl.indexOf(this._blockedProtocols[i]) === 0) {
        return this._blockedProtocols[i] + " 协议被禁止";
      }
    }

    if (lowerUrl.indexOf("http://") !== 0 && lowerUrl.indexOf("https://") !== 0) {
      return "只允许 http/https 协议";
    }

    return null;
  },

  /**
   * beforeAction(actionName, params)
   *
   * Action 执行前的生命周期钩子。
   * 更新冷却时间、计数器、发射事件。
   */
  beforeAction: function(actionName, params) {
    this._lastActionTime[actionName] = Date.now();
    this._actionCount++;

    RuntimeEvents.emit("browser_action_started", {
      type: "browser_action_started",
      timestamp: Date.now(),
      sessionId: RuntimeSession.getSessionId(),
      runId: null,
      phase: RuntimeState.getPhase(),
      payload: {
        action: actionName,
        selector: params ? params.selector : null,
        actionCount: this._actionCount
      }
    });
  },

  /**
   * afterAction(actionName, result)
   *
   * Action 执行后的生命周期钩子。
   */
  afterAction: function(actionName, result) {
    RuntimeEvents.emit("browser_action_completed", {
      type: "browser_action_completed",
      timestamp: Date.now(),
      sessionId: RuntimeSession.getSessionId(),
      runId: null,
      phase: RuntimeState.getPhase(),
      payload: {
        action: actionName,
        success: result ? result.success : false,
        durationMs: result ? result.durationMs : 0,
        pageChanged: result ? result.pageChanged : false
      }
    });
  },

  /**
   * actionFailed(actionName, error)
   */
  actionFailed: function(actionName, error) {
    RuntimeEvents.emit("browser_action_failed", {
      type: "browser_action_failed",
      timestamp: Date.now(),
      sessionId: RuntimeSession.getSessionId(),
      runId: null,
      phase: RuntimeState.getPhase(),
      payload: {
        action: actionName,
        error: error || "未知错误"
      }
    });
  },

  /**
   * actionBlocked(actionName, reason)
   */
  actionBlocked: function(actionName, reason) {
    RuntimeEvents.emit("browser_action_blocked", {
      type: "browser_action_blocked",
      timestamp: Date.now(),
      sessionId: RuntimeSession.getSessionId(),
      runId: null,
      phase: RuntimeState.getPhase(),
      payload: {
        action: actionName,
        reason: reason
      }
    });
  },

  /**
   * reset()
   *
   * 重置运行时状态（每次新 Run 开始时调用）。
   */
  reset: function() {
    this._lastActionTime = {};
    this._actionCount = 0;
  },

  getActionCount: function() {
    return this._actionCount;
  }
};


// === memory\browserMemory.js ===
/**
 * browserMemory.js — Agent Experience System
 *
 * 职责：
 *   1. 以 domain + pageType 粒度存储 Agent 的运行经验
 *   2. 记录 selector 成功/失败统计（selectorStats）
 *   3. 记录失败经验（recentFailures）——比成功经验更值钱
 *   4. 记录行为模式（patterns）——LLM 总结，Runtime 消费
 *   5. 为 Planner / Recovery / Observation 提供先验知识
 *
 * 核心理念：
 *   Runtime 写结构化数据 → LLM 只总结 patterns
 *   防止 LLM 直接写 memory 导致 hallucination 和污染
 *
 * 存储位置：chrome.storage.local
 */

var BrowserMemory = {

  STORAGE_KEY: "browserMemory",
  MAX_FAILURES: 20,
  MAX_PATTERNS: 10,
  MAX_GOALS: 20,
  MAX_SELECTOR_STATS: 50,

  _data: null,
  _loaded: false,

  /**
   * load()
   *
   * 从 chrome.storage.local 加载记忆。
   * 在 startAgent() 之前调用。
   */
  load: async function() {
    try {
      var stored = await chrome.storage.local.get(this.STORAGE_KEY);
      var raw = stored[this.STORAGE_KEY];
      if (raw && typeof raw === "object") {
        this._data = raw;
      } else {
        this._data = this._empty();
      }
      this._loaded = true;
      return this._data;
    } catch (e) {
      console.warn("[BrowserMemory] 加载失败:", e.message);
      this._data = this._empty();
      this._loaded = true;
      return this._data;
    }
  },

  /**
   * save()
   *
   * 持久化到 chrome.storage.local（内部自动调用）。
   */
  _save: async function() {
    try {
      var jsonStr = JSON.stringify(this._data);
      if (jsonStr.length > 500000) {
        console.warn("[BrowserMemory] 数据量过大 (" + Math.round(jsonStr.length/1024) + "KB)，自动清理旧数据");
        this._pruneOldData();
        jsonStr = JSON.stringify(this._data);
      }
      var toSave = {};
      toSave[this.STORAGE_KEY] = this._data;
      await chrome.storage.local.set(toSave);
    } catch (e) {
      if (e.message && e.message.indexOf("quota") !== -1) {
        console.warn("[BrowserMemory] 存储配额满，尝试清理...");
        this._pruneOldData();
        try {
          var retry = {};
          retry[this.STORAGE_KEY] = this._data;
          await chrome.storage.local.set(retry);
        } catch (e2) {
          console.warn("[BrowserMemory] 清理后仍保存失败:", e2.message);
        }
      } else {
        console.warn("[BrowserMemory] 保存失败:", e.message);
      }
    }
  },

  _pruneOldData: function() {
    var cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    var newGoals = [];
    for (var i = 0; i < this._data.recentGoals.length; i++) {
      if (this._data.recentGoals[i].timestamp > cutoff) {
        newGoals.push(this._data.recentGoals[i]);
      }
    }
    this._data.recentGoals = newGoals.slice(-this.MAX_GOALS);

    var domainKeys = Object.keys(this._data.domains);
    for (var d = 0; d < domainKeys.length; d++) {
      var dm = this._data.domains[domainKeys[d]];
      if (dm.recentFailures) {
        dm.recentFailures = dm.recentFailures.filter(function(f) {
          return f.timestamp > cutoff;
        }).slice(-10);
      }
    }

    var selKeys = Object.keys(this._data.selectorStats);
    if (selKeys.length > 30) {
      var sorted = selKeys.map(function(k) {
        return { key: k, last: this._data.selectorStats[k].lastUsedAt || 0 };
      }.bind(this));
      sorted.sort(function(a, b) { return b.last - a.last; });
      var toRemove = sorted.slice(30);
      for (var s = 0; s < toRemove.length; s++) {
        delete this._data.selectorStats[toRemove[s].key];
      }
    }
  },

  /**
   * ensureLoaded()
   */
  _ensure: async function() {
    if (!this._loaded) await this.load();
  },

  _empty: function() {
    return {
      domains: {},
      recentGoals: [],
      selectorStats: {}
    };
  },

  /**
   * _domainKey(url)
   *
   * 从 URL 提取域名。如 "https://www.youtube.com/watch?v=xxx" → "youtube.com"
   */
  _domainKey: function(url) {
    if (!url) return null;
    try {
      var host = new URL(url).hostname;
      return host.replace(/^www\./, "");
    } catch (e) {
      return null;
    }
  },

  /**
   * _pageTypeKey(url)
   *
   * 从 URL 推断页面类型。
   * 如 "/watch" → "watch", "/results" → "search", "/" → "home"
   */
  _pageTypeKey: function(url) {
    if (!url) return "other";
    try {
      var pathname = new URL(url).pathname;
      if (!pathname || pathname === "/") return "home";
      var parts = pathname.split("/").filter(function(p) { return p.length > 0; });
      return parts[0] || "other";
    } catch (e) {
      return "other";
    }
  },

  /**
   * _ensureDomain(domain)
   */
  _ensureDomain: function(domain) {
    if (!this._data.domains[domain]) {
      this._data.domains[domain] = {
        visitCount: 0,
        successRate: 0,
        lastVisitAt: null,
        pageTypes: {},
        recentFailures: []
      };
    }
    return this._data.domains[domain];
  },

  /**
   * _ensurePageType(domain, pageType)
   */
  _ensurePageType: function(domain, pageType) {
    var dm = this._ensureDomain(domain);
    if (!dm.pageTypes[pageType]) {
      dm.pageTypes[pageType] = {
        stableSelectors: {},
        patterns: []
      };
    }
    return dm.pageTypes[pageType];
  },

  // ==========================================
  //   Public API
  // ==========================================

  /**
   * getContext(url)
   *
   * 返回给定 URL 的记忆上下文，注入到 Agent context 中。
   * 返回：{ domain, pageType, knownSelectors, patterns, selectorStats, recentFailures }
   */
  getContext: function(url) {
    var domain = this._domainKey(url);
    var pageType = this._pageTypeKey(url);

    if (!domain || !this._data.domains[domain]) {
      return {
        domain: domain,
        pageType: pageType,
        knownSelectors: {},
        patterns: [],
        recentFailures: [],
        hasExperience: false
      };
    }

    var dm = this._data.domains[domain];
    var pt = dm.pageTypes[pageType] || {};

    var allSelectors = {};
    if (pt.stableSelectors) {
      for (var key in pt.stableSelectors) {
        if (pt.stableSelectors.hasOwnProperty(key)) {
          allSelectors[key] = pt.stableSelectors[key];
        }
      }
    }

    var failSelectors = {};
    for (var i = 0; i < dm.recentFailures.length; i++) {
      var f = dm.recentFailures[i];
      if (f.selector) failSelectors[f.selector] = true;
    }

    var relevantStats = {};
    for (var selKey in allSelectors) {
      if (allSelectors.hasOwnProperty(selKey)) {
        var s = allSelectors[selKey];
        var stats = this._data.selectorStats[s];
        if (stats) relevantStats[s] = stats;
      }
    }

    return {
      domain: domain,
      pageType: pageType,
      knownSelectors: allSelectors,
      patterns: pt.patterns || [],
      recentFailures: dm.recentFailures.slice(0, 5),
      selectorStats: relevantStats,
      failedSelectors: failSelectors,
      hasExperience: true,
      visitCount: dm.visitCount || 0,
      successRate: dm.successRate || 0
    };
  },

  /**
   * recordVisit(url)
   *
   * 记录一次对某 domain 的访问。
   */
  recordVisit: async function(url) {
    await this._ensure();
    var domain = this._domainKey(url);
    if (!domain) return;

    var dm = this._ensureDomain(domain);
    dm.visitCount = (dm.visitCount || 0) + 1;
    dm.lastVisitAt = Date.now();

    await this._save();
  },

  /**
   * recordSelectorSuccess(domain, pageType, semanticKey, selector)
   *
   * 记录一个 selector 使用成功。
   * semanticKey 如 "searchInput"、"firstVideo"、"loginButton"
   *
   * Runtime 写入结构化数据，不经过 LLM。
   */
  recordSelectorSuccess: async function(domain, pageType, semanticKey, selector) {
    if (!domain || !selector) return;
    await this._ensure();

    var pt = this._ensurePageType(domain, pageType);
    pt.stableSelectors[semanticKey] = selector;

    if (!this._data.selectorStats[selector]) {
      this._data.selectorStats[selector] = {
        successCount: 0,
        failCount: 0,
        domains: [],
        lastUsedAt: null
      };
    }
    var stats = this._data.selectorStats[selector];
    stats.successCount = (stats.successCount || 0) + 1;
    stats.lastUsedAt = Date.now();
    if (stats.domains.indexOf(domain) === -1) {
      stats.domains.push(domain);
    }

    var dm = this._ensureDomain(domain);
    var total = (stats.successCount + stats.failCount) || 1;
    dm.successRate = Math.round((stats.successCount / total) * 100) / 100;

    this._cleanupSelectorStats();

    await this._save();
  },

  /**
   * recordSelectorFailure(domain, selector, actionType, reason)
   *
   * 失败经验比成功经验更值钱。
   */
  recordSelectorFailure: async function(domain, selector, actionType, reason) {
    if (!domain || !selector) return;
    await this._ensure();

    if (!this._data.selectorStats[selector]) {
      this._data.selectorStats[selector] = {
        successCount: 0,
        failCount: 0,
        domains: [],
        lastUsedAt: null
      };
    }
    var stats = this._data.selectorStats[selector];
    stats.failCount = (stats.failCount || 0) + 1;

    var dm = this._ensureDomain(domain);
    dm.recentFailures.push({
      action: actionType || "unknown",
      selector: selector,
      pageType: this._pageTypeKey(""),
      reason: reason || "",
      timestamp: Date.now()
    });

    while (dm.recentFailures.length > this.MAX_FAILURES) {
      dm.recentFailures.shift();
    }

    var total = (stats.successCount + stats.failCount) || 1;
    dm.successRate = Math.round((stats.successCount / total) * 100) / 100;

    this._cleanupSelectorStats();

    await this._save();
  },

  /**
   * addPattern(domain, pageType, pattern)
   *
   * 添加行为模式（由 LLM 总结，或 Runtime 自动）。
   */
  addPattern: async function(domain, pageType, pattern) {
    if (!domain || !pattern) return;
    await this._ensure();

    var pt = this._ensurePageType(domain, pageType);
    if (pt.patterns.indexOf(pattern) === -1) {
      pt.patterns.push(pattern);
      while (pt.patterns.length > this.MAX_PATTERNS) {
        pt.patterns.shift();
      }
    }

    await this._save();
  },

  /**
   * recordGoal(goal, result, url)
   *
   * 记录最近的目标和结果。
   */
  recordGoal: async function(goal, result, url) {
    await this._ensure();

    this._data.recentGoals.push({
      goal: goal,
      result: result || "unknown",
      domain: this._domainKey(url) || "",
      timestamp: Date.now()
    });

    while (this._data.recentGoals.length > this.MAX_GOALS) {
      this._data.recentGoals.shift();
    }

    await this._save();
  },

  /**
   * cleanupSelectorStats()
   *
   * 清理旧的 selector 统计数据，控制数据量。
   */
  _cleanupSelectorStats: function() {
    var keys = Object.keys(this._data.selectorStats);
    if (keys.length <= this.MAX_SELECTOR_STATS) return;

    var sorted = keys.map(function(k) {
      return { key: k, last: this._data.selectorStats[k].lastUsedAt || 0 };
    }.bind(this));

    sorted.sort(function(a, b) { return a.last - b.last; });

    var toRemove = sorted.slice(0, sorted.length - this.MAX_SELECTOR_STATS);
    for (var i = 0; i < toRemove.length; i++) {
      delete this._data.selectorStats[toRemove[i].key];
    }
  },

  /**
   * getStats()
   */
  getStats: function() {
    return {
      domainCount: this._data ? Object.keys(this._data.domains).length : 0,
      goalCount: this._data ? this._data.recentGoals.length : 0,
      selectorCount: this._data ? Object.keys(this._data.selectorStats).length : 0
    };
  },

  // ==========================================
  //   管理
  // ==========================================

  /**
   * clear()
   */
  clear: async function() {
    this._data = this._empty();
    await chrome.storage.local.remove(this.STORAGE_KEY);
    console.log("[BrowserMemory] 已清除所有记忆");
  },

  /**
   * getRaw()
   *
   * 调试用：返回完整数据。
   */
  getRaw: function() {
    return this._data;
  }
};


// === runtime\agentRuntime.js ===
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

var RUNTIME_LIMITS = {
  MAX_OUTPUT_LENGTH: 12000,
  REQUEST_TIMEOUT_MS: 30000,
  MAX_PARSE_RETRIES: 1
};

function sanitizeLLMOutput(raw) {
  if (!raw || typeof raw !== "string") throw new Error("AI 返回内容为空");
  var cleaned = raw.trim();
  if (cleaned.length > RUNTIME_LIMITS.MAX_OUTPUT_LENGTH) {
    throw new Error("AI 返回内容过长 (" + cleaned.length + " > " + RUNTIME_LIMITS.MAX_OUTPUT_LENGTH + ")");
  }
  var jsonBlock = cleaned.match(/```json\s*([\s\S]*?)```/);
  if (jsonBlock && jsonBlock[1]) {
    cleaned = jsonBlock[1].trim();
  } else {
    var codeBlock = cleaned.match(/```\s*([\s\S]*?)```/);
    if (codeBlock && codeBlock[1]) {
      cleaned = codeBlock[1].trim();
    } else if (cleaned.indexOf("{") !== -1 && cleaned.indexOf("}") !== -1) {
      var start = cleaned.indexOf("{");
      var end = cleaned.lastIndexOf("}");
      if (start < end) cleaned = cleaned.substring(start, end + 1);
    }
  }
  cleaned = cleaned.replace(/,\s*}/g, "}");
  cleaned = cleaned.replace(/,\s*]/g, "]");
  var lastBrace = cleaned.lastIndexOf("}");
  if (lastBrace > 0 && lastBrace < cleaned.length - 1) {
    var afterBrace = cleaned.substring(lastBrace + 1).trim();
    if (afterBrace.length > 0 && !/^[\s,.\]]/.test(afterBrace)) {
      cleaned = cleaned.substring(0, lastBrace + 1);
    }
  }
  return cleaned;
}

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


// === chat\chatRuntime.js ===
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


// === runtime\runtimeAPI.js ===
/**
 * runtimeAPI.js — Runtime 对外唯一接口
 *
 * 这是 UI 层唯一允许直接调用的 Runtime 入口。
 * 所有 Runtime 内部操作（Agent / Chat / 状态查询）必须经过此 API。
 *
 * 单向数据流：
 *   UI → runtimeAPI.startTask() / sendMessage() / stopTask()
 *   UI ← runtimeEvents (通过 subscribe)
 *
 * UI 绝不直接访问 RuntimeState / Planner / Tool / Provider。
 */

var RuntimeAPI = (function() {
  'use strict';

  var _config = {
    providerType: 'deepseek',
    apiKey: '',
    openclawEndpoint: 'http://localhost:18789/hooks/agent',
    captureMode: 'content'
  };

  var api = {};

  /**
   * configure(options)
   *
   * 设置 Runtime 配置。UI 启动时必须调用一次。
   */
  api.configure = function(options) {
    if (!options) return;
    if (options.providerType !== undefined) _config.providerType = options.providerType;
    if (options.apiKey !== undefined) _config.apiKey = options.apiKey;
    if (options.openclawEndpoint !== undefined) _config.openclawEndpoint = options.openclawEndpoint;
    if (options.captureMode !== undefined) _config.captureMode = options.captureMode;
    _applyProvider();
  };

  /**
   * startTask(request)
   *
   * 启动一个 Runtime 任务（总结 / QA / Agent）。
   *
   * request: {
   *   template: 'summarize' | 'qa' | 'agent',
   *   pageContent: string,
   *   question: string (optional),
   *   goal: string (for agent mode),
   *   activeTab: chrome.tabs.Tab
   * }
   *
   * 返回：Promise<result>
   */
  api.startTask = async function(request) {
    if (!request) throw new Error('RuntimeAPI.startTask: request 为空');

    var activeTab = request.activeTab || PopupState.activeTab;
    if (!activeTab || !activeTab.id) throw new Error('无法获取当前标签页');

    if (_config.providerType !== 'openclaw' && !_config.apiKey) {
      throw new Error('请先设置 API Key');
    }

    if (_config.providerType === 'openclaw') {
      try {
        var testResult = await api.testConnection();
        if (!testResult.ok) {
          throw new Error('OpenClaw 服务不可用: ' + testResult.message + '。请确保本地 OpenClaw 已启动，或在设置中切换到 DeepSeek。');
        }
      } catch (testErr) {
        if (testErr.message.indexOf('不支持连接测试') !== -1) {
          throw new Error('OpenClaw Provider 不支持连接测试');
        }
        if (testErr.message.indexOf('OpenClaw 服务不可用') !== -1) {
          throw testErr;
        }
        throw new Error('OpenClaw 服务不可用: ' + testErr.message + '。请确保本地 OpenClaw 已启动，或在设置中切换到 DeepSeek。');
      }
    }

    var context = {
      activeTab: activeTab,
      apiKey: _config.apiKey,
      providerType: _config.providerType,
      mode: _config.captureMode,
      pageContent: request.pageContent || ''
    };

    if (request.template === 'agent') {
      return await ReactRuntimeLoop.start(request.goal || request.question, context);
    } else {
      return await AgentRuntime.run({
        template: request.template,
        pageContent: request.pageContent,
        mode: _config.captureMode,
        apiKey: _config.apiKey,
        question: request.question || '',
        context: context
      });
    }
  };

  /**
   * stopTask()
   *
   * 取消当前正在执行的 Runtime 任务。
   */
  api.stopTask = function() {
    if (ReactRuntimeLoop.isRunning()) {
      ReactRuntimeLoop.stop();
    }
    AgentRuntime.cancel();
  };

  /**
   * sendMessage(request)
   *
   * 发送对话消息（Chat Tab）。
   */
  api.sendMessage = async function(request) {
    if (!request) throw new Error('RuntimeAPI.sendMessage: request 为空');

    if (_config.providerType !== 'openclaw' && !_config.apiKey) {
      throw new Error('请先设置 API Key');
    }

    if (_config.providerType === 'openclaw') {
      try {
        var testResult = await api.testConnection();
        if (!testResult.ok) {
          throw new Error('OpenClaw 服务不可用: ' + testResult.message + '。请确保本地 OpenClaw 已启动，或在设置中切换到 DeepSeek。');
        }
      } catch (testErr) {
        if (testErr.message.indexOf('OpenClaw 服务不可用') !== -1) throw testErr;
        throw new Error('OpenClaw 服务不可用: ' + testErr.message + '。请确保本地 OpenClaw 已启动，或在设置中切换到 DeepSeek。');
      }
    }

    return await ChatRuntime.send({
      userMessage: request.userMessage,
      apiKey: _config.apiKey,
      systemPrompt: request.systemPrompt,
      imageBase64: request.imageBase64 || null,
      imageMimeType: request.imageMimeType || null
    });
  };

  /**
   * subscribe(eventName, handler)
   *
   * 订阅 Runtime 事件。UI 通过此方法接收状态变化（只读）。
   */
  api.subscribe = function(eventName, handler) {
    RuntimeEvents.on(eventName, handler);
  };

  /**
   * unsubscribe(eventName, handler)
   */
  api.unsubscribe = function(eventName, handler) {
    RuntimeEvents.off(eventName, handler);
  };

  /**
   * getState()
   *
   * 获取 Runtime 当前状态的只读快照。
   */
  api.getState = function() {
    var rs = RuntimeState.get();
    var loopState = ReactRuntimeLoop.isRunning()
      ? ReactRuntimeLoop.getState()
      : null;
    var planProgress = PlannerEngine.getProgress();
    var recoveryStats = RecoveryManager.getStats();

    return Object.freeze({
      phase: rs.phase,
      sessionId: rs.sessionId || RuntimeSession.getSessionId(),
      runId: rs.runId,
      startedAt: rs.startedAt,
      metadata: rs.metadata ? Object.assign({}, rs.metadata) : null,
      loopState: loopState,
      planProgress: planProgress,
      stats: recoveryStats
    });
  };

  /**
   * getProviderCapabilities()
   *
   * 获取当前 Provider 的能力声明。
   */
  api.getProviderCapabilities = function() {
    var provider = LLMProvider._current;
    if (provider && provider.capabilities) {
      return Object.assign({}, provider.capabilities);
    }
    return null;
  };

  /**
   * testConnection()
   *
   * 测试 Provider 连接。
   */
  api.testConnection = async function() {
    var provider = LLMProvider._current;
    if (!provider || !provider.testConnection) {
      return { ok: false, message: '当前 Provider 不支持连接测试' };
    }
    return await provider.testConnection();
  };

  /**
   * clearChat(url)
   */
  api.clearChat = function(url) {
    ChatRuntime.clearHistory(url || '');
  };

  /**
   * loadChatHistory(url)
   */
  api.loadChatHistory = async function(url) {
    return await ChatRuntime.loadHistory(url);
  };

  /**
   * getPlanNodes()
   *
   * 获取当前 Plan 的节点列表（用于 UI 渲染计划图）。
   * 返回：节点数组 [{ id, description, status, action, ... }]
   */
  api.getPlanNodes = function() {
    var plan = PlannerEngine.getCurrentPlan();
    if (!plan) return [];
    return plan.getNodes();
  };

  // ==========================================
  //   内部方法
  // ==========================================

  function _applyProvider() {
    var providerConfig = {};
    if (_config.providerType === 'deepseek') {
      providerConfig = { apiKey: _config.apiKey };
    } else if (_config.providerType === 'openclaw') {
      providerConfig = { endpoint: _config.openclawEndpoint };
    }
    LLMProvider.setProvider(_config.providerType, providerConfig);
  }

  return api;
})();


// === ui\popupState.js ===
/**
 * PopupState - popup 全局状态
 *
 * 集中管理 popup 运行时的所有可变状态。
 */

var PopupState = {
  pageContent: "",
  hasApiKey: false,
  lastParsedData: null,
  captureMode: "content",
  activeTab: null,
  currentQuestion: "",
  chatMode: false,
  chatHistory: [],
  providerType: "deepseek",
  openclawEndpoint: "",
  agentTabId: null,
  activePanel: "analyze",
  analyzeMode: "summary"
};


// === ui\popupRenderer.js ===
/**
 * popupRenderer.js - UI 渲染函数
 *
 * 职责：
 *   1. 渲染 AI 总结结果
 *   2. 渲染 Runtime Trace 面板
 *   3. 更新按钮状态
 *
 * 所有 DOM 操作集中在此文件。
 */

function escapeHtml(text) {
  var div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

var PopupRenderer = {
  /**
   * updateSummarizeButton(summarizeBtn, askBtn)
   */
  updateSummarizeButton: function(summarizeBtn, askBtn) {
    var ready;
    if (PopupState.providerType === "openclaw") {
      ready = !!PopupState.pageContent;
    } else {
      ready = !!(PopupState.pageContent && PopupState.hasApiKey);
    }
    summarizeBtn.disabled = !ready;
    if (askBtn) askBtn.disabled = !ready;
  },

  /**
   * updateModeButtons(contentBtn, fullBtn, visualBtn)
   */
  updateModeButtons: function(contentBtn, fullBtn, visualBtn) {
    contentBtn.className = PopupState.captureMode === "content" ? "mode-btn active" : "mode-btn";
    fullBtn.className = PopupState.captureMode === "full" ? "mode-btn active" : "mode-btn";
    visualBtn.className = PopupState.captureMode === "visual" ? "mode-btn active" : "mode-btn";
  },

  /**
   * updatePageInfo(response, pageTitleEl, pagePreviewEl, pageLengthEl)
   */
  updatePageInfo: function(response, pageTitleEl, pagePreviewEl, pageLengthEl, pageFaviconEl) {
    pageTitleEl.textContent = response.title || "(无标题)";
    pagePreviewEl.textContent = response.preview;
    if (response.rawLength && response.rawLength !== response.totalLength) {
      pageLengthEl.textContent =
        response.totalLength + " 字符";
    } else {
      pageLengthEl.textContent =
        response.totalLength + " 字符";
    }
    if (pageFaviconEl && response.favIconUrl) {
      pageFaviconEl.src = response.favIconUrl;
      pageFaviconEl.style.display = "inline";
      pageFaviconEl.onerror = function() { this.style.display = "none"; };
    } else if (pageFaviconEl) {
      pageFaviconEl.style.display = "none";
    }
  },

  /**
   * renderSummary(parsed, summaryResult, copyBtn)
   */
  renderSummary: function(parsed, summaryResult, copyBtn) {
    summaryResult.innerHTML = "";
    summaryResult.classList.remove("empty");

    if (parsed.topic) {
      summaryResult.innerHTML +=
        '<div class="summary-card">' +
        '<div class="summary-label">主题</div>' +
        '<div class="summary-value">' + escapeHtml(parsed.topic) + '</div>' +
        '</div>';
    }

    if (parsed.summary) {
      summaryResult.innerHTML +=
        '<div class="summary-card">' +
        '<div class="summary-label">总结</div>' +
        '<div class="summary-value">' + escapeHtml(parsed.summary) + '</div>' +
        '</div>';
    }

    if (parsed.keywords && parsed.keywords.length > 0) {
      var tagsHtml = '';
      for (var i = 0; i < parsed.keywords.length; i++) {
        tagsHtml += '<span class="keyword-tag">' + escapeHtml(parsed.keywords[i]) + '</span>';
      }
      summaryResult.innerHTML +=
        '<div class="summary-card">' +
        '<div class="summary-label">关键词</div>' +
        '<div class="summary-value">' + tagsHtml + '</div>' +
        '</div>';
    }

    if (parsed.sentiment) {
      var badgeClass = parsed.sentiment === "positive" ? "positive" :
        parsed.sentiment === "negative" ? "negative" : "neutral";
      summaryResult.innerHTML +=
        '<div class="summary-card">' +
        '<div class="summary-label">情感倾向</div>' +
        '<div class="summary-value"><span class="sentiment-badge ' + badgeClass + '">' +
        escapeHtml(parsed.sentiment) + '</span></div>' +
        '</div>';
    }

    if (parsed.important_points && parsed.important_points.length > 0) {
      var pointsHtml = '';
      for (var j = 0; j < parsed.important_points.length; j++) {
        pointsHtml += '<div class="point-item">' + escapeHtml(parsed.important_points[j]) + '</div>';
      }
      summaryResult.innerHTML +=
        '<div class="summary-card">' +
        '<div class="summary-label">核心观点</div>' +
        '<div class="summary-value">' + pointsHtml + '</div>' +
        '</div>';
    }

    if (!summaryResult.innerHTML) {
      summaryResult.textContent = JSON.stringify(parsed);
    }

    PopupState.lastParsedData = parsed;
    copyBtn.style.display = "inline-block";
    copyBtn.textContent = "📋 复制";
    copyBtn.className = "";
  },

  /**
   * renderQAResult(parsed, summaryResult, copyBtn)
   */
  renderQAResult: function(parsed, summaryResult, copyBtn) {
    summaryResult.innerHTML = "";
    summaryResult.classList.remove("empty");

    if (parsed.answer) {
      summaryResult.innerHTML +=
        '<div class="summary-card">' +
        '<div class="summary-label">回答</div>' +
        '<div class="summary-value">' + escapeHtml(parsed.answer) + '</div>' +
        '</div>';
    }

    if (!summaryResult.innerHTML) {
      summaryResult.textContent = JSON.stringify(parsed);
    }

    PopupState.lastParsedData = parsed;
    copyBtn.style.display = "inline-block";
    copyBtn.textContent = "📋 复制";
    copyBtn.className = "";
  },

  /**
   * renderTracePanel(tracePanelEl)
   *
   * 渲染 Runtime Trace 时间线。
   * 自动读取 RuntimeTrace.getAll()。
   */
  renderTracePanel: function(tracePanelEl) {
    var logs = RuntimeTrace.getAll();
    if (!logs || !logs.length) {
      tracePanelEl.innerHTML = '<div class="trace-empty">暂无事件</div>';
      return;
    }

    var currentRunId = null;
    var html = "";
    for (var i = 0; i < logs.length; i++) {
      var entry = logs[i];
      var time = new Date(entry.timestamp);
      var timeStr =
        pad2(time.getHours()) + ":" +
        pad2(time.getMinutes()) + ":" +
        pad2(time.getSeconds());

      if (entry.runId && entry.runId !== currentRunId) {
        currentRunId = entry.runId;
        html +=
          '<div class="trace-run-sep">── run: ' + escapeHtml(currentRunId) + ' ──</div>';
      }

      var phaseBadge = "";
      if (entry.phase && entry.phase !== "idle") {
        phaseBadge = ' <span class="trace-status">' + escapeHtml(entry.phase) + '</span>';
      }

      var durationStr = "";
      if (entry.durationMs !== null) {
        durationStr = ' <span class="trace-duration">' + entry.durationMs + "ms</span>";
      }

      var tagClass = "trace-" + entry.type;
      html +=
        '<div class="trace-line">' +
        '<span class="trace-time">[' + timeStr + ']</span> ' +
        '<span class="' + tagClass + '">' + escapeHtml(entry.type) + '</span>' +
        phaseBadge +
        durationStr +
        '</div>';
    }

    tracePanelEl.innerHTML = html;
    tracePanelEl.scrollTop = tracePanelEl.scrollHeight;
  },

  /**
   * renderChatMessage(chatMessagesEl, role, content)
   *
   * 追加单条对话气泡。不替换整体，只 append。
   * content 可以是字符串（纯文本）或数组（Vision 格式）。
   */
  renderChatMessage: function(chatMessagesEl, role, content) {
    var welcomeEl = chatMessagesEl.querySelector(".chat-welcome");
    if (welcomeEl) welcomeEl.remove();

    var bubbleClass = role === "user" ? "chat-bubble user" : "chat-bubble assistant";
    var label = role === "user" ? "你" : "AI";

    var bubble = document.createElement("div");
    bubble.className = bubbleClass;

    var labelDiv = document.createElement("div");
    labelDiv.className = "chat-bubble-label";
    labelDiv.textContent = label;

    var contentDiv = document.createElement("div");
    contentDiv.className = "chat-bubble-content";

    if (Array.isArray(content)) {
      for (var i = 0; i < content.length; i++) {
        var part = content[i];
        if (part.type === "image_url" && part.image_url && part.image_url.url) {
          var img = document.createElement("img");
          img.src = part.image_url.url;
          img.className = "chat-bubble-image";
          contentDiv.appendChild(img);
        } else if (part.type === "text" && part.text) {
          var textNode = document.createTextNode(part.text);
          contentDiv.appendChild(textNode);
        }
      }
    } else {
      contentDiv.textContent = content;
    }

    bubble.appendChild(labelDiv);
    bubble.appendChild(contentDiv);

    chatMessagesEl.appendChild(bubble);
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  },

  /**
   * renderChatHistory(chatMessagesEl, history)
   *
   * 从 chatHistory[] 重建整个对话列表。
   * 跳过前两条（网页上下文注入的隐藏消息）。
   */
  renderChatHistory: function(chatMessagesEl, history) {
    chatMessagesEl.innerHTML = "";

    if (!history || history.length === 0) {
      chatMessagesEl.innerHTML = '<div class="chat-welcome">开始新对话，问我关于当前网页的任何问题</div>';
      return;
    }

    var startIndex = 0;
    if (history.length >= 2
        && history[0].role === "user"
        && typeof history[0].content === "string"
        && history[0].content.indexOf("当前网页内容：") === 0
        && history[1].role === "assistant") {
      startIndex = 2;
    }

    for (var i = startIndex; i < history.length; i++) {
      var msg = history[i];
      PopupRenderer.renderChatMessage(chatMessagesEl, msg.role, msg.content);
    }
  },

  /**
   * renderChatTyping(chatMessagesEl)
   *
   * 显示 AI 正在输入的提示气泡。
   */
  renderChatTyping: function(chatMessagesEl) {
    var existing = chatMessagesEl.querySelector(".chat-typing");
    if (existing) return;

    var typing = document.createElement("div");
    typing.className = "chat-bubble assistant chat-typing";

    var labelDiv = document.createElement("div");
    labelDiv.className = "chat-bubble-label";
    labelDiv.textContent = "AI";

    var contentDiv = document.createElement("div");
    contentDiv.className = "chat-bubble-content";
    contentDiv.textContent = "正在思考...";

    typing.appendChild(labelDiv);
    typing.appendChild(contentDiv);

    chatMessagesEl.appendChild(typing);
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  },

  /**
   * removeChatTyping(chatMessagesEl)
   */
  removeChatTyping: function(chatMessagesEl) {
    var typing = chatMessagesEl.querySelector(".chat-typing");
    if (typing) typing.remove();
  }
};

function pad2(n) {
  return n < 10 ? "0" + n : "" + n;
}


// === ui\popupControls.js ===
/**
 * popupControls.js — 按钮绑定 + 模式切换 + UI 控制
 *
 * 职责：
 *   1. 模式切换按钮事件
 *   2. 监听 RuntimeEvents("runtime_state_changed") 驱动 UI
 *   3. 总结 / 取消按钮显示切换
 *
 * 渲染策略根据 RuntimeState.current.result 结构自动判断，
 * 不再依赖 PopupState.currentTemplate。
 */

var PopupControls = {
  bindAll: function(elements) {
    var summarizeBtn = elements.summarizeBtn;
    var cancelBtn = elements.cancelBtn;
    var askBtn = elements.askBtn;
    var contentModeBtn = elements.contentModeBtn;
    var fullModeBtn = elements.fullModeBtn;
    var visualModeBtn = elements.visualModeBtn;

    RuntimeAPI.subscribe("runtime_state_changed", function(payload) {
      var phase = payload.phase;
      if (phase === "building_prompt") {
        if (PopupState.chatMode && elements.chatMessages) {
          PopupRenderer.renderChatTyping(elements.chatMessages);
        } else {
          elements.summaryResult.textContent = "正在构建提示词...";
          elements.summaryStatus.textContent = "";
          elements.summaryStatus.className = "";
        }
      } else if (phase === "requesting_llm") {
        if (PopupState.chatMode && elements.chatMessages) {
          PopupRenderer.renderChatTyping(elements.chatMessages);
        } else {
          elements.summaryResult.textContent = "正在请求 AI...";
        }
      } else if (phase === "executing_tool") {
        var md = payload.metadata || {};
        elements.summaryStatus.textContent = "正在执行操作: " + (md.tool || "");
        elements.summaryStatus.className = "";
      } else if (phase === "observing") {
        elements.summaryResult.textContent = "正在观察页面...";
      } else if (phase === "planning") {
        elements.summaryResult.textContent = "正在规划任务...";
        elements.summaryStatus.textContent = "";
        elements.summaryStatus.className = "";
      } else if (phase === "executing_plan") {
        elements.summaryResult.textContent = "正在执行计划...";
      } else if (phase === "executing_step") {
        var md = payload.metadata || {};
        var stepInfo = md.stepId ? md.stepId + " " : "";
        stepInfo += md.stepType === "observe" ? "观察页面" :
                    md.stepType === "tool" ? "执行工具" :
                    md.stepType === "browser_action" ? "执行浏览器操作" :
                    md.stepType === "respond" ? "生成回答" : "执行步骤";
        elements.summaryResult.textContent = "正在执行: " + stepInfo;
      } else if (phase === "executing_browser_action") {
        elements.summaryResult.textContent = "正在执行浏览器操作...";
      } else if (phase === "waiting_page_update") {
        elements.summaryResult.textContent = "等待页面更新...";
        elements.summaryResult.textContent = "正在思考...";
      } else if (phase === "acting") {
        elements.summaryResult.textContent = "正在执行操作...";
      } else if (phase === "reflecting") {
        elements.summaryResult.textContent = "正在记录步骤...";
      } else if (phase === "completed") {
        var result = payload.result;

        if (PopupState.chatMode && elements.chatMessages) {
          PopupRenderer.removeChatTyping(elements.chatMessages);
          if (result && result.content) {
            PopupRenderer.renderChatMessage(elements.chatMessages, "assistant", result.content);
          }
          if (result && result.chatHistory) {
            PopupState.chatHistory = result.chatHistory;
          }
          if (elements.chatStatus) {
            elements.chatStatus.textContent = "";
            elements.chatStatus.className = "";
          }
        } else if (result && result.answer) {
          var chatHistoryEl = document.getElementById("chatHistory");
          if (chatHistoryEl) {
            PopupRenderer.renderChatMessage(chatHistoryEl, "assistant", result.answer);
            var chatTabBtn = document.getElementById("chatTabBtn");
            if (chatTabBtn) chatTabBtn.click();
          }
          PopupControls.showRunButton(summarizeBtn, cancelBtn, askBtn);
        } else {
          if (result && result.finalAnswer) {
            PopupRenderer.renderQAResult({ answer: result.finalAnswer }, elements.summaryResult, elements.copyBtn);
          } else {
            PopupRenderer.renderSummary(result, elements.summaryResult, elements.copyBtn);
          }
          elements.summaryStatus.textContent = "✅ 完成";
          elements.summaryStatus.className = "";
          PopupControls.showRunButton(summarizeBtn, cancelBtn, askBtn);
        }
      } else if (phase === "failed" || phase === "cancelled") {
        if (PopupState.chatMode && elements.chatMessages) {
          PopupRenderer.removeChatTyping(elements.chatMessages);
          if (elements.chatStatus) {
            elements.chatStatus.textContent = "错误：" + (payload.error || "未知");
            elements.chatStatus.className = "summary-error";
          }
        } else {
          elements.summaryResult.textContent = "请求失败";
          elements.summaryStatus.textContent = "错误：" + (payload.error || "未知");
          elements.summaryStatus.className = "summary-error";
          PopupControls.showRunButton(summarizeBtn, cancelBtn, askBtn);
        }
      }
    });

    RuntimeAPI.subscribe("*", function() {
      if (elements.tracePanelEl) {
        PopupRenderer.renderTracePanel(elements.tracePanelEl);
      }
    });

    // 模式切换
    contentModeBtn.addEventListener("click", function() {
      if (PopupState.captureMode === "content") return;
      PopupState.captureMode = "content";
      PopupRenderer.updateModeButtons(contentModeBtn, fullModeBtn, visualModeBtn);
      elements.summaryResult.innerHTML = "";
      elements.summaryResult.classList.add("empty");
      elements.summaryResult.textContent = "正在重新抓取（内容模式）...";
      elements.fetchPageContent("content").catch(function(err) {
        console.error("模式切换失败:", err);
      });
    });

    fullModeBtn.addEventListener("click", function() {
      if (PopupState.captureMode === "full") return;
      PopupState.captureMode = "full";
      PopupRenderer.updateModeButtons(contentModeBtn, fullModeBtn, visualModeBtn);
      elements.summaryResult.innerHTML = "";
      elements.summaryResult.classList.add("empty");
      elements.summaryResult.textContent = "正在重新抓取（全局模式）...";
      elements.fetchPageContent("full").catch(function(err) {
        console.error("模式切换失败:", err);
      });
    });

    visualModeBtn.addEventListener("click", function() {
      if (PopupState.captureMode === "visual") return;
      PopupState.captureMode = "visual";
      PopupRenderer.updateModeButtons(contentModeBtn, fullModeBtn, visualModeBtn);
      elements.summaryResult.innerHTML = "";
      elements.summaryResult.classList.add("empty");
      elements.summaryResult.textContent = "正在重新抓取（图片模式）...";
      elements.fetchPageContent("visual").catch(function(err) {
        console.error("模式切换失败:", err);
      });
    });
  },

  showRunningButton: function(summarizeBtn, cancelBtn, askBtn) {
    summarizeBtn.style.display = "none";
    if (askBtn) askBtn.style.display = "none";
    cancelBtn.style.display = "inline-block";
  },

  showRunButton: function(summarizeBtn, cancelBtn, askBtn) {
    summarizeBtn.style.display = "inline-block";
    summarizeBtn.textContent = "🤖 AI 总结";
    cancelBtn.style.display = "none";
    PopupRenderer.updateSummarizeButton(summarizeBtn, askBtn);
  },

  showChatRunning: function(chatSendBtn, chatCancelBtn) {
    if (chatSendBtn) chatSendBtn.style.display = "none";
    if (chatCancelBtn) chatCancelBtn.style.display = "inline-block";
  },

  showChatSendButton: function(chatSendBtn, chatCancelBtn) {
    if (chatSendBtn) {
      chatSendBtn.style.display = "inline-block";
      chatSendBtn.disabled = !PopupState.hasApiKey;
    }
    if (chatCancelBtn) chatCancelBtn.style.display = "none";
  }
};


// === ui\popupEvents.js ===
/**
 * popupEvents.js — 事件委托入口
 *
 * 职责：
 *   委托到 PopupControls.bindAll()
 */

var PopupEvents = {
  bindAll: function(elements) {
    PopupControls.bindAll(elements);
  }
};


// === ui\popupRuntime.js ===
/**
 * popupRuntime.js — Runtime 启动/取消（委托给 RuntimeAPI）
 */
var PopupRuntime = {
  _runTask: async function(template, extras, elements) {
    if (!PopupState.pageContent) {
      if (elements.summaryStatus) {
        elements.summaryStatus.textContent = "没有网页内容";
        elements.summaryStatus.className = "summary-error";
      }
      return;
    }

    PopupControls.showRunningButton(elements.summarizeBtn, elements.cancelBtn, elements.askBtn);

    try {
      var result = await RuntimeAPI.startTask({
        template: template,
        pageContent: PopupState.pageContent,
        question: extras && extras.question ? extras.question : "",
        goal: extras && extras.question ? extras.question : ""
      });
      return result;
    } catch (err) {
      console.error("PopupRuntime: runTask 执行失败", err);
      if (elements.summaryStatus) {
        elements.summaryStatus.textContent = "执行失败：" + (err.message || "未知错误");
        elements.summaryStatus.className = "summary-error";
      }
      PopupControls.showRunButton(elements.summarizeBtn, elements.cancelBtn, elements.askBtn);
    }
  },

  startRuntime: async function(elements) {
    return PopupRuntime._runTask("summarize", {}, elements);
  },

  startQA: async function(elements) {
    var question = elements.questionInput.value.trim();
    if (!question) return;
    PopupState.currentQuestion = question;
    return PopupRuntime._runTask("qa", { question: question }, elements);
  },

  startLoop: async function(elements) {
    var question = elements.questionInput ? elements.questionInput.value.trim() : "";
    return PopupRuntime._runTask("agent", { question: question }, elements);
  },

  startChat: async function(elements) {
    if (PopupState.providerType !== "openclaw" && !PopupState.hasApiKey) {
      if (elements.chatStatus) {
        elements.chatStatus.textContent = "请先设置 API Key";
        elements.chatStatus.className = "summary-error";
      }
      return;
    }

    var userMessage = elements.chatInput.value.trim();
    var imageBase64 = elements.imageBase64 || null;
    var imageMimeType = elements.imageMimeType || null;
    if (!userMessage && !imageBase64) return;

    elements.chatInput.value = "";

    var displayContent;
    if (imageBase64) {
      displayContent = [
        {
          type: "image_url",
          image_url: { url: "data:" + (imageMimeType || "image/jpeg") + ";base64," + imageBase64 }
        },
        { type: "text", text: userMessage || "请描述这张图片" }
      ];
    } else {
      displayContent = userMessage;
    }

    PopupRenderer.renderChatMessage(elements.chatMessages, "user", displayContent);

    var lastUserBubble = elements.chatMessages.lastElementChild;

    PopupControls.showChatRunning(elements.chatSendBtn, elements.chatCancelBtn);

    var systemPrompt = PromptTemplates.chat.buildSystem(PopupState.captureMode, PopupState.pageContent);

    try {
      var result = await RuntimeAPI.sendMessage({
        userMessage: userMessage || "请描述这张图片",
        systemPrompt: systemPrompt,
        imageBase64: imageBase64,
        imageMimeType: imageMimeType
      });

      PopupState.chatHistory = result.chatHistory;
      PopupControls.showChatSendButton(elements.chatSendBtn, elements.chatCancelBtn);
    } catch (err) {
      console.error("PopupRuntime: startChat 执行失败", err);
      if (lastUserBubble && lastUserBubble.parentNode === elements.chatMessages) {
        lastUserBubble.remove();
      }
      var welcomeEl = elements.chatMessages.querySelector(".chat-empty");
      if (!welcomeEl && elements.chatMessages.children.length === 0) {
        elements.chatMessages.innerHTML = '<div class="chat-empty">开始提问，与页面对话</div>';
      }
      if (elements.chatStatus) {
        elements.chatStatus.textContent = "发送失败：" + (err.message || "未知错误");
        elements.chatStatus.className = "summary-error";
      }
      PopupControls.showChatSendButton(elements.chatSendBtn, elements.chatCancelBtn);
    }
  },

  clearChat: function(elements) {
    RuntimeAPI.clearChat(elements.url || "");
    PopupState.chatHistory = [];
    if (elements.chatMessages) {
      elements.chatMessages.innerHTML = '<div class="chat-empty">开始提问，与页面对话</div>';
    }
  },

  cancelRuntime: function(elements) {
    RuntimeAPI.stopTask();
    PopupControls.showRunButton(elements.summarizeBtn, elements.cancelBtn, elements.askBtn);
  },

  cancelChat: function(elements) {
    RuntimeAPI.stopTask();
    PopupControls.showChatSendButton(elements.chatSendBtn, elements.chatCancelBtn);
  }
};


// === ui\popup.js ===
/**
 * popup.js - 入口
 *
 * 职责：初始化 DOM 引用、绑定事件、首屏数据加载。
 */
document.addEventListener("DOMContentLoaded", async () => {
  var loadingEl = document.getElementById("loading");
  var resultEl = document.getElementById("result");
  var errorEl = document.getElementById("error");
  var apiKeyInput = document.getElementById("apiKeyInput");
  var saveKeyBtn = document.getElementById("saveKeyBtn");
  var apiStatus = document.getElementById("apiStatus");
  var summarizeBtn = document.getElementById("summarizeBtn");
  var cancelBtn = document.getElementById("cancelRuntimeBtn");
  var summaryResult = document.getElementById("summaryResult");
  var summaryStatus = document.getElementById("summaryStatus");
  var copyBtn = document.getElementById("copyBtn");
  var contentModeBtn = document.getElementById("contentModeBtn");
  var fullModeBtn = document.getElementById("fullModeBtn");
  var visualModeBtn = document.getElementById("visualModeBtn");
  var tracePanelEl = document.getElementById("runtimeTracePanel");

  RuntimeSession.init();
  RuntimeTrace.init();

  async function fetchPageContent(mode) {
    var [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) throw new Error("无法获取当前标签页");
    PopupState.activeTab = tab;
    var response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { action: "getPageContent", mode: mode });
    } catch (e) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["dist/content.bundle.js"]
      });
      response = await chrome.tabs.sendMessage(tab.id, { action: "getPageContent", mode: mode });
    }
    loadingEl.style.display = "none";
    resultEl.style.display = "block";
    PopupRenderer.updatePageInfo(response,
      document.getElementById("pageTitle"),
      document.getElementById("pagePreview"),
      document.getElementById("pageLength")
    );
    PopupState.pageContent = response.fullText || "";
    PopupState.captureMode = response.mode || mode;
    PopupRenderer.updateSummarizeButton(summarizeBtn);
  }

  PopupEvents.bindAll({
    loadingEl: loadingEl, resultEl: resultEl, errorEl: errorEl,
    apiKeyInput: apiKeyInput, saveKeyBtn: saveKeyBtn, apiStatus: apiStatus,
    summarizeBtn: summarizeBtn, cancelBtn: cancelBtn,
    summaryResult: summaryResult, summaryStatus: summaryStatus, copyBtn: copyBtn,
    contentModeBtn: contentModeBtn, fullModeBtn: fullModeBtn, visualModeBtn: visualModeBtn,
    tracePanelEl: tracePanelEl,
    fetchPageContent: fetchPageContent
  });

  var data = await chrome.storage.sync.get(["deepseekApiKey"]);
  var apiKey = data.deepseekApiKey || "";
  RuntimeAPI.configure({ providerType: "deepseek", apiKey: apiKey });

  PopupState.hasApiKey = !!apiKey;
  if (apiKey) {
    apiKeyInput.value = apiKey;
    apiStatus.textContent = "\u2713 API Key \u5DF2\u4FDD\u5B58";
    apiStatus.className = "api-status saved";
  } else {
    apiStatus.textContent = "\u672A\u8BBE\u7F6E API Key";
    apiStatus.className = "api-status missing";
  }

  saveKeyBtn.addEventListener("click", async () => {
    var key = apiKeyInput.value.trim();
    if (!key) {
      apiStatus.textContent = "\u8BF7\u8F93\u5165 API Key";
      apiStatus.className = "api-status missing";
      PopupState.hasApiKey = false;
      PopupRenderer.updateSummarizeButton(summarizeBtn);
      return;
    }
    await chrome.storage.sync.set({ deepseekApiKey: key });
    RuntimeAPI.configure({ providerType: "deepseek", apiKey: key });
    PopupState.hasApiKey = true;
    apiStatus.textContent = "\u2713 API Key \u5DF2\u4FDD\u5B58";
    apiStatus.className = "api-status saved";
    PopupRenderer.updateSummarizeButton(summarizeBtn);
  });

  try {
    await fetchPageContent("content");
  } catch (err) {
    loadingEl.style.display = "none";
    errorEl.style.display = "block";
    errorEl.textContent = "\u8BFB\u53D6\u5931\u8D25\uFF1A" + err.message;
  }

  summarizeBtn.addEventListener("click", function() {
    PopupRuntime.startRuntime({
      summarizeBtn: summarizeBtn,
      cancelBtn: cancelBtn,
      summaryResult: summaryResult,
      summaryStatus: summaryStatus
    });
  });

  cancelBtn.addEventListener("click", function() {
    PopupRuntime.cancelRuntime({
      summarizeBtn: summarizeBtn,
      cancelBtn: cancelBtn
    });
  });

  copyBtn.addEventListener("click", async () => {
    if (!PopupState.lastParsedData) return;
    var lines = [];
    var d = PopupState.lastParsedData;
    if (d.topic) lines.push("\u4E3B\u9898\uFF1A" + d.topic);
    if (d.summary) lines.push("\u603B\u7ED3\uFF1A" + d.summary);
    if (d.keywords && d.keywords.length > 0) lines.push("\u5173\u952E\u8BCD\uFF1A" + d.keywords.join("\u3001"));
    if (d.sentiment) lines.push("\u60C5\u611F\u503E\u5411\uFF1A" + d.sentiment);
    if (d.important_points && d.important_points.length > 0) {
      lines.push("\u6838\u5FC3\u89C2\u70B9\uFF1A");
      for (var i = 0; i < d.important_points.length; i++) {
        lines.push("  \u2022 " + d.important_points[i]);
      }
    }
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      copyBtn.textContent = "\u2705 \u5DF2\u590D\u5236";
      copyBtn.className = "copied";
      setTimeout(function() { copyBtn.textContent = "\uD83D\uDCCB \u590D\u5236"; copyBtn.className = ""; }, 2000);
    } catch (e) {
      copyBtn.textContent = "\u274C \u590D\u5236\u5931\u8D25";
    }
  });
});

