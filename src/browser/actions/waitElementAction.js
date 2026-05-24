var WaitElementAction = {
  execute: async function(action, context) {
    var target = action.target || {};
    var params = action.params || {};
    var selector = target.selector;
    var timeout = params.timeout || 10000;

    if (!selector) {
      return {
        success: false,
        action: "wait_element",
        error: "缺少 target.selector",
        data: {},
        observation: {},
        durationMs: 0
      };
    }

    if (!context || !context.activeTab || !context.activeTab.id) {
      return {
        success: false,
        action: "wait_element",
        error: "缺少 activeTab",
        data: {},
        observation: {},
        durationMs: 0
      };
    }

    var startedAt = Date.now();

    console.log("[BrowserAction] wait_element →", selector, "timeout:", timeout + "ms");

    try {
      var response = await chrome.tabs.sendMessage(context.activeTab.id, {
        type: "browser_action",
        action: "wait_element",
        target: target,
        params: { timeout: timeout }
      });

      var result = response || {
        success: false,
        error: "Content Script 无响应"
      };

      return {
        success: result.success,
        action: "wait_element",
        error: result.error || null,
        data: result.data || {},
        observation: result.observation || {},
        durationMs: Date.now() - startedAt
      };
    } catch (err) {
      return {
        success: false,
        action: "wait_element",
        error: "等待元素失败: " + err.message,
        data: {},
        observation: {},
        durationMs: Date.now() - startedAt
      };
    }
  }
};
