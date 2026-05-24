var ACTIONS = {
  click: ClickAction,
  input: InputAction,
  scroll: ScrollAction,
  extract: ExtractAction,
  wait_element: WaitElementAction,
  hover: HoverAction,
  press_key: PressKeyAction,
  scroll_to_element: ScrollToElementAction,
  scroll_to_bottom: ScrollToBottomAction,
  select_option: SelectOptionAction,
  extract_attribute: ExtractAttributeAction,
  navigate_url: NavigateUrlAction,
  open_tab: OpenTabAction,
  switch_tab: SwitchTabAction
};

var BrowserActionDispatcher = {

  _registry: ACTIONS,

  register: function(type, actionModule) {
    this._registry[type] = actionModule;
    console.log("[BrowserAction] 注册 Action:", type);
  },

  execute: async function(action, context) {
    var startedAt = Date.now();
    var actionType = action && action.type;

    if (!actionType) {
      var result = {
        success: false,
        action: "unknown",
        error: "Action 缺少 type 字段",
        data: {},
        observation: {},
        durationMs: Date.now() - startedAt,
        recoverable: false,
        errorCategory: "unknown"
      };
      RuntimeEvents.emit("browser_action_failed", {
        action: "unknown",
        error: "Action 缺少 type 字段"
      });
      return result;
    }

    var handler = this._registry[actionType];

    if (!handler) {
      var result = {
        success: false,
        action: actionType,
        error: "未知 Action 类型: " + actionType,
        data: {},
        observation: {},
        durationMs: Date.now() - startedAt,
        recoverable: false,
        errorCategory: "unknown"
      };
      console.warn("[BrowserAction] 未知 Action:", actionType);
      RuntimeEvents.emit("browser_action_failed", {
        action: actionType,
        error: "未知 Action 类型: " + actionType
      });
      return result;
    }

    var safetyParams = {};
    if (action.target && action.target.selector) {
      safetyParams.selector = action.target.selector;
    }
    var bypassCooldown = action._recoveryRetry === true;
    var safetyCheck = BrowserActionRuntime.canExecute(actionType, safetyParams, bypassCooldown);
    console.log("[BrowserAction] canExecute:", actionType, "allowed:", safetyCheck.allowed, "reason:", safetyCheck.reason, "actionCount:", BrowserActionRuntime.getActionCount());
    if (!safetyCheck.allowed) {
      var result = {
        success: false,
        action: actionType,
        error: "安全策略阻止: " + safetyCheck.reason,
        data: {},
        observation: {},
        durationMs: Date.now() - startedAt,
        recoverable: false,
        errorCategory: "blocked_action"
      };
      console.warn("[BrowserAction] 安全阻止:", safetyCheck.reason);
      BrowserActionRuntime.actionBlocked(actionType, safetyCheck.reason);
      return result;
    }

    BrowserActionRuntime.beforeAction(actionType, safetyParams);

    console.log("[BrowserAction] 执行:", actionType, JSON.stringify(action.target || {}));

    try {
      var result = await handler.execute(action, context);

      if (result.success) {
        BrowserActionRuntime.afterAction(actionType, result);
        BrowserActionDispatcher._recordMemory(action, context, result);
      } else {
        BrowserActionRuntime.actionFailed(actionType, result.error);
        result.recoverable = BrowserActionDispatcher._isRecoverable(result.error);
        result.errorCategory = classifyRuntimeError(result.error);
        BrowserActionDispatcher._recordMemory(action, context, result);
      }

      result.durationMs = Date.now() - startedAt;
      return result;
    } catch (err) {
      var result = {
        success: false,
        action: actionType,
        error: "执行异常: " + err.message,
        data: {},
        observation: {},
        durationMs: Date.now() - startedAt,
        recoverable: true,
        errorCategory: "stale_element"
      };

      BrowserActionRuntime.actionFailed(actionType, err.message);
      console.error("[BrowserAction] 执行异常:", actionType, err);
      return result;
    }
  },

  getRegisteredTypes: function() {
    return Object.keys(this._registry);
  },

  has: function(type) {
    return type in this._registry;
  },

  _recordMemory: function(action, context, result) {
    var selector = action.target && action.target.selector;
    var text = action.target && action.target.text;
    if (!selector && !text) return;
    if (!context || !context.activeTab || !context.activeTab.url) return;

    var domain = null;
    try {
      domain = new URL(context.activeTab.url).hostname.replace(/^www\./, "");
    } catch (e) {
      return;
    }
    if (!domain) return;

    var pageType = context.browserMemory ? context.browserMemory.pageType : "other";

    var semanticKey;
    switch (action.type) {
      case "click":
        semanticKey = text ? "clickByText_" + text.substring(0, 30) : "clickTarget";
        break;
      case "input":
        semanticKey = "formInput";
        break;
      case "extract":
        semanticKey = "contentArea";
        break;
      default:
        semanticKey = action.type + "Target";
    }

    if (result.success) {
      var sel = selector || ("text:" + text);
      BrowserMemory.recordSelectorSuccess(domain, pageType, semanticKey, sel);
    } else if (selector) {
      BrowserMemory.recordSelectorFailure(domain, selector, action.type, result.error || "未知错误");
    }
  },

  _isRecoverable: function(error) {
    if (!error) return false;
    var lower = error.toLowerCase();
    if (lower.indexOf("安全策略阻止") !== -1) return false;
    if (lower.indexOf("危险") !== -1) return false;
    if (lower.indexOf("未知 action") !== -1) return false;
    return true;
  }
};
