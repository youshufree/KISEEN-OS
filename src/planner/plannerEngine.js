var PlannerEngine = {

  _currentPlan: null,
  _planCache: {},

  plan: async function(goal, observation, memory, context) {
    console.log("[Planner] 开始规划, 目标:", goal);

    var domain = "";
    if (context && context.activeTab && context.activeTab.url) {
      try { domain = new URL(context.activeTab.url).hostname; } catch(e) {}
    }
    var cacheKey = goal + ":" + (observation ? observation.pageType : "unknown") + "@" + domain;
    if (this._planCache[cacheKey]) {
      var cached = this._planCache[cacheKey];
      if (Date.now() - cached.timestamp < 30000) {
        console.log("[Planner] 使用缓存 Plan");
        return cached.result;
      }
      delete this._planCache[cacheKey];
    }

    var observationText = "";
    if (observation) {
      try {
        observationText = ObservationSerializer.serialize(observation, {
          maxTextLength: 3000,
          includeDOM: true,
          includeForms: true,
          includeImages: false
        });
      } catch (e) {
        observationText = observation.summary || "无观察数据";
      }
    }

    var steps = await GoalDecomposer.decompose(goal, observationText, context, observation);

    var planGraph = PlanGraph.create(goal);
    planGraph.addNodesFromSteps(steps);

    this._currentPlan = planGraph;

    var result = {
      planId: planGraph.getId(),
      steps: planGraph.getNodes(),
      currentStep: planGraph.getCurrentNode(),
      reasoning: "目标拆解为 " + steps.length + " 步",
      status: planGraph.getStatus()
    };

    RuntimeEvents.emit("plan_created", {
      type: "plan_created",
      timestamp: Date.now(),
      payload: {
        planId: result.planId,
        goal: goal,
        stepCount: steps.length
      }
    });

    this._planCache[cacheKey] = {
      result: result,
      timestamp: Date.now()
    };

    return result;
  },

  getNextAction: function() {
    if (!this._currentPlan) return null;

    var currentNode = this._currentPlan.getCurrentNode();
    if (!currentNode) return null;

    if (currentNode.status === NodeStatus.PENDING) {
      this._currentPlan.startNode(currentNode.id);

      RuntimeEvents.emit("plan_step_started", {
        type: "plan_step_started",
        timestamp: Date.now(),
        payload: {
          planId: this._currentPlan.getId(),
          nodeId: currentNode.id,
          action: currentNode.action,
          description: currentNode.description
        }
      });
    }

    return {
      type: currentNode.action,
      target: currentNode.target || {},
      params: currentNode.params || {},
      metadata: {
        nodeId: currentNode.id,
        planId: this._currentPlan.getId(),
        description: currentNode.description
      }
    };
  },

  completeStep: async function(nodeId, actionResult, observation) {
    if (!this._currentPlan) return false;

    var node = this._currentPlan.getNode(nodeId);
    if (!node) return false;

    var evaluation = await StepEvaluator.evaluate(node, actionResult, observation);

    if (evaluation.completed) {
      this._currentPlan.completeNode(nodeId, {
        actionResult: actionResult,
        evaluation: evaluation
      });

      RuntimeEvents.emit("plan_step_completed", {
        type: "plan_step_completed",
        timestamp: Date.now(),
        payload: {
          planId: this._currentPlan.getId(),
          nodeId: nodeId,
          action: node.action,
          confidence: evaluation.confidence,
          reason: evaluation.reason
        }
      });

      console.log("[Planner] 步骤完成:", node.description, "confidence:", evaluation.confidence);
    } else {
      this._currentPlan.failNode(nodeId, evaluation.reason);

      RuntimeEvents.emit("plan_updated", {
        type: "plan_updated",
        timestamp: Date.now(),
        payload: {
          planId: this._currentPlan.getId(),
          nodeId: nodeId,
          action: node.action,
          reason: evaluation.reason,
          status: "failed"
        }
      });

      console.warn("[Planner] 步骤失败:", node.description, evaluation.reason);
    }

    return evaluation.completed;
  },

  handleStepFailure: async function(nodeId, failureReason, observation, context) {
    if (!this._currentPlan) return null;

    var failedNode = this._currentPlan.getNode(nodeId);

    var replanResult = await Replanner.replan(
      this._currentPlan,
      failedNode,
      failureReason,
      observation,
      context
    );

    if (replanResult.success) {
      this._currentPlan = replanResult.planGraph;

      RuntimeEvents.emit("plan_updated", {
        type: "plan_updated",
        timestamp: Date.now(),
        payload: {
          planId: this._currentPlan.getId(),
          reason: replanResult.reason,
          newNodeId: replanResult.newNodeId || null
        }
      });
    } else {
      if (failedNode) {
        this._currentPlan.failNode(nodeId, failureReason || "replan 失败");
      }

      RuntimeEvents.emit("plan_failed", {
        type: "plan_failed",
        timestamp: Date.now(),
        payload: {
          planId: this._currentPlan.getId(),
          nodeId: nodeId,
          reason: replanResult.reason
        }
      });
    }

    return replanResult;
  },

  isPlanComplete: function() {
    if (!this._currentPlan) return true;
    return this._currentPlan.isComplete();
  },

  isPlanFailed: function() {
    if (!this._currentPlan) return false;
    return this._currentPlan.isFailed();
  },

  hasPendingSteps: function() {
    if (!this._currentPlan) return false;
    return this._currentPlan.hasPendingNodes();
  },

  getCurrentPlan: function() {
    return this._currentPlan;
  },

  getProgress: function() {
    if (!this._currentPlan) return { total: 0, completed: 0, progress: 0 };
    return this._currentPlan.getProgress();
  },

  getCompletedResults: function() {
    if (!this._currentPlan) return [];
    return this._currentPlan.getCompletedResults();
  },

  buildFinalAnswer: function() {
    if (!this._currentPlan) return "任务完成";

    var results = this._currentPlan.getCompletedResults();
    var goal = this._currentPlan.getGoal();

    var answerParts = [];
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      if (!r.result) continue;
      var actionResult = r.result.actionResult;
      if (!actionResult || !actionResult.success) continue;
      var data = actionResult.data;
      if (!data) continue;

      if (data.contents && data.contents.length > 0) {
        for (var j = 0; j < data.contents.length; j++) {
          if (data.contents[j].text) {
            answerParts.push(data.contents[j].text.substring(0, 2000));
          }
        }
      } else if (data.values && data.values.length > 0) {
        for (var k = 0; k < data.values.length; k++) {
          answerParts.push(data.values[k]);
        }
      } else if (data.text !== undefined && data.text !== null) {
        answerParts.push(String(data.text).substring(0, 2000));
      } else if (data.value !== undefined && data.value !== null) {
        answerParts.push(String(data.value));
      } else if (data.url) {
        answerParts.push(data.url);
      } else if (typeof data === "string") {
        answerParts.push(data.substring(0, 2000));
      } else if (data.scrolledTo || data.scrolledToBottom) {
        // 滚动类操作不加入答案
      } else if (data.hovered || data.clicked) {
        // 交互类操作不加入答案
      } else if (data.key) {
        // 按键类操作不加入答案
      } else if (data.selector && data.found !== undefined) {
        // 查找类操作不加入答案
      }
    }

    if (answerParts.length > 0) {
      return answerParts.join("\n");
    }

    return "";
  },

  reset: function() {
    if (this._currentPlan) {
      this._currentPlan.clear();
    }
    this._currentPlan = null;
    this._planCache = {};
    Replanner.reset();
  },

  getStats: function() {
    return {
      hasPlan: !!this._currentPlan,
      planId: this._currentPlan ? this._currentPlan.getId() : null,
      progress: this.getProgress(),
      replanCount: Replanner.getReplanCount()
    };
  }
};
