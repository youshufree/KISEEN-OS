var OpenTabAction = {
  execute: async function(action, context) {
    var params = action.params || {};
    var target = action.target || {};
    var url = params.url || target.url || "";

    if (!url) {
      return {
        success: false,
        action: "open_tab",
        error: "缺少 url（请在 params.url 或 target.url 中提供）",
        data: {},
        observation: {},
        durationMs: 0
      };
    }

    url = url.replace(/^`|`$/g, "").trim();

    console.log("[BrowserAction] open_tab →", url);

    var result = await ActionExecutor.execute("open_tab", { url: url }, context);

    if (result.success && result.tabId) {
      var tab = await new Promise(function(r) { chrome.tabs.get(result.tabId, r); });
      if (tab) {
        context.activeTab = tab;
        context.pageContent = "";
        PopupState.activeTab = tab;
        TabRegistry.setAgentTab(tab.id);

        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["dist/content.bundle.js"]
          });
          await new Promise(function(r) { setTimeout(r, 600); });
        } catch (injectErr) {
          console.warn("[open_tab] Content Script 注入失败:", injectErr.message);
        }
      }
    }

    return result;
  }
};
