var RecoveryManager = {

  MAX_RECOVERY_ATTEMPTS: 3,
  // ✅ BUG修复#2: 改为按会话+步骤隔离的Map结构（之前是全局计数器导致竞态）
  _recoveryAttempts: new Map(),  // key: `${sessionId}_${stepId}`, value: count
  _recoveryHistory: [],          // 完整恢复历史
  _totalRecoveries: 0,
  _totalRecoveryFailures: 0,

  configure: function(options) {
    options = options || {};
    if (options.maxAttempts && options.maxAttempts > 0) {
      this.MAX_RECOVERY_ATTEMPTS = options.maxAttempts;
    }
  },

  /**
   * 获取某个步骤的重试次数
   * @private
   */
  _getAttemptKey: function(sessionId, stepId) {
    return sessionId + "_" + stepId;
  },

  /**
   * 增加重试计数
   * @private
   */
  _incrementAttempts: function(sessionId, stepId) {
    var key = this._getAttemptKey(sessionId, stepId);
    var current = this._recoveryAttempts.get(key) || 0;
    this._recoveryAttempts.set(key, current + 1);
    return current + 1;
  },

  /**
   * 获取重试计数
   * @private
   */
  _getAttempts: function(sessionId, stepId) {
    var key = this._getAttemptKey(sessionId, stepId);
    return this._recoveryAttempts.get(key) || 0;
  },

  /**
   * 清理某个步骤的重试记录
   * @private
   */
  _clearAttempts: function(sessionId, stepId) {
    var key = this._getAttemptKey(sessionId, stepId);
    this._recoveryAttempts.delete(key);
  },

  classifyError: function(error) {
    if (!error) return RUNTIME_ERROR_CATEGORIES.UNKNOWN;

    var lowerError = error.toLowerCase();

    if (lowerError.indexOf("receiving end does not exist") !== -1 ||
        lowerError.indexOf("could not establish") !== -1 ||
        lowerError.indexOf("content script") !== -1 ||
        lowerError.indexOf("connection_lost") !== -1) {
      return RUNTIME_ERROR_CATEGORIES.CONNECTION_LOST;
    }

    if (lowerError.indexOf("元素不存在") !== -1 ||
        lowerError.indexOf("未找到") !== -1 ||
        lowerError.indexOf("selector") !== -1 ||
        lowerError.indexOf("元素不可见") !== -1) {
      return RUNTIME_ERROR_CATEGORIES.SELECTOR_NOT_FOUND;
    }

    if (lowerError.indexOf("超时") !== -1 ||
        lowerError.indexOf("timeout") !== -1 ||
        lowerError.indexOf("等待元素超时") !== -1) {
      return RUNTIME_ERROR_CATEGORIES.TIMEOUT;
    }

    if (lowerError.indexOf("页面变化") !== -1 ||
        lowerError.indexOf("page changed") !== -1 ||
        lowerError.indexOf("navigation") !== -1) {
      return RUNTIME_ERROR_CATEGORIES.PAGE_CHANGED;
    }

    if (lowerError.indexOf("stale") !== -1 ||
        lowerError.indexOf("detached") !== -1 ||
        lowerError.indexOf("元素已禁用") !== -1) {
      return RUNTIME_ERROR_CATEGORIES.STALE_ELEMENT;
    }

    if (lowerError.indexOf("安全策略阻止") !== -1 ||
        lowerError.indexOf("blocked") !== -1 ||
        lowerError.indexOf("危险") !== -1) {
      return RUNTIME_ERROR_CATEGORIES.BLOCKED_ACTION;
    }

    return RUNTIME_ERROR_CATEGORIES.UNKNOWN;
  },

  isRecoverable: function(errorCategory) {
    return errorCategory !== RUNTIME_ERROR_CATEGORIES.BLOCKED_ACTION;
  },

  handleFailure: async function(failedAction, actionResult, context) {
    var sessionId = RuntimeSession.getSessionId();
    var stepId = (failedAction.metadata && failedAction.metadata.nodeId) || null;

    if (!sessionId || !stepId) {
      console.error("[Recovery] 缺少sessionId或stepId, action metadata:", JSON.stringify(failedAction.metadata || {}));
      return { recovered: false, reason: "缺少上下文信息" };
    }

    var errorCategory = this.classifyError(actionResult.error);
    var isRecoverable = this.isRecoverable(errorCategory);
    var currentAttempts = this._getAttempts(sessionId, stepId);

    console.log(
      "[Recovery] 处理失败 - Step:" + stepId + 
      " Attempts:" + currentAttempts + 
      " Category:" + errorCategory
    );

    RuntimeEvents.emit("recovery_started", {
      type: "recovery_started",
      timestamp: Date.now(),
      payload: {
        sessionId: sessionId,
        stepId: stepId,
        action: failedAction.type,
        errorCategory: errorCategory,
        error: actionResult.error,
        recoverable: isRecoverable,
        attempt: currentAttempts + 1
      }
    });

    // 不可恢复的错误
    if (!isRecoverable) {
      RuntimeEvents.emit("recovery_failed", {
        type: "recovery_failed",
        timestamp: Date.now(),
        payload: {
          sessionId: sessionId,
          stepId: stepId,
          action: failedAction.type,
          errorCategory: errorCategory,
          reason: "不可恢复的错误类型"
        }
      });

      this._clearAttempts(sessionId, stepId);
      this._totalRecoveryFailures++;

      return {
        recovered: false,
        strategy: "none",
        nextAction: null,
        reason: "不可恢复: " + errorCategory
      };
    }

    // ✅ 检查重试次数限制（按步骤）
    if (currentAttempts >= this.MAX_RECOVERY_ATTEMPTS) {
      console.warn(
        "[Recovery] 步骤" + stepId + "恢复次数已用尽: " + currentAttempts
      );

      RuntimeEvents.emit("recovery_failed", {
        type: "recovery_failed",
        timestamp: Date.now(),
        payload: {
          sessionId: sessionId,
          stepId: stepId,
          action: failedAction.type,
          errorCategory: errorCategory,
          reason: "恢复次数已用尽 (" + currentAttempts + ")"
        }
      });

      this._clearAttempts(sessionId, stepId);
      this._totalRecoveryFailures++;

      return {
        recovered: false,
        strategy: "max_attempts",
        nextAction: null,
        reason: "恢复次数已用尽"
      };
    }

    // ✅ 增加此步骤的重试计数（修复#2: 竞态条件）
    var nextAttempt = this._incrementAttempts(sessionId, stepId);

    var recoveryContext = {
      sessionId: sessionId,
      stepId: stepId,
      failedAction: failedAction,
      failedReason: actionResult.error,
      errorCategory: errorCategory,
      currentObservation: LoopMemory.getRecentObservations(1)[0] || null,
      recentActions: LoopMemory.getRecentActions(3),
      recentFailures: LoopMemory.getFailures(3),
      executionContext: context,
      attemptNumber: nextAttempt  // 当前重试次数
    };

    var strategies = RecoveryStrategies.getSortedStrategies(errorCategory);

    // ─── 按历史成功率重排序（静态 priority 作为 baseline）───
    try {
      var strategyNames = [];
      for (var si = 0; si < strategies.length; si++) {
        strategyNames.push(strategies[si].name);
      }
      var sortedBySuccess = RecoveryStrategyTracker.getSortedStrategies(strategyNames);
      var reordered = [];
      for (var t = 0; t < sortedBySuccess.length; t++) {
        for (var s = 0; s < strategies.length; s++) {
          if (strategies[s].name === sortedBySuccess[t].name) {
            reordered.push(strategies[s]);
            break;
          }
        }
      }
      strategies = reordered;
      console.log("[Recovery] 策略排序:", strategies.map(function(s) { return s.name + "(" + s.priority + ")"; }).join(" → "));
    } catch (sortErr) {
      console.warn("[Recovery] 策略排序失败，使用静态优先级:", sortErr.message);
    }

    for (var i = 0; i < strategies.length; i++) {
      var strategy = strategies[i];

      RuntimeEvents.emit("recovery_strategy_selected", {
        type: "recovery_strategy_selected",
        timestamp: Date.now(),
        payload: {
          sessionId: sessionId,
          stepId: stepId,
          action: failedAction.type,
          strategy: strategy.name,
          priority: strategy.priority,
          attempt: nextAttempt
        }
      });

      try {
        var result = await strategy.execute(recoveryContext);

        if (result.recovered) {
          this._totalRecoveries++;
          // ✅ 成功恢复，清理该步骤的重试计数（修复#2）
          this._clearAttempts(sessionId, stepId);
          ActionRetry.resetRetryCount(failedAction);

          RuntimeEvents.emit("recovery_completed", {
            type: "recovery_completed",
            timestamp: Date.now(),
            payload: {
              sessionId: sessionId,
              stepId: stepId,
              strategy: result.strategy,
              attempt: nextAttempt,
              reason: result.reason
            }
          });

          this._recoveryHistory.push({
            timestamp: Date.now(),
            sessionId: sessionId,
            stepId: stepId,
            error: actionResult.error,
            strategy: strategy.name,
            success: true
          });

          console.log("[Recovery] 恢复成功:", result.strategy, result.reason);
          return result;
        }

        if (result.needsStop) {
          this._totalRecoveryFailures++;

          RuntimeEvents.emit("recovery_failed", {
            type: "recovery_failed",
            timestamp: Date.now(),
            payload: {
              action: failedAction.type,
              strategy: result.strategy,
              reason: result.reason
            }
          });

          return result;
        }

        if (result.needsReplan) {
          RuntimeEvents.emit("recovery_completed", {
            type: "recovery_completed",
            timestamp: Date.now(),
            payload: {
              action: failedAction.type,
              strategy: result.strategy,
              reason: result.reason,
              needsReplan: true
            }
          });

          return result;
        }

        console.log("[Recovery] 策略未恢复:", strategy.name, result.reason);
      } catch (err) {
        console.warn("[Recovery] 策略执行异常:", strategy.name, err.message);
      }
    }

    console.warn("[Recovery] 所有恢复策略都失败");
    this._totalRecoveryFailures++;

    RuntimeEvents.emit("recovery_failed", {
      type: "recovery_failed",
      timestamp: Date.now(),
      payload: {
        sessionId: sessionId,
        stepId: stepId,
        reason: "所有恢复策略失败"
      }
    });

    this._recoveryHistory.push({
      timestamp: Date.now(),
      sessionId: sessionId,
      stepId: stepId,
      error: actionResult.error,
      strategy: "all_failed",
      success: false
    });

    return {
      recovered: false,
      strategy: "all_failed",
      nextAction: null,
      reason: "所有恢复策略都失败"
    };
  },

  /**
   * ✅ 新增：清理过期会话的重试记录
   */
  clearSessionAttempts: function(sessionId) {
    var keysToDelete = [];
    this._recoveryAttempts.forEach((value, key) => {
      if (key.startsWith(sessionId + "_")) {
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach(key => this._recoveryAttempts.delete(key));
    console.log("[Recovery] 清理会话记录:", sessionId, "条数:", keysToDelete.length);
  },

  reset: function() {
    this._recoveryAttempts.clear();
    this._recoveryHistory = [];
    ActionRetry.resetAll();
    SelectorRecovery.clearCache();
  },

  getStats: function() {
    return {
      totalRecoveries: this._totalRecoveries,
      totalRecoveryFailures: this._totalRecoveryFailures,
      activeAttempts: this._recoveryAttempts.size,
      historyLength: this._recoveryHistory.length,
      maxAttempts: this.MAX_RECOVERY_ATTEMPTS
    };
  }
};
