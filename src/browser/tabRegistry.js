/**
 * tabRegistry.js — Tab 集中管理
 *
 * 职责：
 *   1. 维护所有打开 Tab 的状态缓存
 *   2. 管理 Agent 当前操作的目标 Tab
 *   3. 提供 openTab / closeTab / getTabContent 等操作
 *   4. 监听 chrome.tabs 事件自动更新缓存
 *   5. 变更时通过 RuntimeEvents 通知 UI
 *
 * 运行环境：SidePanel
 */

var TabRegistry = {
  _tabs: {},
  _activeAgentTabId: null,
  _openTabCount: 0,
  MAX_OPEN_TABS: 5,

  init: async function() {
    var self = this;
    self._tabs = {};
    self._openTabCount = 0;

    var allTabs = await chrome.tabs.query({});
    for (var i = 0; i < allTabs.length; i++) {
      var tab = allTabs[i];
      self._tabs[tab.id] = self._toEntry(tab);
    }

    var [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab) {
      self._activeAgentTabId = activeTab.id;
    } else {
      var tabIds = Object.keys(self._tabs);
      if (tabIds.length > 0) {
        self._activeAgentTabId = parseInt(tabIds[0]);
      }
    }

    self._bindChromeTabEvents();
  },

  _toEntry: function(tab) {
    return {
      id: tab.id,
      title: tab.title || "",
      url: tab.url || "",
      favIconUrl: tab.favIconUrl || "",
      status: tab.status || "complete",
      windowId: tab.windowId,
      index: tab.index,
      updatedAt: Date.now()
    };
  },

  getAll: function() {
    var results = [];
    for (var id in this._tabs) {
      if (this._tabs.hasOwnProperty(id)) {
        results.push(this._tabs[id]);
      }
    }
    results.sort(function(a, b) {
      if (a.windowId !== b.windowId) return a.windowId - b.windowId;
      return a.index - b.index;
    });
    return results;
  },

  getAgentTab: function() {
    if (this._activeAgentTabId && this._tabs[this._activeAgentTabId]) {
      return this._tabs[this._activeAgentTabId];
    }
    return null;
  },

  getAgentTabId: function() {
    return this._activeAgentTabId;
  },

  setAgentTab: function(tabId) {
    if (!this._tabs[tabId]) return;
    this._activeAgentTabId = tabId;

    RuntimeEvents.emit("agent_tab_changed", {
      tabId: tabId,
      tab: this._tabs[tabId]
    });

    RuntimeEvents.emit("tabs_updated", {
      tabs: this.getAll()
    });
  },

  openTab: async function(url) {
    var self = this;

    if (self._openTabCount >= self.MAX_OPEN_TABS) {
      throw new Error("已达到最大打开 Tab 数量限制 (" + self.MAX_OPEN_TABS + ")");
    }

    if (!url || (
        url.indexOf("http://") !== 0
        && url.indexOf("https://") !== 0
    )) {
      throw new Error("只允许打开 http/https URL");
    }

    var tab = await chrome.tabs.create({ url: url, active: true });
    self._tabs[tab.id] = self._toEntry(tab);
    self._openTabCount++;

    RuntimeEvents.emit("tabs_updated", {
      tabs: self.getAll()
    });

    return self._tabs[tab.id];
  },

  closeTab: async function(tabId) {
    var self = this;
    if (!self._tabs[tabId]) {
      throw new Error("Tab 不存在: " + tabId);
    }

    var allTabs = self.getAll();
    if (allTabs.length <= 1) {
      throw new Error("不允许关闭最后一个标签页");
    }

    await chrome.tabs.remove(tabId);
    delete self._tabs[tabId];

    if (self._openTabCount > 0) {
      self._openTabCount--;
    }

    if (self._activeAgentTabId === tabId) {
      var remaining = self.getAll();
      if (remaining.length > 0) {
        self._activeAgentTabId = remaining[0].id;
      } else {
        self._activeAgentTabId = null;
      }
      RuntimeEvents.emit("agent_tab_changed", {
        tabId: self._activeAgentTabId,
        tab: self.getAgentTab()
      });
    }

    RuntimeEvents.emit("tabs_updated", {
      tabs: self.getAll()
    });
  },

  getTabContent: async function(tabId, mode) {
    var self = this;
    var entry = self._tabs[tabId];
    if (!entry) {
      throw new Error("Tab 不存在: " + tabId);
    }

    if (self._isRestrictedUrl(entry.url)) {
      throw new Error("不支持在此页面获取内容: " + entry.url);
    }

    var response;
    try {
      response = await chrome.tabs.sendMessage(tabId, {
        action: "getPageContent",
        mode: mode || "content"
      });
    } catch (e) {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ["contentProcessor.js", "contentObserver.js", "elementLocator.js", "contentRuntime.js", "content.js"]
      });
      response = await chrome.tabs.sendMessage(tabId, {
        action: "getPageContent",
        mode: mode || "content"
      });
    }
    return response;
  },

  waitForTabLoad: async function(tabId, timeout) {
    var self = this;
    if (!timeout) timeout = 10000;
    var startedAt = Date.now();

    return new Promise(function(resolve) {
      function check() {
        chrome.tabs.get(tabId, function(tab) {
          if (chrome.runtime.lastError) {
            resolve(false);
            return;
          }
          if (tab.status === "complete") {
            self._tabs[tabId] = self._toEntry(tab);
            resolve(true);
            return;
          }
          if (Date.now() - startedAt >= timeout) {
            resolve(false);
            return;
          }
          setTimeout(check, 200);
        });
      }
      check();
    });
  },

  _isRestrictedUrl: function(url) {
    if (!url) return true;
    return url.indexOf("chrome://") === 0
        || url.indexOf("chrome-extension://") === 0
        || url.indexOf("about:") === 0
        || url.indexOf("file://") === 0
        || url.indexOf("devtools://") === 0;
  },

  _bindChromeTabEvents: function() {
    var self = this;

    chrome.tabs.onCreated.addListener(function(tab) {
      self._tabs[tab.id] = self._toEntry(tab);
      RuntimeEvents.emit("tabs_updated", {
        tabs: self.getAll()
      });
    });

    chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
      self._tabs[tabId] = self._toEntry(tab);
      RuntimeEvents.emit("tabs_updated", {
        tabs: self.getAll()
      });
    });

    chrome.tabs.onRemoved.addListener(function(tabId) {
      delete self._tabs[tabId];
      if (self._activeAgentTabId === tabId) {
        var remaining = self.getAll();
        self._activeAgentTabId = remaining.length > 0 ? remaining[0].id : null;
        RuntimeEvents.emit("agent_tab_changed", {
          tabId: self._activeAgentTabId,
          tab: self.getAgentTab()
        });
      }
      RuntimeEvents.emit("tabs_updated", {
        tabs: self.getAll()
      });
    });

    chrome.tabs.onActivated.addListener(function(activeInfo) {
      if (self._tabs[activeInfo.tabId]) {
        self._tabs[activeInfo.tabId].updatedAt = Date.now();
      }
    });
  }
};
