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
