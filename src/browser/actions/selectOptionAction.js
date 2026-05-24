var SelectOptionAction = {
  execute: async function(action, context) {
    var target = action.target || {};
    var params = action.params || {};
    var selector = target.selector;
    var value = params.value;
    var label = params.label;

    if (!selector) {
      return {
        success: false,
        action: "select_option",
        error: "缺少 target.selector",
        data: {},
        observation: {},
        durationMs: 0
      };
    }

    if (!value && !label) {
      return {
        success: false,
        action: "select_option",
        error: "缺少 params.value 或 params.label",
        data: {},
        observation: {},
        durationMs: 0
      };
    }

    if (!context || !context.activeTab || !context.activeTab.id) {
      return {
        success: false,
        action: "select_option",
        error: "缺少 activeTab",
        data: {},
        observation: {},
        durationMs: 0
      };
    }

    var startedAt = Date.now();

    console.log("[BrowserAction] select_option →", selector, value || label);

    try {
      var response = await chrome.tabs.sendMessage(context.activeTab.id, {
        type: "browser_action",
        action: "select_option",
        target: target,
        params: { value: value, label: label }
      });

      var result = response || {
        success: false,
        error: "Content Script 无响应"
      };

      return {
        success: result.success,
        action: "select_option",
        error: result.error || null,
        data: result.data || {},
        observation: result.observation || {},
        durationMs: Date.now() - startedAt
      };
    } catch (err) {
      return {
        success: false,
        action: "select_option",
        error: "下拉选择失败: " + err.message,
        data: {},
        observation: {},
        durationMs: Date.now() - startedAt
      };
    }
  }
};
