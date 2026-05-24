var STRATEGIES = {};

STRATEGIES.reconnect_content_script = {
  name: "reconnect_content_script",
  priority: 0,
  canHandle: function(errorCategory) {
    return errorCategory === "connection_lost";
  },
  execute: async function(context) {
    console.log("[Recovery] 策略: reconnect_content_script");

    if (!context.executionContext || !context.executionContext.activeTab || !context.executionContext.activeTab.id) {
      return { recovered: false, strategy: "reconnect_content_script", reason: "缺少 activeTab" };
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId: context.executionContext.activeTab.id },
        files: ["dist/content.bundle.js"]
      });

      await new Promise(function(r) { setTimeout(r, 300); });

      var recoveryAction = Object.assign({}, context.failedAction, { _recoveryRetry: true });
      var result = await BrowserActionDispatcher.execute(recoveryAction, context.executionContext);
      return {
        recovered: result.success,
        strategy: "reconnect_content_script",
        nextAction: null,
        reason: result.success ? "Content Script 重连后重试成功" : "Content Script 重连后重试仍失败"
      };
    } catch (e) {
      return { recovered: false, strategy: "reconnect_content_script", reason: "注入失败: " + e.message };
    }
  }
};

STRATEGIES.retry_action = {
  name: "retry_action",
  priority: 1,
  canHandle: function(errorCategory) {
    return errorCategory === "timeout" || errorCategory === "stale_element";
  },
  execute: async function(context) {
    if (!ActionRetry.canRetry(context.failedAction)) {
      return { recovered: false, strategy: "retry_action", reason: "重试次数已用尽" };
    }

    console.log("[Recovery] 策略: retry_action");

    var retryAction = context.failedAction;
    if (context.failedAction.type === "wait_element" && context.failedAction.params) {
      var originalTimeout = context.failedAction.params.timeout || 10000;
      var reducedTimeout = Math.min(originalTimeout, 3000);
      retryAction = Object.assign({}, context.failedAction, {
        params: Object.assign({}, context.failedAction.params, { timeout: reducedTimeout })
      });
    }

    var result = await ActionRetry.execute(
      retryAction,
      context.executionContext,
      BrowserActionDispatcher.execute.bind(BrowserActionDispatcher)
    );

    return {
      recovered: result.success,
      strategy: "retry_action",
      nextAction: result.success ? null : context.failedAction,
      reason: result.success ? "重试成功" : ("重试失败: " + (result.error || ""))
    };
  }
};

STRATEGIES.re_observe = {
  name: "re_observe",
  priority: 2,
  canHandle: function(errorCategory) {
    return errorCategory === "page_changed" || errorCategory === "stale_element";
  },
  execute: async function(context) {
    console.log("[Recovery] 策略: re_observe");

    if (!context.executionContext || !context.executionContext.activeTab) {
      return { recovered: false, strategy: "re_observe", reason: "缺少 activeTab" };
    }

    try {
      var snapshot = await ObservationFetcher.fetch(context.executionContext);
      if (snapshot) {
        var observation = ObservationBuilder.build(snapshot, context.executionContext);
        LoopMemory.addRecentObservation(observation);
        return {
          recovered: true,
          strategy: "re_observe",
          nextAction: null,
          reason: "重新观察页面成功",
          newObservation: observation
        };
      }
    } catch (e) {
      console.warn("[Recovery] re_observe 失败:", e.message);
    }

    return { recovered: false, strategy: "re_observe", reason: "重新观察页面失败" };
  }
};

STRATEGIES.re_locate_element = {
  name: "re_locate_element",
  priority: 3,
  canHandle: function(errorCategory) {
    return errorCategory === "selector_not_found" || errorCategory === "timeout";
  },
  execute: async function(context) {
    console.log("[Recovery] 策略: re_locate_element");

    var failedSelector = context.failedAction.target && context.failedAction.target.selector;
    if (!failedSelector) {
      return { recovered: false, strategy: "re_locate_element", reason: "无 selector 可恢复" };
    }

    var retryWithCooldown = async function(action, execContext) {
      var safetyConfig = ActionRegistry.getSafetyConfig(action.type);
      var cooldown = safetyConfig && safetyConfig.cooldownMs ? safetyConfig.cooldownMs : 300;
      await new Promise(function(resolve) { setTimeout(resolve, cooldown + 50); });
      return BrowserActionDispatcher.execute(action, execContext);
    };

    var cachedSelector = SelectorRecovery.getCachedSelector(failedSelector);
    if (cachedSelector) {
      var retryAction = Object.assign({}, context.failedAction);
      retryAction.target = Object.assign({}, retryAction.target, { selector: cachedSelector });

      var result = await retryWithCooldown(retryAction, context.executionContext);
      if (result.success) {
        return {
          recovered: true,
          strategy: "re_locate_element",
          nextAction: retryAction,
          reason: "使用缓存 selector 恢复成功: " + cachedSelector
        };
      }
    }

    var recoveryResult = await SelectorRecovery.recover(
      failedSelector,
      context.failedAction.target,
      context.executionContext
    );

    if (recoveryResult.recovered) {
      var retryAction2 = Object.assign({}, context.failedAction);
      retryAction2.target = Object.assign({}, retryAction2.target, { selector: recoveryResult.selector });

      var result2 = await retryWithCooldown(retryAction2, context.executionContext);
      return {
        recovered: result2.success,
        strategy: "re_locate_element",
        nextAction: result2.success ? null : retryAction2,
        reason: result2.success
          ? "selector 恢复成功 (" + recoveryResult.method + "): " + recoveryResult.selector
          : "selector 恢复后执行仍失败"
      };
    }

    return { recovered: false, strategy: "re_locate_element", reason: "无法恢复 selector" };
  }
};

