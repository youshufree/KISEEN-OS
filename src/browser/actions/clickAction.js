var ClickAction = {
  execute: async function(action, context) {
    var target = action.target || {};
    var selector = target.selector;
    var text = target.text;

    if (!selector && !text) {
      return {
        success: false,
        action: "click",
        error: "缺少 target: 需要提供 selector 或 text",
        data: {},
        observation: {},
        durationMs: 0
      };
    }

    if (!context || !context.activeTab || !context.activeTab.id) {
      return {
        success: false,
        action: "click",
        error: "缺少 activeTab",
        data: {},
        observation: {},
        durationMs: 0
      };
    }

    var startedAt = Date.now();

    console.log("[BrowserAction] click →", JSON.stringify(target));

    try {
      var response = await chrome.tabs.sendMessage(context.activeTab.id, {
        type: "browser_action",
        action: "click",
        target: target
      });

      var result = response || {
        success: false,
        error: "Content Script 无响应"
      };

      return {
        success: result.success,
        action: "click",
        error: result.error || null,
        data: result.data || {},
        observation: result.observation || {},
        durationMs: Date.now() - startedAt
      };
    } catch (err) {
      return {
        success: false,
        action: "click",
        error: "点击执行失败: " + err.message,
        data: {},
        observation: {},
        durationMs: Date.now() - startedAt
      };
    }
  }
};
