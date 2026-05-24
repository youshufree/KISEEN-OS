/**
 * popup.js - 入口
 *
 * 职责：初始化 DOM 引用、绑定事件、首屏数据加载。
 */
document.addEventListener("DOMContentLoaded", async () => {
  var loadingEl = document.getElementById("loading");
  var resultEl = document.getElementById("result");
  var errorEl = document.getElementById("error");
  var apiKeyInput = document.getElementById("apiKeyInput");
  var saveKeyBtn = document.getElementById("saveKeyBtn");
  var apiStatus = document.getElementById("apiStatus");
  var summarizeBtn = document.getElementById("summarizeBtn");
  var cancelBtn = document.getElementById("cancelRuntimeBtn");
  var summaryResult = document.getElementById("summaryResult");
  var summaryStatus = document.getElementById("summaryStatus");
  var copyBtn = document.getElementById("copyBtn");
  var contentModeBtn = document.getElementById("contentModeBtn");
  var fullModeBtn = document.getElementById("fullModeBtn");
  var visualModeBtn = document.getElementById("visualModeBtn");
  var tracePanelEl = document.getElementById("runtimeTracePanel");

  RuntimeSession.init();
  RuntimeTrace.init();

  async function fetchPageContent(mode) {
    var [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) throw new Error("无法获取当前标签页");
    PopupState.activeTab = tab;
    var response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { action: "getPageContent", mode: mode });
    } catch (e) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["dist/content.bundle.js"]
      });
      response = await chrome.tabs.sendMessage(tab.id, { action: "getPageContent", mode: mode });
    }
    loadingEl.style.display = "none";
    resultEl.style.display = "block";
    PopupRenderer.updatePageInfo(response,
      document.getElementById("pageTitle"),
      document.getElementById("pagePreview"),
      document.getElementById("pageLength")
    );
    PopupState.pageContent = response.fullText || "";
    PopupState.captureMode = response.mode || mode;
    PopupRenderer.updateSummarizeButton(summarizeBtn);
  }

  PopupEvents.bindAll({
    loadingEl: loadingEl, resultEl: resultEl, errorEl: errorEl,
    apiKeyInput: apiKeyInput, saveKeyBtn: saveKeyBtn, apiStatus: apiStatus,
    summarizeBtn: summarizeBtn, cancelBtn: cancelBtn,
    summaryResult: summaryResult, summaryStatus: summaryStatus, copyBtn: copyBtn,
    contentModeBtn: contentModeBtn, fullModeBtn: fullModeBtn, visualModeBtn: visualModeBtn,
    tracePanelEl: tracePanelEl,
    fetchPageContent: fetchPageContent
  });

  var data = await chrome.storage.sync.get(["deepseekApiKey"]);
  var apiKey = data.deepseekApiKey || "";
  RuntimeAPI.configure({ providerType: "deepseek", apiKey: apiKey });

  PopupState.hasApiKey = !!apiKey;
  if (apiKey) {
    apiKeyInput.value = apiKey;
    apiStatus.textContent = "\u2713 API Key \u5DF2\u4FDD\u5B58";
    apiStatus.className = "api-status saved";
  } else {
    apiStatus.textContent = "\u672A\u8BBE\u7F6E API Key";
    apiStatus.className = "api-status missing";
  }

  saveKeyBtn.addEventListener("click", async () => {
    var key = apiKeyInput.value.trim();
    if (!key) {
      apiStatus.textContent = "\u8BF7\u8F93\u5165 API Key";
      apiStatus.className = "api-status missing";
      PopupState.hasApiKey = false;
      PopupRenderer.updateSummarizeButton(summarizeBtn);
      return;
    }
    await chrome.storage.sync.set({ deepseekApiKey: key });
    RuntimeAPI.configure({ providerType: "deepseek", apiKey: key });
    PopupState.hasApiKey = true;
    apiStatus.textContent = "\u2713 API Key \u5DF2\u4FDD\u5B58";
    apiStatus.className = "api-status saved";
    PopupRenderer.updateSummarizeButton(summarizeBtn);
  });

  try {
    await fetchPageContent("content");
  } catch (err) {
    loadingEl.style.display = "none";
    errorEl.style.display = "block";
    errorEl.textContent = "\u8BFB\u53D6\u5931\u8D25\uFF1A" + err.message;
  }

  summarizeBtn.addEventListener("click", function() {
    PopupRuntime.startRuntime({
      summarizeBtn: summarizeBtn,
      cancelBtn: cancelBtn,
      summaryResult: summaryResult,
      summaryStatus: summaryStatus
    });
  });

  cancelBtn.addEventListener("click", function() {
    PopupRuntime.cancelRuntime({
      summarizeBtn: summarizeBtn,
      cancelBtn: cancelBtn
    });
  });

  copyBtn.addEventListener("click", async () => {
    if (!PopupState.lastParsedData) return;
    var lines = [];
    var d = PopupState.lastParsedData;
    if (d.topic) lines.push("\u4E3B\u9898\uFF1A" + d.topic);
    if (d.summary) lines.push("\u603B\u7ED3\uFF1A" + d.summary);
    if (d.keywords && d.keywords.length > 0) lines.push("\u5173\u952E\u8BCD\uFF1A" + d.keywords.join("\u3001"));
    if (d.sentiment) lines.push("\u60C5\u611F\u503E\u5411\uFF1A" + d.sentiment);
    if (d.important_points && d.important_points.length > 0) {
      lines.push("\u6838\u5FC3\u89C2\u70B9\uFF1A");
      for (var i = 0; i < d.important_points.length; i++) {
        lines.push("  \u2022 " + d.important_points[i]);
      }
    }
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      copyBtn.textContent = "\u2705 \u5DF2\u590D\u5236";
      copyBtn.className = "copied";
      setTimeout(function() { copyBtn.textContent = "\uD83D\uDCCB \u590D\u5236"; copyBtn.className = ""; }, 2000);
    } catch (e) {
      copyBtn.textContent = "\u274C \u590D\u5236\u5931\u8D25";
    }
  });
});
