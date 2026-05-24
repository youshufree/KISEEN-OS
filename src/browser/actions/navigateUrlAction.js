var NavigateUrlAction = {
  execute: async function(action, context) {
    var params = action.params || {};
    var target = action.target || {};
    var url = params.url || target.url || "";

    if (!url) {
      return {
        success: false,
        action: "navigate_url",
        error: "缺少 url（请在 params.url 或 target.url 中提供）",
        data: {},
        observation: {},
        durationMs: 0
      };
    }

    url = url.replace(/^`|`$/g, "").trim();

    // URL 规范化兜底：补全缺失的协议和域名前缀
    if (url.indexOf("://") === -1) {
      if (url.indexOf(".") === -1) {
        url = "https://www." + url + ".com";
      } else {
        url = "https://" + url;
      }
      console.log("[navigateUrl] URL 已规范化:", params.url || target.url, "→", url);
    }

    if (!context || !context.activeTab || !context.activeTab.id) {
      return {
        success: false,
        action: "navigate_url",
        error: "缺少 activeTab",
        data: {},
        observation: {},
        durationMs: 0
      };
    }

    console.log("[BrowserAction] navigate_url →", url);

    var result = await ActionExecutor.execute("navigate_url", { url: url }, context);

    if (result.success) {
      var tab = await new Promise(function(r) { chrome.tabs.get(context.activeTab.id, r); });
      if (tab) {
        context.activeTab = tab;
        context.pageContent = "";
        PopupState.activeTab = tab;

        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["dist/content.bundle.js"]
          });
          await new Promise(function(r) { setTimeout(r, 600); });
        } catch (injectErr) {
          console.warn("[navigate_url] Content Script 注入失败:", injectErr.message);
        }
      }
    }

    return result;
  }
};
