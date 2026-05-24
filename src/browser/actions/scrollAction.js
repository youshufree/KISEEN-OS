var ScrollAction = {
  execute: async function(action, context) {
    var params = action.params || {};
    var direction = params.direction || "down";
    var amount = params.amount || 500;

    if (!context || !context.activeTab || !context.activeTab.id) {
      return {
        success: false,
        action: "scroll",
        error: "缺少 activeTab",
        data: {},
        observation: {},
        durationMs: 0
      };
    }

    var startedAt = Date.now();

    console.log("[BrowserAction] scroll →", direction, amount + "px");

    try {
      var response = await chrome.tabs.sendMessage(context.activeTab.id, {
        type: "browser_action",
        action: "scroll",
        params: { direction: direction, amount: amount }
      });

      var result = response || {
        success: false,
        error: "Content Script 无响应"
      };

      return {
        success: result.success,
        action: "scroll",
        error: result.error || null,
        data: result.data || { direction: direction, amount: amount },
        observation: result.observation || {},
        durationMs: Date.now() - startedAt
      };
    } catch (err) {
      return {
        success: false,
        action: "scroll",
        error: "滚动执行失败: " + err.message,
        data: {},
        observation: {},
        durationMs: Date.now() - startedAt
      };
    }
  }
};
