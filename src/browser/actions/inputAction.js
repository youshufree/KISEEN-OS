var InputAction = {
  execute: async function(action, context) {
    var target = action.target || {};
    var params = action.params || {};
    var selector = target.selector;
    var value = params.value;

    if (!selector) {
      return {
        success: false,
        action: "input",
        error: "缺少 target.selector",
        data: {},
        observation: {},
        durationMs: 0
      };
    }

    if (value === undefined || value === null) {
      return {
        success: false,
        action: "input",
        error: "缺少 params.value",
        data: {},
        observation: {},
        durationMs: 0
      };
    }

    if (!context || !context.activeTab || !context.activeTab.id) {
      return {
        success: false,
        action: "input",
        error: "缺少 activeTab",
        data: {},
        observation: {},
        durationMs: 0
      };
    }

    var startedAt = Date.now();

    console.log("[BrowserAction] input →", selector, "value:", value);

    try {
      var response = await chrome.tabs.sendMessage(context.activeTab.id, {
        type: "browser_action",
        action: "input",
        target: target,
        params: params
      });

      var result = response || {
        success: false,
        error: "Content Script 无响应"
      };

      return {
        success: result.success,
        action: "input",
        error: result.error || null,
        data: result.data || {},
        observation: result.observation || {},
        durationMs: Date.now() - startedAt
      };
    } catch (err) {
      return {
        success: false,
        action: "input",
        error: "输入执行失败: " + err.message,
        data: {},
        observation: {},
        durationMs: Date.now() - startedAt
      };
    }
  }
};
