/**
 * sidepanel-analyze.js — 分析 Tab 逻辑
 *
 * 职责：页面内容抓取 / AI 总结 / 复制结果 / 模式切换
 * 通过 RuntimeAPI 启动任务，不直接调用 AgentRuntime / Planner / Provider。
 */
var SidepanelAnalyze = {
  init: function() {
    var self = this;
    self._elements = {
      loadingEl: document.getElementById("loading"),
      resultEl: document.getElementById("result"),
      errorEl: document.getElementById("error"),
      summarizeBtn: document.getElementById("summarizeBtn"),
      cancelBtn: document.getElementById("cancelRuntimeBtn"),
      summaryResult: document.getElementById("summaryResult"),
      summaryStatus: document.getElementById("summaryStatus"),
      copyBtn: document.getElementById("copyBtn"),
      contentModeBtn: document.getElementById("contentModeBtn"),
      fullModeBtn: document.getElementById("fullModeBtn"),
      visualModeBtn: document.getElementById("visualModeBtn"),
      tracePanelEl: document.getElementById("runtimeTracePanel")
    };

    self._bindEvents();
    self._subscribeRuntimeEvents();
  },

  fetchPageContent: async function(mode) {
    var self = this;
    var el = self._elements;
    var tab = TabRegistry.getAgentTab();

    if (!tab) {
      var activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTabs && activeTabs[0]) {
        TabRegistry.setAgentTab(activeTabs[0].id);
        tab = TabRegistry.getAgentTab();
      }
    }
    if (!tab) {
      el.loadingEl.style.display = "none";
      el.errorEl.style.display = "block";
      el.errorEl.textContent = "无法获取当前标签页";
      return;
    }
    PopupState.activeTab = tab;
    PopupState.agentTabId = tab.id;

    var isRestricted = TabRegistry._isRestrictedUrl(tab.url);

    el.loadingEl.style.display = "none";
    el.resultEl.style.display = "block";

    if (isRestricted) {
      document.getElementById("pageTitle").textContent = tab.title || "(不支持此页面)";
      document.getElementById("pageLength").textContent = "";
      var faviconEl = document.getElementById("pageFavicon");
      if (faviconEl) { faviconEl.style.display = "none"; }
      PopupState.pageContent = "";
      PopupRenderer.updateSummarizeButton(el.summarizeBtn, document.getElementById("askBtn"));
      return;
    }

    // 先主动注入 content script（确保可用）
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["dist/content.bundle.js"]
      });
    } catch (injectErr) {
      // 可能已经注入过，忽略错误
    }

    // 等待 content script 就绪
    await new Promise(function(r) { setTimeout(r, 200); });

    var response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { action: "getPageContent", mode: mode });
    } catch (e) {
      response = null;
    }

    if (!response) {
      document.getElementById("pageTitle").textContent = tab.title || "(无法读取)";
      document.getElementById("pageLength").textContent = "";
      var faviconEl3 = document.getElementById("pageFavicon");
      if (faviconEl3) { faviconEl3.style.display = "none"; }
      PopupState.pageContent = "";
      PopupRenderer.updateSummarizeButton(el.summarizeBtn, document.getElementById("askBtn"));
      AgentModeController.updateRunButton();
      return;
    }

    PopupRenderer.updatePageInfo(response,
      document.getElementById("pageTitle"),
      document.getElementById("pagePreview"),
      document.getElementById("pageLength"),
      document.getElementById("pageFavicon")
    );
    PopupState.pageContent = response.fullText || "";
    PopupState.captureMode = response.mode || mode;
    PopupRenderer.updateSummarizeButton(el.summarizeBtn, document.getElementById("askBtn"));
    AgentModeController.updateRunButton();
  },

  runSummarize: async function() {
    var el = this._elements;
    PopupControls.showRunningButton(el.summarizeBtn, el.cancelBtn, document.getElementById("askBtn"));

    try {
      var result = await RuntimeAPI.startTask({
        template: "summarize",
        pageContent: PopupState.pageContent
      });

      el.summaryStatus.textContent = "\u2705 完成";
      el.summaryStatus.className = "";
      PopupRenderer.renderSummary(result, el.summaryResult, el.copyBtn);
    } catch (err) {
      console.error("SidepanelAnalyze: \u603b\u7ed3\u5931\u8d25", err);
      el.summaryStatus.textContent = "\u6267\u884c\u5931\u8d25\uff1a" + (err.message || "\u672a\u77e5\u9519\u8bef");
      el.summaryStatus.className = "summary-error";
    }
    PopupControls.showRunButton(el.summarizeBtn, el.cancelBtn, document.getElementById("askBtn"));
  },

  _bindEvents: function() {
    var self = this;
    var el = self._elements;

    el.summarizeBtn.addEventListener("click", function() {
      self.runSummarize();
    });

    el.cancelBtn.addEventListener("click", function() {
      RuntimeAPI.stopTask();
      PopupControls.showRunButton(el.summarizeBtn, el.cancelBtn, document.getElementById("askBtn"));
    });

    el.copyBtn.addEventListener("click", async function() {
      if (!PopupState.lastParsedData) return;

      var lines = [];
      var d = PopupState.lastParsedData;
      if (d.answer) { lines.push("\u56de\u7b54\uff1a" + d.answer); }
      else {
        if (d.topic) lines.push("\u4e3b\u9898\uff1a" + d.topic);
        if (d.summary) lines.push("\u603b\u7ed3\uff1a" + d.summary);
        if (d.keywords && d.keywords.length > 0) lines.push("\u5173\u952e\u8bcd\uff1a" + d.keywords.join("\u3001"));
        if (d.sentiment) lines.push("\u60c5\u611f\u503e\u5411\uff1a" + d.sentiment);
        if (d.important_points && d.important_points.length > 0) {
          lines.push("\u6838\u5fc3\u89c2\u70b9\uff1a");
          for (var i = 0; i < d.important_points.length; i++) { lines.push("  \u2022 " + d.important_points[i]); }
        }
      }

      try {
        await navigator.clipboard.writeText(lines.join("\n"));
        el.copyBtn.textContent = "\u2705 \u5df2\u590d\u5236";
        el.copyBtn.className = "copied";
        setTimeout(function() { el.copyBtn.textContent = "\ud83d\udccb \u590d\u5236"; el.copyBtn.className = ""; }, 2000);
      } catch (e) { el.copyBtn.textContent = "\u274c \u590d\u5236\u5931\u8d25"; }
    });

    el.contentModeBtn.addEventListener("click", function() {
      if (PopupState.captureMode === "content") return;
      PopupState.captureMode = "content";
      PopupRenderer.updateModeButtons(el.contentModeBtn, el.fullModeBtn, el.visualModeBtn);
      el.summaryResult.innerHTML = "";
      el.summaryResult.classList.add("empty");
      el.summaryResult.textContent = "\u6b63\u5728\u91cd\u65b0\u6293\u53d6\uff08\u5185\u5bb9\u6a21\u5f0f\uff09...";
      self.fetchPageContent("content").catch(function(err) { console.error("\u6a21\u5f0f\u5207\u6362\u5931\u8d25:", err); });
    });

    el.fullModeBtn.addEventListener("click", function() {
      if (PopupState.captureMode === "full") return;
      PopupState.captureMode = "full";
      PopupRenderer.updateModeButtons(el.contentModeBtn, el.fullModeBtn, el.visualModeBtn);
      el.summaryResult.innerHTML = "";
      el.summaryResult.classList.add("empty");
      el.summaryResult.textContent = "\u6b63\u5728\u91cd\u65b0\u6293\u53d6\uff08\u5168\u5c40\u6a21\u5f0f\uff09...";
      self.fetchPageContent("full").catch(function(err) { console.error("\u6a21\u5f0f\u5207\u6362\u5931\u8d25:", err); });
    });

    el.visualModeBtn.addEventListener("click", function() {
      if (PopupState.captureMode === "visual") return;
      PopupState.captureMode = "visual";
      PopupRenderer.updateModeButtons(el.contentModeBtn, el.fullModeBtn, el.visualModeBtn);
      el.summaryResult.innerHTML = "";
      el.summaryResult.classList.add("empty");
      el.summaryResult.textContent = "\u6b63\u5728\u91cd\u65b0\u6293\u53d6\uff08\u56fe\u7247\u6a21\u5f0f\uff09...";
      self.fetchPageContent("visual").catch(function(err) { console.error("\u6a21\u5f0f\u5207\u6362\u5931\u8d25:", err); });
    });
  },

  _subscribeRuntimeEvents: function() {
    var self = this;
    var el = self._elements;

    RuntimeAPI.subscribe("runtime_state_changed", function(payload) {
      var phase = payload.phase;
      if (PopupState.chatMode) return;

      if (phase === "building_prompt") {
        el.summaryResult.textContent = "\u6b63\u5728\u6784\u5efa\u63d0\u793a\u8bcd...";
        el.summaryStatus.textContent = "";
        el.summaryStatus.className = "";
      } else if (phase === "requesting_llm") {
        el.summaryResult.textContent = "\u6b63\u5728\u8bf7\u6c42 AI...";
      } else if (phase === "executing_tool") {
        var md = payload.metadata || {};
        el.summaryStatus.textContent = "\u6b63\u5728\u6267\u884c\u64cd\u4f5c: " + (md.tool || "");
        el.summaryStatus.className = "";
      } else if (phase === "completed") {
        var result = payload.result;
        if (result && result.finalAnswer) {
          PopupRenderer.renderQAResult({ answer: result.finalAnswer }, el.summaryResult, el.copyBtn);
        } else {
          PopupRenderer.renderSummary(result, el.summaryResult, el.copyBtn);
        }
        el.summaryStatus.textContent = "\u2705 \u5b8c\u6210";
        el.summaryStatus.className = "";
        PopupControls.showRunButton(el.summarizeBtn, el.cancelBtn, document.getElementById("askBtn"));
      } else if (phase === "failed" || phase === "cancelled") {
        el.summaryResult.textContent = "\u8bf7\u6c42\u5931\u8d25";
        el.summaryStatus.textContent = "\u9519\u8bef\uff1a" + (payload.error || "\u672a\u77e5");
        el.summaryStatus.className = "summary-error";
        PopupControls.showRunButton(el.summarizeBtn, el.cancelBtn, document.getElementById("askBtn"));
      }
    });

    RuntimeAPI.subscribe("*", function() {
      if (el.tracePanelEl) { PopupRenderer.renderTracePanel(el.tracePanelEl); }
    });
  }
};
