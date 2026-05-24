/**
 * ActionExecutor - Browser Action 执行器
 *
 * 职责：
 *   1. 执行 Browser Action（通过 chrome.tabs.sendMessage 发到 Content Script）
 *   2. 执行前调用 ElementLocator 做安全检查（Content Script 端）
 *   3. 执行后检测页面变化
 *   4. 返回标准化 Result Schema
 *
 * 执行流：
 *   Action → ElementLocator (Content Script) → Safety Check → Execute → Result
 *
 * 运行环境：SidePanel / Popup
 */

var ActionExecutor = {

  /**
   * execute(actionName, params, context)
   *
   * actionName: "click_element" / "input_text" / "scroll_page" / "navigate_url"
   * params: { selector, text, direction, amount, url }
   * context: { activeTab }
   *
   * 返回：
   *   {
   *     success: boolean,
   *     action: string,
   *     selector: string | null,
   *     durationMs: number,
   *     error: string | null,
   *     pageChanged: boolean
   *   }
   */
  execute: async function(actionName, params, context) {
    var startedAt = Date.now();
    var self = this;

    if (!ActionRegistry.has(actionName)) {
      return {
        success: false,
        action: actionName,
        selector: params.selector || null,
        durationMs: Date.now() - startedAt,
        error: "未知 Action: " + actionName,
        pageChanged: false
      };
    }

    if (actionName === "open_tab") {
      return await self._executeOpenTab(params, startedAt);
    }

    if (actionName === "switch_tab") {
      return await self._executeSwitchTab(params, startedAt);
    }

    if (actionName === "close_tab") {
      return await self._executeCloseTab(params, startedAt);
    }

    if (!context || !context.activeTab || !context.activeTab.id) {
      return {
        success: false,
        action: actionName,
        selector: params.selector || null,
        durationMs: Date.now() - startedAt,
        error: "缺少 activeTab",
        pageChanged: false
      };
    }

    var beforeState = await self._capturePageState(context.activeTab.id);

    if (actionName === "navigate_url") {
      return await self._executeNavigate(params, context, startedAt, beforeState);
    }

    var response = await chrome.tabs.sendMessage(context.activeTab.id, {
      type: "execute_browser_action",
      action: actionName,
      data: params
    });

    var result = response || {
      success: false,
      action: actionName,
      selector: params.selector || null,
      durationMs: Date.now() - startedAt,
      error: "Content Script 无响应",
      pageChanged: false
    };

    if (result.success) {
      await self._waitForPageUpdate(context.activeTab.id, 500);
      var afterState = await self._capturePageState(context.activeTab.id);
      result.pageChanged = self._detectPageChange(beforeState, afterState);
    } else {
      result.pageChanged = false;
    }

    result.durationMs = Date.now() - startedAt;
    return result;
  },

  _executeNavigate: async function(params, context, startedAt, beforeState) {
    var url = params.url;
    if (!url) {
      return {
        success: false,
        action: "navigate_url",
        selector: null,
        durationMs: Date.now() - startedAt,
        error: "缺少 url 参数",
        pageChanged: false
      };
    }

    // URL 规范化：补全缺失的协议和域名前缀
    url = url.replace(/^`|`$/g, "").trim();
    if (url.indexOf("://") === -1) {
      // 不包含协议，补全 https://
      if (url.indexOf(".") === -1) {
        // 纯单词如 "reddit" → "https://www.reddit.com"
        url = "https://www." + url + ".com";
      } else {
        url = "https://" + url;
      }
      console.log("[ActionExecutor] URL 已规范化:", params.url, "→", url);
    }

    var blocked = BrowserActionRuntime.checkDangerousUrl(url);
    if (blocked) {
      return {
        success: false,
        action: "navigate_url",
        selector: null,
        durationMs: Date.now() - startedAt,
        error: "URL 被安全策略阻止: " + blocked,
        pageChanged: false
      };
    }

    try {
      await chrome.tabs.update(context.activeTab.id, { url: url });
      await self._waitForPageUpdate(context.activeTab.id, 2000);

      return {
        success: true,
        action: "navigate_url",
        selector: null,
        durationMs: Date.now() - startedAt,
        error: null,
        pageChanged: true
      };
    } catch (err) {
      return {
        success: false,
        action: "navigate_url",
        selector: null,
        durationMs: Date.now() - startedAt,
        error: "导航失败: " + err.message,
        pageChanged: false
      };
    }
  },

  _capturePageState: async function(tabId) {
    try {
      var response = await chrome.tabs.sendMessage(tabId, {
        action: "getPageState"
      });
      return response || {};
    } catch (e) {
      return {};
    }
  },

  _waitForPageUpdate: async function(tabId, maxWaitMs) {
    var waited = 0;
    var interval = 100;
    while (waited < maxWaitMs) {
      await new Promise(function(resolve) { setTimeout(resolve, interval); });
      waited += interval;
    }
  },

  _detectPageChange: function(before, after) {
    if (!before || !after) return false;
    if (before.url !== after.url) return true;
    if (before.title !== after.title) return true;
    if (before.domLength !== after.domLength) return true;
    return false;
  },

  _executeOpenTab: async function(params, startedAt) {
    var url = params.url;
    if (!url) {
      return {
        success: false,
        action: "open_tab",
        selector: null,
        durationMs: Date.now() - startedAt,
        error: "缺少 url 参数",
        pageChanged: false
      };
    }

    var blocked = BrowserActionRuntime.checkBlockedProtocol(url);
    if (blocked) {
      return {
        success: false,
        action: "open_tab",
        selector: null,
        durationMs: Date.now() - startedAt,
        error: "URL 被安全策略阻止: " + blocked,
        pageChanged: false
      };
    }

    try {
      var tab = await TabRegistry.openTab(url);
      await TabRegistry.waitForTabLoad(tab.id, 10000);
      TabRegistry.setAgentTab(tab.id);

      var updatedTab = TabRegistry.getAgentTab();

      return {
        success: true,
        action: "open_tab",
        selector: null,
        durationMs: Date.now() - startedAt,
        error: null,
        pageChanged: true,
        tabId: tab.id,
        url: updatedTab ? updatedTab.url : url
      };
    } catch (err) {
      return {
        success: false,
        action: "open_tab",
        selector: null,
        durationMs: Date.now() - startedAt,
        error: "打开 Tab 失败: " + err.message,
        pageChanged: false
      };
    }
  },

  _executeSwitchTab: async function(params, startedAt) {
    var tabId = params.tabId;
    if (!tabId) {
      return {
        success: false,
        action: "switch_tab",
        selector: null,
        durationMs: Date.now() - startedAt,
        error: "缺少 tabId 参数",
        pageChanged: false
      };
    }

    var entry = TabRegistry._tabs[tabId];
    if (!entry) {
      return {
        success: false,
        action: "switch_tab",
        selector: null,
        durationMs: Date.now() - startedAt,
        error: "Tab 不存在: " + tabId,
        pageChanged: false
      };
    }

    TabRegistry.setAgentTab(tabId);

    return {
      success: true,
      action: "switch_tab",
      selector: null,
      durationMs: Date.now() - startedAt,
      error: null,
      pageChanged: true,
      tabId: tabId
    };
  },

  _executeCloseTab: async function(params, startedAt) {
    var targetId = params.tabId || TabRegistry.getAgentTabId();
    if (!targetId) {
      return {
        success: false,
        action: "close_tab",
        selector: null,
        durationMs: Date.now() - startedAt,
        error: "没有指定要关闭的 Tab",
        pageChanged: false
      };
    }

    try {
      await TabRegistry.closeTab(targetId);
      return {
        success: true,
        action: "close_tab",
        selector: null,
        durationMs: Date.now() - startedAt,
        error: null,
        pageChanged: true,
        tabId: targetId
      };
    } catch (err) {
      return {
        success: false,
        action: "close_tab",
        selector: null,
        durationMs: Date.now() - startedAt,
        error: "关闭 Tab 失败: " + err.message,
        pageChanged: false
      };
    }
  }
};

var self = ActionExecutor;
