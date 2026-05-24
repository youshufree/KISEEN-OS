/**
 * sidepanel-tabs.js — Tab 列表 + Panel Tab 切换
 *
 * 职责：Tab 列表渲染 / Panel Tab 切换（分析/对话） / Agent Tab 切换
 */
var SidepanelTabs = {
  init: async function() {
    var self = this;

    self._elements = {
      analyzeTabBtn: document.getElementById("analyzeTabBtn"),
      chatTabBtn: document.getElementById("chatTabBtn"),
      benchmarkTabBtn: document.getElementById("benchmarkTabBtn"),
      analyzeTabContent: document.getElementById("analyzeTabContent"),
      chatTabContent: document.getElementById("chatTabContent"),
      benchmarkTabContent: document.getElementById("benchmarkTabContent"),
      tabListEl: document.getElementById("tabList")
    };

    await TabRegistry.init();
    PopupState.activeTab = TabRegistry.getAgentTab();
    PopupState.agentTabId = TabRegistry.getAgentTabId();

    PopupState.activePanel = "analyze";
    PopupState.chatMode = false;

    // Panel Tab 切换
    self._elements.analyzeTabBtn.addEventListener("click", function() {
      self._switchPanel("analyze");
    });
    self._elements.chatTabBtn.addEventListener("click", function() {
      self._switchPanel("chat");
    });
    self._elements.benchmarkTabBtn.addEventListener("click", function() {
      self._switchPanel("benchmark");
    });

    // 渲染 Tab 列表
    self._renderTabs(TabRegistry.getAll());

    // 监听 Runtime 事件
    RuntimeAPI.subscribe("tabs_updated", function(payload) {
      self._renderTabs(payload.tabs);
    });

    RuntimeAPI.subscribe("agent_tab_changed", function(payload) {
      PopupState.activeTab = TabRegistry.getAgentTab();
      PopupState.agentTabId = payload.tabId;

      // 触发侧边栏重新加载
      if (SidepanelAnalyze.fetchPageContent) {
        SidepanelAnalyze.fetchPageContent(PopupState.captureMode).catch(function(err) {
          console.error("agent_tab_changed: 重新抓取内容失败", err);
        });
      }
      if (SidepanelChat.loadHistory) {
        SidepanelChat.loadHistory();
      }
    });

    self._renderTabs(TabRegistry.getAll());
  },

  _switchPanel: function(panel) {
    var el = this._elements;

    // 重置所有 tab 按钮
    el.analyzeTabBtn.classList.remove("active");
    el.chatTabBtn.classList.remove("active");
    el.benchmarkTabBtn.classList.remove("active");
    el.analyzeTabContent.classList.remove("active");
    el.chatTabContent.classList.remove("active");
    if (el.benchmarkTabContent) el.benchmarkTabContent.style.display = "none";

    if (panel === "analyze") {
      el.analyzeTabBtn.classList.add("active");
      el.analyzeTabContent.classList.add("active");
      PopupState.activePanel = "analyze";
      PopupState.chatMode = false;
    } else if (panel === "benchmark") {
      el.benchmarkTabBtn.classList.add("active");
      if (el.benchmarkTabContent) el.benchmarkTabContent.style.display = "block";
      PopupState.activePanel = "benchmark";
      PopupState.chatMode = false;
    } else {
      el.chatTabBtn.classList.add("active");
      el.chatTabContent.classList.add("active");
      PopupState.activePanel = "chat";
      PopupState.chatMode = true;
      var chatHistoryEl = document.getElementById("chatHistory");
      if (chatHistoryEl) chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;
    }
  },

  _renderTabs: function(tabs) {
    var el = this._elements;
    if (!el.tabListEl) return;
    el.tabListEl.innerHTML = "";
    var agentTabId = TabRegistry.getAgentTabId();

    for (var i = 0; i < tabs.length; i++) {
      var tab = tabs[i];
      var isAgent = tab.id === agentTabId;
      var isRestricted = TabRegistry._isRestrictedUrl(tab.url);

      var item = document.createElement("div");
      item.className = "tab-item" + (isAgent ? " active-agent-tab" : "") + (isRestricted ? " restricted" : "");

      var favicon = document.createElement("img");
      favicon.className = "tab-favicon";
      favicon.src = tab.favIconUrl || "";
      favicon.onerror = function() { this.style.display = "none"; };

      var title = document.createElement("span");
      title.className = "tab-title";
      title.textContent = tab.title || tab.url || "(无标题)";

      item.appendChild(favicon);
      item.appendChild(title);

      if (isAgent) {
        var badge = document.createElement("span");
        badge.className = "tab-badge";
        badge.textContent = "当前目标";
        item.appendChild(badge);
      } else if (!isRestricted) {
        var btn = document.createElement("button");
        btn.className = "tab-set-btn";
        btn.textContent = "设为目标";
        btn.setAttribute("data-tab-id", tab.id);
        btn.addEventListener("click", function(e) {
          e.stopPropagation();
          var tid = parseInt(this.getAttribute("data-tab-id"));
          chrome.tabs.update(tid, { active: true });
          TabRegistry.setAgentTab(tid);
        });
        item.appendChild(btn);
      }

      el.tabListEl.appendChild(item);
    }
  }
};
