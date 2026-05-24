var PressKeyAction = {
  execute: async function(action, context) {
    var params = action.params || {};
    var key = params.key;
    var selector = action.target && action.target.selector;

    if (!key) {
      return {
        success: false,
        action: "press_key",
        error: "缺少 params.key（如 Enter、Tab、Escape、ArrowDown）",
        data: {},
        observation: {},
        durationMs: 0
      };
    }

    if (!context || !context.activeTab || !context.activeTab.id) {
      return {
        success: false,
        action: "press_key",
        error: "缺少 activeTab",
        data: {},
        observation: {},
        durationMs: 0
      };
    }

    var startedAt = Date.now();

    console.log("[BrowserAction] press_key →", key, selector || "");

    try {
      var response = await chrome.tabs.sendMessage(context.activeTab.id, {
        type: "browser_action",
        action: "press_key",
        target: { selector: selector },
        params: { key: key }
      });

      var result = response || {
        success: false,
        error: "Content Script 无响应"
      };

      return {
        success: result.success,
        action: "press_key",
        error: result.error || null,
        data: result.data || { key: key },
        observation: result.observation || {},
        durationMs: Date.now() - startedAt
      };
    } catch (err) {
      return {
        success: false,
        action: "press_key",
        error: "按键执行失败: " + err.message,
        data: {},
        observation: {},
        durationMs: Date.now() - startedAt
      };
    }
  }
};
