var ExtractAttributeAction = {
  execute: async function(action, context) {
    var target = action.target || {};
    var params = action.params || {};
    var selector = target.selector;
    var attr = params.attr || "href";

    if (!selector) {
      return {
        success: false,
        action: "extract_attribute",
        error: "缺少 target.selector",
        data: {},
        observation: {},
        durationMs: 0
      };
    }

    if (!context || !context.activeTab || !context.activeTab.id) {
      return {
        success: false,
        action: "extract_attribute",
        error: "缺少 activeTab",
        data: {},
        observation: {},
        durationMs: 0
      };
    }

    var startedAt = Date.now();

    console.log("[BrowserAction] extract_attribute →", selector, "attr:", attr);

    try {
      var response = await chrome.tabs.sendMessage(context.activeTab.id, {
        type: "browser_action",
        action: "extract_attribute",
        target: target,
        params: { attr: attr }
      });

      var result = response || {
        success: false,
        error: "Content Script 无响应"
      };

      return {
        success: result.success,
        action: "extract_attribute",
        error: result.error || null,
        data: result.data || {},
        observation: result.observation || {},
        durationMs: Date.now() - startedAt
      };
    } catch (err) {
      return {
        success: false,
        action: "extract_attribute",
        error: "属性提取失败: " + err.message,
        data: {},
        observation: {},
        durationMs: Date.now() - startedAt
      };
    }
  }
};