STRATEGIES.fallback_selector = {
  name: "fallback_selector",
  priority: 4,
  canHandle: function(errorCategory) {
    return errorCategory === "selector_not_found";
  },
  execute: async function(context) {
    console.log("[Recovery] 策略: fallback_selector");

    var target = context.failedAction.target || {};
    var text = target.text;

    if (!text) {
      return { recovered: false, strategy: "fallback_selector", reason: "无 text 可做 fallback" };
    }

    var fallbackAction = Object.assign({}, context.failedAction);
    fallbackAction.target = { text: text };

    var result = await BrowserActionDispatcher.execute(fallbackAction, context.executionContext);
    return {
      recovered: result.success,
      strategy: "fallback_selector",
      nextAction: result.success ? null : fallbackAction,
      reason: result.success
        ? "使用 text fallback 成功: " + text
        : "text fallback 也失败"
    };
  }
};

STRATEGIES.scroll_and_retry = {
  name: "scroll_and_retry",
  priority: 5,
  canHandle: function(errorCategory) {
    return errorCategory === "selector_not_found" || errorCategory === "stale_element";
  },
  execute: async function(context) {
    console.log("[Recovery] 策略: scroll_and_retry");

    var scrollAction = {
      type: "scroll",
      target: {},
      params: { direction: "down", amount: 500 },
      _recoveryRetry: true
    };

    await BrowserActionDispatcher.execute(scrollAction, context.executionContext);

    await new Promise(function(resolve) { setTimeout(resolve, 1000); });

    var recoveryAction = Object.assign({}, context.failedAction, { _recoveryRetry: true });
    var result = await BrowserActionDispatcher.execute(recoveryAction, context.executionContext);
    return {
      recovered: result.success,
      strategy: "scroll_and_retry",
      nextAction: null,
      reason: result.success ? "滚动后重试成功" : "滚动后重试仍失败"
    };
  }
};

STRATEGIES.wait_and_retry = {
  name: "wait_and_retry",
  priority: 6,
  canHandle: function(errorCategory) {
    return errorCategory === "timeout" || errorCategory === "selector_not_found";
  },
  execute: async function(context) {
    console.log("[Recovery] 策略: wait_and_retry");

    var isAlreadyWait = context.failedAction.type === "wait_element";

    var selector = context.failedAction.target && context.failedAction.target.selector;
    if (selector && !isAlreadyWait) {
      var waitAction = {
        type: "wait_element",
        target: { selector: selector },
        params: { timeout: 5000 },
        _recoveryRetry: true
      };

      var waitResult = await BrowserActionDispatcher.execute(waitAction, context.executionContext);
      if (waitResult.success) {
        var retryResult = await BrowserActionDispatcher.execute(
          Object.assign({}, context.failedAction, { _recoveryRetry: true }),
          context.executionContext
        );
        return {
          recovered: retryResult.success,
          strategy: "wait_and_retry",
          nextAction: null,
          reason: retryResult.success ? "等待元素后重试成功" : "等待元素后重试仍失败"
        };
      }
    }

    await new Promise(function(resolve) { setTimeout(resolve, isAlreadyWait ? 500 : 2000); });

    var retryAction = Object.assign({}, context.failedAction, { _recoveryRetry: true });
    if (isAlreadyWait && context.failedAction.params) {
      retryAction.params = Object.assign({}, context.failedAction.params, { timeout: 3000 });
    }

    var result = await BrowserActionDispatcher.execute(retryAction, context.executionContext);
    return {
      recovered: result.success,
      strategy: "wait_and_retry",
      nextAction: null,
      reason: result.success ? "延迟后重试成功" : "延迟后重试仍失败"
    };
  }
};

STRATEGIES.replan = {
  name: "replan",
  priority: 7,
  canHandle: function(errorCategory) {
    return true;
  },
  execute: async function(context) {
    console.log("[Recovery] 策略: replan");

    return {
      recovered: false,
      strategy: "replan",
      nextAction: null,
      reason: "请求 Planner 重新规划",
      needsReplan: true
    };
  }
};

STRATEGIES.skip_action = {
  name: "skip_action",
  priority: 8,
  canHandle: function(errorCategory) {
    return errorCategory !== "blocked_action";
  },
  execute: async function(context) {
    console.log("[Recovery] 策略: skip_action");

    return {
      recovered: true,
      strategy: "skip_action",
      nextAction: null,
      reason: "跳过当前失败 Action，继续循环"
    };
  }
};

STRATEGIES.emergency_stop = {
  name: "emergency_stop",
  priority: 9,
  canHandle: function(errorCategory) {
    return errorCategory === "blocked_action";
  },
  execute: async function(context) {
    console.warn("[Recovery] 策略: emergency_stop");

    return {
      recovered: false,
      strategy: "emergency_stop",
      nextAction: null,
      reason: "紧急停止: 操作被安全策略阻止",
      needsStop: true
    };
  }
};

var RecoveryStrategies = {

  _registry: STRATEGIES,

  getSortedStrategies: function(errorCategory) {
    var matching = [];
    for (var key in this._registry) {
      if (this._registry.hasOwnProperty(key)) {
        var strategy = this._registry[key];
        if (strategy.canHandle(errorCategory)) {
          matching.push(strategy);
        }
      }
    }
    matching.sort(function(a, b) { return a.priority - b.priority; });
    return matching;
  },

  get: function(name) {
    return this._registry[name] || null;
  },

  register: function(name, strategy) {
    this._registry[name] = strategy;
    console.log("[Recovery] 注册策略:", name);
  },

  getAllNames: function() {
    return Object.keys(this._registry);
  }
};
