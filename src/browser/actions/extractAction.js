var ExtractAction = {
  execute: async function(action, context) {
    var target = action.target || {};
    var selector = target.selector;

    if (!selector) {
      return {
        success: false,
        action: "extract",
        error: "缺少 target.selector",
        data: {},
        observation: {},
        durationMs: 0
      };
    }

    if (!context || !context.activeTab || !context.activeTab.id) {
      return {
        success: false,
        action: "extract",
        error: "缺少 activeTab",
        data: {},
        observation: {},
        durationMs: 0
      };
    }

    var startedAt = Date.now();

    console.log("[BrowserAction] extract →", selector);

    try {
      var response = await chrome.tabs.sendMessage(context.activeTab.id, {
        type: "browser_action",
        action: "extract",
        target: target
      });

      var result = response || {
        success: false,
        error: "Content Script 无响应"
      };

      return {
        success: result.success,
        action: "extract",
        error: result.error || null,
        data: result.data || {},
        observation: result.observation || {},
        durationMs: Date.now() - startedAt
      };
    } catch (err) {
      return {
        success: false,
        action: "extract",
        error: "提取执行失败: " + err.message,
        data: {},
        observation: {},
        durationMs: Date.now() - startedAt
      };
    }
  }
};
