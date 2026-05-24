var LoopMemory = {

  MAX_RECENT_ACTIONS: 10,
  MAX_RECENT_OBSERVATIONS: 5,
  MAX_FAILURES: 10,
  MAX_COMPLETED_STEPS: 20,
  MAX_DRIFT_STEPS: 4,

  _state: {
    recentActions: [],
    recentObservations: [],
    failures: [],
    completedSteps: [],
    goal: null,
    driftWarnings: [],
    lastProgressAt: null
  },

  addRecentAction: function(action) {
    this._state.recentActions.push({
      type: action.type,
      target: action.target || null,
      params: action.params || null,
      success: action.success,
      timestamp: Date.now()
    });
    if (this._state.recentActions.length > this.MAX_RECENT_ACTIONS) {
      this._state.recentActions = this._state.recentActions.slice(-this.MAX_RECENT_ACTIONS);
    }
  },

  addRecentObservation: function(observation) {
    this._state.recentObservations.push({
      summary: observation.summary || "",
      pageType: observation.pageType || "unknown",
      timestamp: Date.now()
    });
    if (this._state.recentObservations.length > this.MAX_RECENT_OBSERVATIONS) {
      this._state.recentObservations = this._state.recentObservations.slice(-this.MAX_RECENT_OBSERVATIONS);
    }
  },

  addFailure: function(failure) {
    this._state.failures.push({
      action: failure.action || "unknown",
      error: failure.error || "",
      iteration: failure.iteration || 0,
      timestamp: Date.now()
    });
    if (this._state.failures.length > this.MAX_FAILURES) {
      this._state.failures = this._state.failures.slice(-this.MAX_FAILURES);
    }
  },

  addCompletedStep: function(step) {
    this._state.completedSteps.push({
      iteration: step.iteration || 0,
      action: step.action || "unknown",
      result: step.result || null,
      timestamp: Date.now()
    });
    if (this._state.completedSteps.length > this.MAX_COMPLETED_STEPS) {
      this._state.completedSteps = this._state.completedSteps.slice(-this.MAX_COMPLETED_STEPS);
    }
  },

  getRecentActions: function(count) {
    var actions = this._state.recentActions;
    if (count && actions.length > count) {
      return actions.slice(-count);
    }
    return actions.slice();
  },

  getRecentObservations: function(count) {
    var obs = this._state.recentObservations;
    if (count && obs.length > count) {
      return obs.slice(-count);
    }
    return obs.slice();
  },

  getFailures: function(count) {
    var failures = this._state.failures;
    if (count && failures.length > count) {
      return failures.slice(-count);
    }
    return failures.slice();
  },

  getCompletedSteps: function(count) {
    var steps = this._state.completedSteps;
    if (count && steps.length > count) {
      return steps.slice(-count);
    }
    return steps.slice();
  },

  getConsecutiveFailureCount: function() {
    var actions = this._state.recentActions;
    var count = 0;
    // 从后往前遍历，只统计真实失败（非 recovery 重试标记）
    for (var i = actions.length - 1; i >= 0; i--) {
      if (!actions[i].success && !actions[i]._recovery) {
        count++;
      } else if (actions[i].success) {
        break;
      }
      // recovery 重试不计入连续失败
    }
    return count;
  },

  buildPlannerContext: function() {
    var recentActions = this.getRecentActions(3);
    var failures = this.getFailures(3);

    var actionSummaries = [];
    for (var i = 0; i < recentActions.length; i++) {
      var a = recentActions[i];
      actionSummaries.push({
        type: a.type,
        success: a.success,
        target: a.target
      });
    }

    var failureSummaries = [];
    for (var j = 0; j < failures.length; j++) {
      var f = failures[j];
      failureSummaries.push({
        action: f.action,
        error: f.error
      });
    }

    return {
      recentActions: actionSummaries,
      failures: failureSummaries,
      totalCompleted: this._state.completedSteps.length,
      totalFailures: this._state.failures.length,
      driftWarnings: this._state.driftWarnings.slice()
    };
  },

  // ==========================================
  //   Goal Tracking
  // ==========================================

  setGoal: function(goal) {
    this._state.goal = goal;
    this._state.driftWarnings = [];
    this._state.lastProgressAt = Date.now();
  },

  getGoal: function() {
    return this._state.goal || "";
  },

  markProgress: function() {
    this._state.lastProgressAt = Date.now();
    this._state.driftWarnings = [];
  },

  checkGoalAlignment: function(observation) {
    if (!this._state.goal) return { drifting: false, warnings: [] };

    // 页面未加载完成时不检测漂移
    var pageType = observation.pageType || "unknown";
    if (pageType === "unknown" || pageType === "restricted" || !observation.observationText || observation.observationText.indexOf("无法") !== -1) {
      return { drifting: false, warnings: [] };
    }

    var warnings = [];
    var goal = this._state.goal.toLowerCase();
    var obsText = (observation.observationText || observation.summary || "").toLowerCase();
    var pageType = observation.pageType || "unknown";

    // 检查 1: 目标关键词是否在观察文本中出现
    var goalKeywords = this._extractKeywords(goal);
    var matchedKeywords = 0;
    for (var i = 0; i < goalKeywords.length; i++) {
      if (obsText.indexOf(goalKeywords[i]) !== -1) matchedKeywords++;
    }

    if (matchedKeywords === 0 && goalKeywords.length > 0) {
      warnings.push("当前页面未包含目标关键词：观察文本与目标" + this._state.goal.substring(0, 30) + "无关");
    }

    // 检查 2: 是否长时间无进展
    if (this._state.lastProgressAt) {
      var elapsed = Date.now() - this._state.lastProgressAt;
      if (elapsed > 60000 && this._state.completedSteps.length === 0) {
        warnings.push("已运行 " + Math.round(elapsed / 1000) + " 秒但无任何完成步骤，请检查是否走错方向");
      }
    }

    // 检查 3: 连续失败但未触发 replan
    var consecutiveFails = this.getConsecutiveFailureCount();
    if (consecutiveFails >= 2) {
      warnings.push("连续 " + consecutiveFails + " 次失败，请更换策略而非重复相同操作");
    }

    this._state.driftWarnings = warnings;
    return {
      drifting: warnings.length > 0,
      warnings: warnings
    };
  },

  getDriftWarnings: function() {
    return this._state.driftWarnings.slice();
  },

  _extractKeywords: function(text) {
    var stopWords = ["的", "在", "是", "了", "和", "或", "与", "the", "a", "an", "is", "are", "was", "were", "be", "to", "of", "in", "for", "on", "and", "or", "with", "请", "然后", "并"];
    var words = text.replace(/[，,。.！!？?、；;：:（）()【】\[\]""''""\s]+/g, " ").split(" ");
    var keywords = [];
    for (var i = 0; i < words.length; i++) {
      var w = words[i].toLowerCase().trim();
      if (w.length >= 2 && stopWords.indexOf(w) === -1) {
        keywords.push(w);
      }
    }
    return keywords.slice(0, 10);
  },

  reset: function() {
    this._state = {
      recentActions: [],
      recentObservations: [],
      failures: [],
      completedSteps: [],
      goal: null,
      driftWarnings: [],
      lastProgressAt: null
    };
  },

  getStats: function() {
    return {
      recentActionsCount: this._state.recentActions.length,
      recentObservationsCount: this._state.recentObservations.length,
      failuresCount: this._state.failures.length,
      completedStepsCount: this._state.completedSteps.length,
      consecutiveFailures: this.getConsecutiveFailureCount()
    };
  }
};
