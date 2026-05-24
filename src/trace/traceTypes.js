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
