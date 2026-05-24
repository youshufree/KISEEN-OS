var Replanner = {

  MAX_REPLAN_ATTEMPTS: 3,
  _replanCount: 0,

  replan: async function(planGraph, failedNode, failureReason, observation, context) {
    if (this._replanCount >= this.MAX_REPLAN_ATTEMPTS) {
      console.warn("[Planner] 重规划次数已用尽:", this._replanCount);
      return {
        success: false,
        reason: "重规划次数已用尽",
        planGraph: planGraph
      };
    }

    this._replanCount++;

    console.log("[Planner] 重规划, 原因:", failureReason, "attempt:", this._replanCount);

    RuntimeEvents.emit("plan_replanned", {
      type: "plan_replanned",
      timestamp: Date.now(),
      payload: {
        planId: planGraph.getId(),
        failedNode: failedNode ? failedNode.id : null,
        reason: failureReason,
        attempt: this._replanCount
      }
    });

    var category = this._categorizeFailure(failureReason);

    var strategy = this._selectReplanStrategy(category);

    switch (strategy) {
      case "insert_recovery":
        return this._insertRecoveryStep(planGraph, failedNode, category, observation);
      case "replace_step":
        return this._replaceFailedStep(planGraph, failedNode, category, observation, context);
      case "partial_replan":
        return this._partialReplan(planGraph, failedNode, observation, context);
      case "rollback":
        return this._rollback(planGraph, failedNode);
      default:
        return { success: false, reason: "无可用的重规划策略", planGraph: planGraph };
    }
  },

  _categorizeFailure: function(reason) {
    if (!reason) return "unknown";
    var lower = reason.toLowerCase();

    if (lower.indexOf("元素不存在") !== -1 || lower.indexOf("未找到") !== -1 || lower.indexOf("selector") !== -1) {
      return "selector_changed";
    }
    if (lower.indexOf("页面变化") !== -1 || lower.indexOf("navigation") !== -1) {
      return "page_changed";
    }
    if (lower.indexOf("modal") !== -1 || lower.indexOf("弹窗") !== -1 || lower.indexOf("dialog") !== -1) {
      return "unexpected_modal";
    }
    if (lower.indexOf("超时") !== -1 || lower.indexOf("timeout") !== -1) {
      return "timeout";
    }
    if (lower.indexOf("循环") !== -1 || lower.indexOf("loop") !== -1) {
      return "infinite_loop_risk";
    }
    if (lower.indexOf("重复") !== -1 || lower.indexOf("duplicate") !== -1) {
      return "repeated_failure";
    }

    return "unknown";
  },

  _selectReplanStrategy: function(category) {
    var strategies = {
      selector_changed: "partial_replan",
      page_changed: "partial_replan",
      unexpected_modal: "insert_recovery",
      timeout: "partial_replan",
      infinite_loop_risk: "rollback",
      repeated_failure: "partial_replan",
      unknown: "replace_step"
    };

    return strategies[category] || "partial_replan";
  },

  _insertRecoveryStep: function(planGraph, failedNode, category, observation) {
    if (!failedNode) {
      return { success: false, reason: "无失败节点", planGraph: planGraph };
    }

    var recoveryStep = this._buildRecoveryStep(category, failedNode, observation);

    var newNode = planGraph.insertNodeAfter(failedNode.id, recoveryStep);

    if (newNode) {
      planGraph.skipNode(failedNode.id, "重规划: 插入恢复步骤替代");

      return {
        success: true,
        reason: "插入恢复步骤: " + recoveryStep.description,
        planGraph: planGraph,
        newNodeId: newNode.id
      };
    }

    return { success: false, reason: "插入恢复步骤失败", planGraph: planGraph };
  },

  _replaceFailedStep: function(planGraph, failedNode, category, observation, context) {
    if (!failedNode) {
      return { success: false, reason: "无失败节点", planGraph: planGraph };
    }

    var newStep = this._buildAlternativeStep(category, failedNode, observation);

    var replaced = planGraph.replaceNode(failedNode.id, newStep);

    if (replaced) {
      return {
        success: true,
        reason: "替换步骤: " + newStep.description,
        planGraph: planGraph,
        newNodeId: replaced.id
      };
    }

    return { success: false, reason: "替换步骤失败", planGraph: planGraph };
  },

  _partialReplan: async function(planGraph, failedNode, observation, context) {
    var remainingSteps = this._getRemainingSteps(planGraph, failedNode);

    if (remainingSteps.length === 0) {
      return { success: false, reason: "无剩余步骤可重规划", planGraph: planGraph };
    }

    if (failedNode) {
      planGraph.skipNode(failedNode.id, "重规划: 跳过失败步骤");
    }

    var newSteps = await this._generateRecoverySteps(
      planGraph.getGoal(),
      remainingSteps,
      observation,
      context
    );

    for (var i = 0; i < newSteps.length; i++) {
      planGraph.addNode(newSteps[i]);
    }

    return {
      success: true,
      reason: "局部重规划: 新增 " + newSteps.length + " 步",
      planGraph: planGraph
    };
  },

  _rollback: function(planGraph, failedNode) {
    if (!failedNode) {
      return { success: false, reason: "无失败节点", planGraph: planGraph };
    }

    var nodes = planGraph.getNodes();
    var rollbackCount = 0;

    for (var i = nodes.length - 1; i >= 0; i--) {
      if (nodes[i].status === NodeStatus.COMPLETED && rollbackCount < 2) {
        var node = planGraph.getNode(nodes[i].id);
        if (node) {
          node.status = NodeStatus.PENDING;
          node.result = null;
          node.startedAt = null;
          node.completedAt = null;
          rollbackCount++;
        }
      }
    }

    if (failedNode) {
      var fn = planGraph.getNode(failedNode.id);
      if (fn) {
        fn.status = NodeStatus.PENDING;
        fn.retries = 0;
        fn.result = null;
        fn.startedAt = null;
        fn.completedAt = null;
      }
    }

    return {
      success: true,
      reason: "回滚 " + rollbackCount + " 步",
      planGraph: planGraph
    };
  },

  _buildRecoveryStep: function(category, failedNode, observation) {
    switch (category) {
      case "selector_changed":
        return {
          type: "action",
          action: "wait_element",
          description: "等待页面元素加载",
          target: { selector: "body" },
          params: { timeout: 5000 },
          maxRetries: 1
        };

      case "unexpected_modal":
        return {
          type: "action",
          action: "extract",
          description: "提取弹窗内容",
          target: { selector: "[role=dialog], .modal, .popup" },
          params: null,
          maxRetries: 1
        };

      case "timeout":
        return {
          type: "action",
          action: "wait_element",
          description: "等待页面响应",
          target: failedNode.target || { selector: "body" },
          params: { timeout: 10000 },
          maxRetries: 1
        };

      default:
        return {
          type: "action",
          action: "extract",
          description: "重新观察页面",
          target: { selector: "body" },
          params: null,
          maxRetries: 1
        };
    }
  },

  _buildAlternativeStep: function(category, failedNode, observation) {
    var newStep = {
      type: "action",
      action: failedNode.action,
      description: failedNode.description + " (替代方案)",
      target: failedNode.target,
      params: failedNode.params,
      maxRetries: 2
    };

    if (category === "selector_changed" && failedNode.target && failedNode.target.selector) {
      delete newStep.target.selector;
      newStep.description = failedNode.description + " (使用 text 定位)";
    }

    return newStep;
  },

  _getRemainingSteps: function(planGraph, failedNode) {
    var nodes = planGraph.getNodes();
    var remaining = [];

    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].status === NodeStatus.PENDING || nodes[i].id === (failedNode && failedNode.id)) {
        remaining.push({
          action: nodes[i].action,
          description: nodes[i].description,
          target: nodes[i].target,
          params: nodes[i].params
        });
      }
    }

    return remaining;
  },

  _generateRecoverySteps: async function(goal, remainingSteps, observation, context) {
    var obsText = "无观察数据";
    if (observation) {
      obsText = observation.observationText || observation.summary || "无观察数据";
    }

    var remainingDesc = [];
    for (var i = 0; i < remainingSteps.length; i++) {
      remainingDesc.push((i + 1) + ". " + remainingSteps[i].description + " (" + remainingSteps[i].action + ")");
    }

    var availableActions = BrowserActionDispatcher.getRegisteredTypes();
    var actionList = availableActions.join(", ");

    var systemLines = [
      "你是一个任务重规划专家。页面发生了变化，需要重新规划剩余步骤。",
      "",
      "可用操作：" + actionList,
      "",
      "操作格式：",
      "  click: { action: \"click\", target: { selector: \"...\" } } 或 { action: \"click\", target: { text: \"按钮文字\" } }",
      "  input: { action: \"input\", target: { selector: \"...\" }, params: { value: \"内容\" } }",
      "  scroll: { action: \"scroll\", params: { direction: \"down\", amount: 500 } }",
      "  extract: { action: \"extract\", target: { selector: \"...\" } }",
      "  wait_element: { action: \"wait_element\", target: { selector: \"...\" }, params: { timeout: 10000 } }",
      "  hover: { action: \"hover\", target: { selector: \"...\" } }",
      "  press_key: { action: \"press_key\", params: { key: \"Enter\" }, target: { selector: \"...\" } }",
      "  navigate_url: { action: \"navigate_url\", params: { url: \"https://...\" } }（URL 在 params.url 中！）",
      "  open_tab: { action: \"open_tab\", params: { url: \"https://...\" } }（URL 在 params.url 中！）",
      "  scroll_to_element: { action: \"scroll_to_element\", target: { selector: \"...\" } }",
      "  scroll_to_bottom: { action: \"scroll_to_bottom\" }",
      "  select_option: { action: \"select_option\", target: { selector: \"select#id\" }, params: { value: \"val\" } }",
      "  extract_attribute: { action: \"extract_attribute\", target: { selector: \"a\" }, params: { attr: \"href\" } }",
      "",
      "重要：navigate_url 和 open_tab 的 URL 必须放在 params.url 中，不能放在 target 中！",
      "",
      "要求：",
      "1. 返回新的步骤数组",
      "2. 每步包含 action, description, target, params",
      "3. navigate_url/open_tab 的 url 必须放在 params.url",
      "4. 必须返回合法 JSON",
      "5. 不要输出 markdown 代码块",
      "6. 最多 5 步"
    ];

    var userLines = [
      "目标：" + goal,
      "",
      "当前页面：",
      obsText.substring(0, 2000),
      "",
      "原剩余步骤：",
      remainingDesc.join("\n"),
      "",
      "请生成新的步骤："
    ];

    try {
      var apiKey = context && context.apiKey ? context.apiKey : null;
      var providerType = context && context.providerType ? context.providerType : "deepseek";
      if (!apiKey && providerType !== "openclaw") {
        return this._fallbackRecoverySteps(remainingSteps);
      }

      var llmOptions = {
        messages: [
          { role: "system", content: systemLines.join("\n") },
          { role: "user", content: userLines.join("\n") }
        ],
        timeout: 20000
      };
      if (apiKey) {
        llmOptions.apiKey = apiKey;
      }

      var result = await LLMProvider.call(llmOptions);

      var sanitized = sanitizeLLMOutput(result.content);
      var parsed;
      try {
        parsed = JSON.parse(sanitized);
      } catch (parseErr) {
        // 二次尝试：提取 JSON 数组
        var arrMatch = sanitized.match(/\[\s*\{[\s\S]*\}\s*\]/);
        if (arrMatch) {
          try { parsed = JSON.parse(arrMatch[0]); } catch (e2) {}
        }
        if (!parsed) throw parseErr;
      }

      var steps = parsed.steps || parsed;
      if (Array.isArray(steps) && steps.length > 0) {
        return steps.map(function(s) {
          return {
            type: "action",
            action: s.action || s.type,
            description: s.description || "",
            target: s.target || null,
            params: s.params || null,
            maxRetries: 2
          };
        });
      }
    } catch (e) {
      console.warn("[Planner] 生成恢复步骤失败:", e.message);
    }

    return this._fallbackRecoverySteps(remainingSteps);
  },

  _fallbackRecoverySteps: function(remainingSteps) {
    var steps = [
      {
        type: "action",
        action: "scroll",
        description: "向下滚动页面寻找内容",
        target: {},
        params: { direction: "down", amount: 600 },
        maxRetries: 1
      },
      {
        type: "action",
        action: "wait_element",
        description: "等待页面内容加载",
        target: { selector: "body" },
        params: { timeout: 3000 },
        maxRetries: 1
      }
    ];

    if (remainingSteps && remainingSteps.length > 0) {
      var firstRemaining = remainingSteps[0];
      if (firstRemaining.action === "click" && firstRemaining.description) {
        steps.push({
          type: "action",
          action: "extract",
          description: "提取页面内容以辅助定位: " + firstRemaining.description,
          target: { selector: "body" },
          params: null,
          maxRetries: 1
        });
      } else {
        steps.push({
          type: "action",
          action: "extract",
          description: "重新提取页面内容",
          target: { selector: "body" },
          params: null,
          maxRetries: 1
        });
      }
    } else {
      steps.push({
        type: "action",
        action: "extract",
        description: "重新提取页面内容",
        target: { selector: "body" },
        params: null,
        maxRetries: 1
      });
    }

    return steps;
  },

  reset: function() {
    this._replanCount = 0;
  },

  getReplanCount: function() {
    return this._replanCount;
  }
};
