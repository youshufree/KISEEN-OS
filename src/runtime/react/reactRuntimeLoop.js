var ReactRuntimeLoop = {

  _running: false,
  _stopped: false,
  _finalAnswer: null,
  _tickPromise: null,
  _usePlannerEngine: true,
  _runtimeId: null,
  _taskId: null,
  _sessionId: null,

  /**
   * configure(options)
   *
   * options: { usePlannerEngine: true|false, limits: {...} }
   */
  configure: function(options) {
    options = options || {};
    if (options.usePlannerEngine !== undefined) {
      this._usePlannerEngine = !!options.usePlannerEngine;
    }
    if (options.limits) {
      LoopController.configure(options.limits);
    }
  },

  start: async function(goal, context) {
    if (this._running) {
      console.warn("[RuntimeLoop] 已在运行中");
      return { success: false, error: "已在运行中" };
    }

    this._running = true;
    this._stopped = false;
    this._finalAnswer = null;
    this._runtimeId = "rt_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    this._taskId = "task_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    this._sessionId = RuntimeSession.getSessionId();

    LoopMemory.reset();
    LoopMemory.setGoal(goal);
    LoopController.start(goal);
    RecoveryManager.configure({ maxAttempts: LoopController._limits ? LoopController._limits.maxRecoveryAttemptsPerStep : 3 });
    PlannerEngine.reset();
    RecoveryManager.reset();
    BrowserActionRuntime.reset();

    RuntimeEvents.emitScoped(this._runtimeId, "loop_started", {
      type: "loop_started",
      timestamp: Date.now(),
      payload: { goal: goal }
    });

    RuntimeState.setSession(this._sessionId, this._runtimeId);
    RuntimeState.set(RuntimeStatus.LOOPING, { goal: goal });

    console.log("[RuntimeLoop] 启动, 目标:", goal);

    try {
      // 注入运行时插件 handler 到当前 tab
      if (context && context.activeTab && context.activeTab.id) {
        await PluginManager.injectHandlersToTab(context.activeTab.id);
      }

      var result = await this._runLoop(goal, context);

      LoopController.stop();

      if (result.success) {
        RuntimeState.set(RuntimeStatus.COMPLETED, { result: result.finalAnswer });
      } else if (result.reason === "user_stop") {
      } else {
        RuntimeState.set(RuntimeStatus.FAILED, { error: result.error || result.reason });
      }

      RuntimeEvents.emitScoped(this._runtimeId, "loop_stopped", {
        type: "loop_stopped",
        timestamp: Date.now(),
        payload: {
          reason: result.reason || "completed",
          goalAchieved: result.success,
          iterations: LoopController.getIteration(),
          finalAnswer: result.finalAnswer || null
        }
      });

      return result;
    } catch (err) {
      LoopController.stop();

      RuntimeState.set(RuntimeStatus.FAILED, { error: err.message });

      RuntimeEvents.emitScoped(this._runtimeId, "loop_error", {
        type: "loop_error",
        timestamp: Date.now(),
        payload: {
          error: err.message,
          iterations: LoopController.getIteration()
        }
      });

      return {
        success: false,
        error: err.message,
        iterations: LoopController.getIteration(),
        finalAnswer: null,
        reason: "error"
      };
    } finally {
      this._running = false;
      RuntimeState.reset();
    }
  },

  stop: function() {
    if (!this._running) return;
    this._stopped = true;
    LoopController.stop();

    RuntimeState.set(RuntimeStatus.CANCELLED, { error: "用户主动取消" });

    RuntimeEvents.emitScoped(this._runtimeId, "loop_stopped", {
      type: "loop_stopped",
      timestamp: Date.now(),
      payload: { reason: "user_stop" }
    });

    console.log("[RuntimeLoop] 用户停止");
  },

  pause: function() {
    var paused = LoopController.pause();
    if (paused) {
      RuntimeEvents.emitScoped(this._runtimeId, "loop_paused", {
        type: "loop_paused",
        timestamp: Date.now(),
        payload: { iteration: LoopController.getIteration() }
      });
    }
  },

  resume: function() {
    var resumed = LoopController.resume();
    if (resumed) {
      RuntimeEvents.emitScoped(this._runtimeId, "loop_resumed", {
        type: "loop_resumed",
        timestamp: Date.now(),
        payload: { iteration: LoopController.getIteration() }
      });
    }
  },

  tick: async function(goal, context) {
    return await this._executeTick(goal, context);
  },

  getState: function() {
    return LoopController.getState();
  },

  isRunning: function() {
    return this._running;
  },

  // ==========================================
  //   内部实现
  // ==========================================

  _runLoop: async function(goal, context) {
    while (LoopController.canTick() && !this._stopped) {
      var tickResult = await this._executeTick(goal, context);

      if (tickResult.done) {
        this._finalAnswer = tickResult.finalAnswer;
        return {
          success: true,
          iterations: LoopController.getIteration(),
          finalAnswer: tickResult.finalAnswer,
          reason: "planner_done"
        };
      }

      if (tickResult.circuitBreak) {
        return {
          success: false,
          iterations: LoopController.getIteration(),
          finalAnswer: null,
          reason: "circuit_break",
          error: "连续失败熔断"
        };
      }

      var interval = LoopController.getTickInterval();
      if (interval > 0) {
        await this._sleep(interval);
      }
    }

    if (this._stopped) {
      return {
        success: false,
        iterations: LoopController.getIteration(),
        finalAnswer: null,
        reason: "user_stop"
      };
    }

    // 非用户停止（max_iterations / timeout）→ 收集已有结果但按 Plan 是否完成判定成功
    var partialAnswer = PlannerEngine.buildFinalAnswer();
    var planComplete = PlannerEngine.isPlanComplete();
    return {
      success: planComplete,
      iterations: LoopController.getIteration(),
      finalAnswer: partialAnswer || null,
      reason: LoopController.getStopReason()
    };
  },

  _executeTick: async function(goal, context) {
    LoopController.incrementIteration();
    var iteration = LoopController.getIteration();

    RuntimeEvents.emitScoped(this._runtimeId, "loop_tick", {
      type: "loop_tick",
      timestamp: Date.now(),
      payload: { iteration: iteration }
    });

    console.log("[RuntimeLoop] tick #" + iteration);

    // 1. Observe
    RuntimeState.set(RuntimeStatus.OBSERVING);
    var observation = await this._observe(context);
    LoopController.setLastObservation(observation);
    LoopMemory.addRecentObservation(observation);

    // ─── Goal Tracking: 检查是否偏离目标 ───
    var goalAlignment = LoopMemory.checkGoalAlignment(observation);
    if (goalAlignment.drifting && goalAlignment.warnings.length > 0) {
      for (var w = 0; w < goalAlignment.warnings.length; w++) {
        console.warn("[RuntimeLoop] ⚠ Goal Drift:", goalAlignment.warnings[w]);
      }
    }

    var observeStart = Date.now();
    var observeMeta = this._buildTraceMeta(iteration, observeStart);
    var observeData = this._buildObservationTraceData(observation, context);
    TraceStore.save(TraceTypes.observeTrace(observeMeta, observeData));

    // 2. Think — PlannerEngine 优先，失败时 fallback 到单步 Planner
    if (this._usePlannerEngine) {
      var plannerResult = await this._executeTickWithPlannerEngine(goal, observation, context, iteration);
      // PlannerEngine 无法生成计划时，降级到单步 Planner
      if (!plannerResult.circuitBreak && !plannerResult.done && !PlannerEngine.getCurrentPlan()) {
        console.warn("[RuntimeLoop] PlannerEngine 失败，降级到单步 Planner");
        return await this._executeTickWithSinglePlanner(goal, observation, context, iteration);
      }
      return plannerResult;
    } else {
      return await this._executeTickWithSinglePlanner(goal, observation, context, iteration);
    }
  },

  // ==========================================
  //   Act（通过 EnvironmentManager）
  // ==========================================

  _act: async function(action, context) {
    console.log("[RuntimeLoop] 执行 action:", action.type, JSON.stringify(action.target || {}));

    var finalAction = action;
    var tabId = context && context.activeTab ? context.activeTab.id : null;

    // ─── Selector 执行前验证（通过 EnvironmentManager）───
    if (tabId && action.target && (action.target.selector || action.target.text)) {
      try {
        var validation = await EnvironmentManager.validateTarget(action.target, tabId);
        if (validation.valid) {
          console.log("[RuntimeLoop] SelectorValidator ✓:", (action.target.selector || action.target.text));
        } else if (validation.suggestion) {
          var fixed = JSON.parse(JSON.stringify(action));
          if (validation.suggestion.selector) {
            fixed.target.selector = validation.suggestion.selector;
          }
          if (validation.suggestion.text) {
            fixed.target.text = validation.suggestion.text;
            delete fixed.target.selector;
          }
          finalAction = fixed;
          console.log("[RuntimeLoop] SelectorValidator 自动修复:", (action.target.selector || action.target.text), "→", (validation.suggestion.selector || validation.suggestion.text));
        } else {
          console.warn("[RuntimeLoop] SelectorValidator ✗:", validation.reason);
          return {
            success: false,
            action: action.type,
            error: "SELECTOR_NOT_FOUND: " + (action.target.selector || action.target.text) + " — " + (validation.reason || "元素不存在"),
            errorCategory: "selector_not_found",
            data: {},
            observation: {},
            durationMs: 0
          };
        }
      } catch (vErr) {
        console.warn("[RuntimeLoop] SelectorValidator 异常:", vErr.message);
      }
    }

    try {
      var result = await EnvironmentManager.execute(finalAction, context);
      return result;
    } catch (err) {
      return {
        success: false,
        action: finalAction.type,
        error: "执行异常: " + err.message,
        data: {},
        observation: {},
        durationMs: 0
      };
    }
  },

  _executeTickWithPlannerEngine: async function(goal, observation, context, iteration) {
    // 首次 tick 创建新 Plan
    if (!PlannerEngine.getCurrentPlan()) {
      RuntimeState.set(RuntimeStatus.PLANNING);
      var memory = LoopMemory.buildPlannerContext();
      var planResult = await PlannerEngine.plan(goal, observation, memory, context);

      if (!planResult || !planResult.currentStep) {
        console.warn("[RuntimeLoop] PlannerEngine 无法生成 Plan");
        LoopMemory.addFailure({
          action: "plan",
          error: "无法生成执行计划",
          iteration: iteration
        });
        return { done: false, circuitBreak: false };
      }

      console.log("[RuntimeLoop] Plan 创建:", planResult.planId, planResult.steps.length + " 步");

      var thinkMeta = this._buildTraceMeta(iteration);
      var plannerData = this._buildPlannerTraceData(goal);
      TraceStore.save(TraceTypes.thinkTrace(thinkMeta, plannerData, null));
    }

    // 获取当前步骤的 Action
    var action = PlannerEngine.getNextAction();
    if (!action) {
      if (PlannerEngine.isPlanComplete()) {
        this._finalAnswer = PlannerEngine.buildFinalAnswer();
        return { done: true, finalAnswer: this._finalAnswer, circuitBreak: false };
      }
      if (PlannerEngine.isPlanFailed()) {
        return { done: false, circuitBreak: true };
      }
      if (PlannerEngine.hasPendingSteps()) {
        console.warn("[RuntimeLoop] Plan 卡住: 有未完成步骤但无可用 action");
        return { done: false, circuitBreak: true };
      }
      return { done: false, circuitBreak: false };
    }

    console.log("[RuntimeLoop] getNextAction:", JSON.stringify(action));
    console.log("[RuntimeLoop] context.activeTab:", context && context.activeTab ? context.activeTab.id : "NULL");
    console.log("[RuntimeLoop] actionCount:", BrowserActionRuntime.getActionCount());

    if (!context || !context.activeTab || !context.activeTab.id) {
      console.error("[RuntimeLoop] context.activeTab 无效:", JSON.stringify(context));
      LoopMemory.addFailure({
        action: action.type,
        error: "context.activeTab 无效",
        iteration: iteration
      });
      return { done: false, circuitBreak: false };
    }

    var actionResult = await this._actAndRecord(action, context, iteration);

    var nodeId = action.metadata && action.metadata.nodeId;

    if (actionResult.success) {
      var stepCompleted = await PlannerEngine.completeStep(nodeId, actionResult, observation);

      LoopMemory.addCompletedStep({
        iteration: iteration,
        action: action.type,
        result: actionResult
      });
      LoopMemory.markProgress();
      RecoveryManager.reset();

      if (!stepCompleted) {
        var failedNode = PlannerEngine.getCurrentPlan().getNode(nodeId);
        var failureReason = (failedNode && failedNode.result) ? failedNode.result.error : "步骤评估未通过";
        await this._handlePlanStepFailure(nodeId, failureReason, observation, context);
      }
    } else {
      // Action 失败 → 先尝试 Recovery
      RuntimeState.set(RuntimeStatus.RECOVERING);
      var recoveryResult = await this._recover(action, actionResult, context, iteration);

      var recoverMeta = this._buildTraceMeta(iteration);
      var recoveryTraceData = {
        attempted: true,
        strategy: recoveryResult.strategy || "unknown",
        result: recoveryResult.recovered ? "recovered" : (recoveryResult.needsReplan ? "needs_replan" : (recoveryResult.needsStop ? "needs_stop" : "failed")),
        errorCategory: actionResult.errorCategory || "unknown",
        attemptNumber: 0,
        reason: recoveryResult.reason || ""
      };
      TraceStore.save(TraceTypes.recoverTrace(recoverMeta, recoveryTraceData, null, null));

      if (this._stopped) {
        return { done: false, circuitBreak: false };
      }

      if (recoveryResult.recovered) {
        var recoveredActionResult = recoveryResult.retryResult || { success: true, recovered: true, strategy: recoveryResult.strategy };
        await PlannerEngine.completeStep(nodeId, recoveredActionResult, observation);
        LoopMemory.addCompletedStep({
          iteration: iteration,
          action: action.type,
          result: { success: true, recovered: true, strategy: recoveryResult.strategy }
        });
        LoopMemory.markProgress();
        RecoveryManager.reset();
      } else if (recoveryResult.needsStop) {
        return { done: false, circuitBreak: true };
      } else if (recoveryResult.needsReplan) {
        await this._handlePlanStepFailure(nodeId, actionResult.error, observation, context);
      } else {
        LoopMemory.addFailure({
          action: action.type,
          error: actionResult.error,
          iteration: iteration
        });

        var consecutiveFailures = LoopMemory.getConsecutiveFailureCount();
        if (LoopController.shouldCircuitBreak(consecutiveFailures)) {
          return { done: false, circuitBreak: true };
        }

        await this._handlePlanStepFailure(nodeId, actionResult.error, observation, context);
      }
    }

    return { done: false, circuitBreak: false };
  },

  _handlePlanStepFailure: async function(nodeId, failureReason, observation, context) {
    var replanMeta = this._buildTraceMeta(LoopController.getIteration());
    TraceStore.save(TraceTypes.replanTrace(replanMeta, failureReason, null));

    var replanResult = await PlannerEngine.handleStepFailure(nodeId, failureReason, observation, context);

    if (!replanResult || !replanResult.success) {
      console.warn("[RuntimeLoop] 重规划失败:", replanResult ? replanResult.reason : "null");
    }
  },

  _executeTickWithSinglePlanner: async function(goal, observation, context, iteration) {
    var planResult = await this._think(goal, observation, context);

    var thinkMeta = this._buildTraceMeta(iteration);
    var plannerData = this._buildPlannerTraceData(goal);
    var llmData = planResult._llmData || null;
    TraceStore.save(TraceTypes.thinkTrace(thinkMeta, plannerData, llmData));

    if (planResult.done) {
      return {
        done: true,
        finalAnswer: planResult.finalAnswer || "任务完成",
        circuitBreak: false
      };
    }

    if (!planResult.action) {
      console.warn("[RuntimeLoop] Planner 未返回 action, iteration:", iteration);
      LoopMemory.addFailure({
        action: "none",
        error: "Planner 未返回 action",
        iteration: iteration
      });

      var consecutiveFailures = LoopMemory.getConsecutiveFailureCount();
      if (LoopController.shouldCircuitBreak(consecutiveFailures)) {
        return { done: false, circuitBreak: true };
      }

      return { done: false, circuitBreak: false };
    }

    var actionResult = await this._actAndRecord(planResult.action, context, iteration);

    if (actionResult.success) {
      LoopMemory.addCompletedStep({
        iteration: iteration,
        action: planResult.action.type,
        result: actionResult
      });
      LoopMemory.markProgress();
      RecoveryManager.reset();
    } else {
      RuntimeState.set(RuntimeStatus.RECOVERING);
      var recoveryResult = await this._recover(planResult.action, actionResult, context, iteration);

      var recoverMeta2 = this._buildTraceMeta(iteration);
      var recoveryTraceData2 = {
        attempted: true,
        strategy: recoveryResult.strategy || "unknown",
        result: recoveryResult.recovered ? "recovered" : (recoveryResult.needsReplan ? "needs_replan" : (recoveryResult.needsStop ? "needs_stop" : "failed")),
        errorCategory: actionResult.errorCategory || "unknown",
        attemptNumber: 0,
        reason: recoveryResult.reason || ""
      };
      TraceStore.save(TraceTypes.recoverTrace(recoverMeta2, recoveryTraceData2, null, null));

      if (recoveryResult.recovered) {
        LoopMemory.addCompletedStep({
          iteration: iteration,
          action: planResult.action.type,
          result: { success: true, recovered: true, strategy: recoveryResult.strategy }
        });
        LoopMemory.markProgress();
        RecoveryManager.reset();
      } else if (recoveryResult.needsReplan) {
        var reObservation = await this._observe(context);
        LoopMemory.addRecentObservation(reObservation);
      } else if (recoveryResult.needsStop) {
        return { done: false, circuitBreak: true };
      } else {
        LoopMemory.addFailure({
          action: planResult.action.type,
          error: actionResult.error,
          iteration: iteration
        });

        var consecutiveFailures2 = LoopMemory.getConsecutiveFailureCount();
        if (LoopController.shouldCircuitBreak(consecutiveFailures2)) {
          return { done: false, circuitBreak: true };
        }

        var reObservation2 = await this._observe(context);
        LoopMemory.addRecentObservation(reObservation2);
      }
    }

    return { done: false, circuitBreak: false };
  },

  // ==========================================
  //   Observe（通过 EnvironmentManager）
  // ==========================================

  _observe: async function(context) {
    var self = this;

    // 导航后首次观察：等待页面内容真正就绪
    if (this._lastActionWasNavigation) {
      this._lastActionWasNavigation = false;
      console.log("[RuntimeLoop] 导航后等待页面内容就绪...");
      for (var retry = 0; retry < 10; retry++) {
        try {
          var envState = await EnvironmentManager.perceive(context);
          var textLen = (envState && envState.observationText) ? envState.observationText.length : 0;
          if (envState && envState.pageType && envState.pageType !== "unknown" && textLen > 300) {
            console.log("[RuntimeLoop] 页面就绪 (尝试 " + (retry + 1) + ", " + textLen + " 字符)");
            return {
              summary: envState.summary || "",
              pageType: envState.pageType,
              interactiveElements: envState.interactiveElements || [],
              availableActions: envState.suggestedActions || [],
              forms: envState.pageMeta && envState.pageMeta.forms ? envState.pageMeta.forms : [],
              pageMeta: envState.pageMeta || {},
              observationText: envState.observationText || ""
            };
          }
        } catch (e) {}
        await this._sleep(800);
      }
      console.warn("[RuntimeLoop] 页面就绪等待超时，使用当前状态继续");
    }

    try {
      var envState = await EnvironmentManager.perceive(context);
      if (envState && envState.pageType && envState.pageType !== "unknown") {
        return {
          summary: envState.summary || "",
          pageType: envState.pageType,
          interactiveElements: envState.interactiveElements || [],
          availableActions: envState.suggestedActions || [],
          forms: envState.pageMeta && envState.pageMeta.forms ? envState.pageMeta.forms : [],
          pageMeta: envState.pageMeta || {},
          observationText: envState.observationText || ""
        };
      }
    } catch (err) {
      console.warn("[RuntimeLoop] EnvironmentManager.perceive 失败:", err.message);
    }

    if (context && context.activeTab && context.activeTab.id) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: context.activeTab.id },
          files: ["dist/content.bundle.js"]
        });
        console.log("[RuntimeLoop] Content Script 重新注入成功，等待就绪后重试观察");

        await new Promise(function(r) { setTimeout(r, 300); });

        var envState2 = await EnvironmentManager.perceive(context);
        if (envState2 && envState2.pageType && envState2.pageType !== "unknown") {
          return {
            summary: envState2.summary || "",
            pageType: envState2.pageType,
            interactiveElements: envState2.interactiveElements || [],
            availableActions: envState2.suggestedActions || [],
            forms: envState2.pageMeta && envState2.pageMeta.forms ? envState2.pageMeta.forms : [],
            pageMeta: envState2.pageMeta || {},
            observationText: envState2.observationText || ""
          };
        }
      } catch (injectErr) {
        var msg = (injectErr.message || "").toLowerCase();
        if (msg.indexOf("cannot be scripted") !== -1 || msg.indexOf("extensions gallery") !== -1) {
          console.log("[RuntimeLoop] 当前页面不支持 Content Script（Chrome 内部页面或 Web Store），跳过注入");
          return {
            summary: "当前页面不支持脚本注入（可能是 Chrome 内部页面），请导航到普通网页",
            pageType: "restricted",
            interactiveElements: [],
            availableActions: [],
            forms: [],
            pageMeta: {},
            observationText: "此页面不支持自动化操作，请使用 navigate_url 导航到其他网站"
          };
        }
        console.warn("[RuntimeLoop] Content Script 注入失败:", injectErr.message);
      }
    }

    return {
      summary: "无法获取页面观察",
      pageType: "unknown",
      interactiveElements: [],
      availableActions: [],
      forms: [],
      pageMeta: {},
      observationText: "无法获取页面观察数据"
    };
  },

  // ==========================================
  //   Think — Planner
  // ==========================================

  _think: async function(goal, observation, context) {
    var memoryContext = LoopMemory.buildPlannerContext();
    var observationText = ObservationSerializer.serialize(observation, {
      maxTextLength: 4000,
      includeDOM: true,
      includeForms: true,
      includeImages: false
    });

    var previousAction = LoopController.getState().lastAction;
    var failures = LoopMemory.getFailures(3);

    var prompt = this._buildThinkPrompt(goal, observationText, memoryContext, previousAction, failures);

    var messages = [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user }
    ];

    try {
      var apiKey = context && context.apiKey ? context.apiKey : null;
      var providerType = context && context.providerType ? context.providerType : "deepseek";
      if (!apiKey && providerType !== "openclaw") {
        console.warn("[RuntimeLoop] 无 apiKey, Planner 无法调用 LLM");
        return { done: false, action: null };
      }

      var llmOptions = {
        messages: messages,
        timeout: 30000
      };
      if (apiKey) {
        llmOptions.apiKey = apiKey;
      }

      var result = await LLMProvider.call(llmOptions);

      var sanitized = sanitizeLLMOutput(result.content);
      var parsed;
      try {
        parsed = JSON.parse(sanitized);
      } catch (e) {
        console.warn("[RuntimeLoop] Planner 返回非法 JSON:", e.message);
        return { done: false, action: null, _llmData: { prompt: JSON.stringify(messages), response: result.content, tokens: 0, latency: 0, provider: providerType } };
      }

      var output = this._parsePlannerOutput(parsed);
      output._llmData = {
        prompt: JSON.stringify(messages),
        response: result.content,
        tokens: 0,
        latency: 0,
        provider: providerType
      };
      return output;
    } catch (err) {
      console.error("[RuntimeLoop] Think 失败:", err.message);
      return { done: false, action: null };
    }
  },

  _buildThinkPrompt: function(goal, observationText, memoryContext, previousAction, failures) {
    var availableActions = BrowserActionDispatcher.getRegisteredTypes();

    var systemLines = [
      "你是一个 Browser Agent，负责在网页上执行任务。",
      "",
      "你的工作方式：",
      "1. 观察当前页面状态",
      "2. 决定下一步操作",
      "3. 操作完成后重新观察",
      "",
      "可用操作类型：",
    ];

    for (var i = 0; i < availableActions.length; i++) {
      systemLines.push("  - " + availableActions[i]);
    }

    systemLines.push("");
    systemLines.push("操作格式：");
    systemLines.push("{");
    systemLines.push('  "type": "click",');
    systemLines.push('  "target": { "selector": "..." },');
    systemLines.push('  "params": {}');
    systemLines.push("}");
    systemLines.push("");
    systemLines.push("click: { type: \"click\", target: { selector: \"...\" } } 或 { type: \"click\", target: { text: \"按钮文字\" } }");
    systemLines.push("input: { type: \"input\", target: { selector: \"...\" }, params: { value: \"输入内容\" } }");
    systemLines.push("scroll: { type: \"scroll\", params: { direction: \"down\", amount: 500 } }");
    systemLines.push("extract: { type: \"extract\", target: { selector: \"...\" } }");
    systemLines.push("wait_element: { type: \"wait_element\", target: { selector: \"...\" }, params: { timeout: 10000 } }");
    systemLines.push("hover: { type: \"hover\", target: { selector: \"...\" } } 或 { type: \"hover\", target: { text: \"菜单文字\" } }");
    systemLines.push("press_key: { type: \"press_key\", params: { key: \"Enter\" } }（key: Enter/Tab/Escape/ArrowDown/ArrowUp/Backspace/PageDown 等）");
    systemLines.push("scroll_to_element: { type: \"scroll_to_element\", target: { selector: \"...\" } }");
    systemLines.push("scroll_to_bottom: { type: \"scroll_to_bottom\" }");
    systemLines.push("select_option: { type: \"select_option\", target: { selector: \"select#xxx\" }, params: { value: \"选项值\" } } 或 { params: { label: \"选项文字\" } }");
    systemLines.push("extract_attribute: { type: \"extract_attribute\", target: { selector: \"a\" }, params: { attr: \"href\" } }（attr: href/src/data-* 等）");
    systemLines.push("navigate_url: { type: \"navigate_url\", params: { url: \"https://...\" } }");
    systemLines.push("open_tab: { type: \"open_tab\", params: { url: \"https://...\" } }（在新标签页打开，Agent 自动切换到新页）");
    systemLines.push("switch_tab: { type: \"switch_tab\", params: { tabId: 123456 } }");
    systemLines.push("");
    systemLines.push("支持的操作类型：" + availableActions.join(", "));
    systemLines.push("");
    systemLines.push("重要提示：");
    systemLines.push("1. 要访问新的网站，使用 navigate_url 或 open_tab");
    systemLines.push("2. 导航到新页面后，页面内容会自动更新，下一轮 observe 会看到新页面");
    systemLines.push("3. 你需要访问新网站时，使用 open_tab 打开，Agent 会自动聚焦到新标签页");
    systemLines.push("4. navigate_url 的 url 必须是完整 https:// 开头地址，如 https://www.reddit.com");
    systemLines.push("5. Selector 必须从「可交互元素」列表中获取真实 selector，严禁凭空猜测");
    systemLines.push("6. 提取标题时不要只用 h1，尝试观察中的 h2/h3 或有 headline/title class 的元素");
    systemLines.push("");
    systemLines.push("如果任务已完成，返回：");
    systemLines.push('{ "done": true, "finalAnswer": "任务结果" }');
    systemLines.push("");
    systemLines.push("要求：");
    systemLines.push("1. 必须返回合法 JSON");
    systemLines.push("2. 不要输出 markdown 代码块");
    systemLines.push("3. 每次只执行一个操作");
    systemLines.push("4. 优先使用 selector 定位元素");
    systemLines.push("5. 如果页面已经包含答案，直接 done=true");

    if (failures && failures.length > 0) {
      systemLines.push("");
      systemLines.push("最近的失败记录：");
      for (var f = 0; f < failures.length; f++) {
        systemLines.push("  - " + failures[f].action + ": " + failures[f].error);
      }
      systemLines.push("请避免重复失败的操作，尝试不同的策略。");
    }

    var userLines = [
      "任务目标：" + goal,
      "",
      "当前页面观察：",
      observationText
    ];

    if (previousAction) {
      userLines.push("");
      userLines.push("上一步操作：" + JSON.stringify(previousAction));
    }

    if (memoryContext.totalCompleted > 0) {
      userLines.push("");
      userLines.push("已完成步骤数：" + memoryContext.totalCompleted);
    }

    return {
      system: systemLines.join("\n"),
      user: userLines.join("\n")
    };
  },

  _parsePlannerOutput: function(parsed) {
    if (!parsed) return { done: false, action: null };

    if (parsed.done === true) {
      return {
        done: true,
        finalAnswer: parsed.finalAnswer || "任务完成"
      };
    }

    if (!parsed.type) {
      console.warn("[RuntimeLoop] Planner 输出缺少 type:", JSON.stringify(parsed));
      return { done: false, action: null };
    }

    var action = {
      type: parsed.type,
      target: parsed.target || {},
      params: parsed.params || {},
      metadata: parsed.metadata || {}
    };

    if (!action.metadata.nodeId) {
      action.metadata.nodeId = "single_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    }

    return {
      done: false,
      action: action
    };
  },

  // ==========================================
  //   Recovery
  // ==========================================

  _recover: async function(failedAction, actionResult, context, iteration) {
    var recoveryResult = await RecoveryManager.handleFailure(failedAction, actionResult, context);

    if (recoveryResult.recovered && recoveryResult.nextAction) {
      var retryResult = await this._act(recoveryResult.nextAction, context);
      if (retryResult.success) {
        return {
          recovered: true,
          strategy: recoveryResult.strategy,
          reason: recoveryResult.reason,
          retryResult: retryResult
        };
      }
      return {
        recovered: false,
        strategy: recoveryResult.strategy,
        reason: "恢复操作执行失败: " + (retryResult.error || "未知错误"),
        needsReplan: true
      };
    }

    return recoveryResult;
  },

  _actAndRecord: async function(action, context, iteration) {
    RuntimeState.set(RuntimeStatus.ACTING);
    var preUrl = context && context.activeTab ? context.activeTab.url : "";
    var actionResult = await this._act(action, context);

    console.log("[RuntimeLoop] actionResult:", actionResult.success ? "SUCCESS" : "FAILED", actionResult.error || "");

    // 点击/导航后检测 URL 是否变化（页面跳转）
    if (actionResult.success && (action.type === "click" || action.type === "navigate_url")) {
      try {
        await this._sleep(1500);
        var updatedTab = await new Promise(function(r) { chrome.tabs.get(context.activeTab.id, r); });
        if (updatedTab && updatedTab.url !== preUrl) {
          console.log("[RuntimeLoop] 页面已跳转:", preUrl, "→", updatedTab.url);
          context.activeTab = updatedTab;
          PopupState.activeTab = updatedTab;
          this._lastActionWasNavigation = true;
          // 注入 content script 到新页面
          try {
            await chrome.scripting.executeScript({
              target: { tabId: updatedTab.id },
              files: ["dist/content.bundle.js"]
            });
            await this._sleep(500);
          } catch (injectErr) {
            // 可能已注入
          }
        }
      } catch (e) {
        // tab 可能被关闭或无效
      }
    }

    var actMeta = this._buildTraceMeta(iteration);
    var actionTraceData = this._buildActionTraceData(action);
    var resultTraceData = this._buildResultTraceData(actionResult);
    TraceStore.save(TraceTypes.actTrace(actMeta, actionTraceData, resultTraceData));

    LoopMemory.addRecentAction({
      type: action.type,
      target: action.target || null,
      params: action.params || null,
      success: actionResult.success,
      _recovery: !!action._recoveryRetry
    });

    LoopController.setLastAction(action);

    return actionResult;
  },

  // ==========================================
  //   工具方法
  // ==========================================

  _sleep: function(ms) {
    return new Promise(function(resolve) {
      setTimeout(resolve, ms);
    });
  },

  // ==========================================
  //   Trace 辅助方法
  // ==========================================

  _buildTraceMeta: function(iteration, timestamp) {
    return {
      runtimeId: this._runtimeId,
      sessionId: this._sessionId,
      taskId: this._taskId,
      iteration: iteration,
      timestamp: timestamp || Date.now()
    };
  },

  _buildObservationTraceData: function(observation, context) {
    var meta = observation.pageMeta || {};
    var interactiveElements = observation.interactiveElements || [];
    var visibleCount = 0;
    for (var i = 0; i < interactiveElements.length; i++) {
      if (interactiveElements[i].visible) visibleCount++;
    }
    return {
      url: meta.url || "",
      title: meta.title || "",
      pageType: observation.pageType || "unknown",
      domSummary: observation.summary || "",
      interactiveCount: interactiveElements.length,
      visibleCount: visibleCount,
      formCount: (observation.forms || []).length,
      actionCount: (observation.availableActions || []).length,
      snapshotHash: ""
    };
  },

  _buildPlannerTraceData: function(goal) {
    var plan = PlannerEngine.getCurrentPlan();
    if (plan) {
      var progress = plan.getProgress();
      return {
        currentGoal: goal || plan.getGoal(),
        currentStep: "",
        currentStepDesc: "",
        remainingSteps: progress.pending,
        planId: plan.getId(),
        planStatus: plan.getStatus(),
        totalSteps: progress.total,
        completedSteps: progress.completed,
        failedSteps: progress.failed
      };
    }
    return {
      currentGoal: goal || "",
      currentStep: "",
      currentStepDesc: "",
      remainingSteps: 0,
      planId: "",
      planStatus: "",
      totalSteps: 0,
      completedSteps: 0,
      failedSteps: 0
    };
  },

  _buildActionTraceData: function(action) {
    return {
      type: action.type || "",
      target: action.target || null,
      selector: action.target && action.target.selector ? action.target.selector : "",
      params: action.params || null,
      semanticRole: ""
    };
  },

  _buildResultTraceData: function(actionResult) {
    return {
      success: actionResult.success || false,
      error: actionResult.error || null,
      errorCategory: actionResult.errorCategory || null,
      retry: 0,
      durationMs: actionResult.durationMs || 0,
      data: actionResult.data || null,
      observation: actionResult.observation || null
    };
  }
};
