var SwitchTabAction = {
  execute: async function(action, context) {
    var params = action.params || {};
    var tabId = params.tabId;

    if (!tabId) {
      return {
        success: false,
        action: "switch_tab",
        error: "缺少 params.tabId",
        data: {},
        observation: {},
        durationMs: 0
      };
    }

    console.log("[BrowserAction] switch_tab →", tabId);

    var result = await ActionExecutor.execute("switch_tab", { tabId: tabId }, context);

    if (result.success) {
      var tab = await new Promise(function(r) { chrome.tabs.get(tabId, r); });
      if (tab) {
        context.activeTab = tab;
        context.pageContent = "";
        PopupState.activeTab = tab;
      }
    }

    return result;
  }
};
