/**
 * popupControls.js — 按钮绑定 + 模式切换 + UI 控制
 *
 * 职责：
 *   1. 模式切换按钮事件
 *   2. 监听 RuntimeEvents("runtime_state_changed") 驱动 UI
 *   3. 总结 / 取消按钮显示切换
 *
 * 渲染策略根据 RuntimeState.current.result 结构自动判断，
 * 不再依赖 PopupState.currentTemplate。
 */

var PopupControls = {
  bindAll: function(elements) {
    var summarizeBtn = elements.summarizeBtn;
    var cancelBtn = elements.cancelBtn;
    var askBtn = elements.askBtn;
    var contentModeBtn = elements.contentModeBtn;
    var fullModeBtn = elements.fullModeBtn;
    var visualModeBtn = elements.visualModeBtn;

    RuntimeAPI.subscribe("runtime_state_changed", function(payload) {
      var phase = payload.phase;
      if (phase === "building_prompt") {
        if (PopupState.chatMode && elements.chatMessages) {
          PopupRenderer.renderChatTyping(elements.chatMessages);
        } else {
          elements.summaryResult.textContent = "正在构建提示词...";
          elements.summaryStatus.textContent = "";
          elements.summaryStatus.className = "";
        }
      } else if (phase === "requesting_llm") {
        if (PopupState.chatMode && elements.chatMessages) {
          PopupRenderer.renderChatTyping(elements.chatMessages);
        } else {
          elements.summaryResult.textContent = "正在请求 AI...";
        }
      } else if (phase === "executing_tool") {
        var md = payload.metadata || {};
        elements.summaryStatus.textContent = "正在执行操作: " + (md.tool || "");
        elements.summaryStatus.className = "";
      } else if (phase === "observing") {
        elements.summaryResult.textContent = "正在观察页面...";
      } else if (phase === "planning") {
        elements.summaryResult.textContent = "正在规划任务...";
        elements.summaryStatus.textContent = "";
        elements.summaryStatus.className = "";
      } else if (phase === "executing_plan") {
        elements.summaryResult.textContent = "正在执行计划...";
      } else if (phase === "executing_step") {
        var md = payload.metadata || {};
        var stepInfo = md.stepId ? md.stepId + " " : "";
        stepInfo += md.stepType === "observe" ? "观察页面" :
                    md.stepType === "tool" ? "执行工具" :
                    md.stepType === "browser_action" ? "执行浏览器操作" :
                    md.stepType === "respond" ? "生成回答" : "执行步骤";
        elements.summaryResult.textContent = "正在执行: " + stepInfo;
      } else if (phase === "executing_browser_action") {
        elements.summaryResult.textContent = "正在执行浏览器操作...";
      } else if (phase === "waiting_page_update") {
        elements.summaryResult.textContent = "等待页面更新...";
        elements.summaryResult.textContent = "正在思考...";
      } else if (phase === "acting") {
        elements.summaryResult.textContent = "正在执行操作...";
      } else if (phase === "reflecting") {
        elements.summaryResult.textContent = "正在记录步骤...";
      } else if (phase === "completed") {
        var result = payload.result;

        if (PopupState.chatMode && elements.chatMessages) {
          PopupRenderer.removeChatTyping(elements.chatMessages);
          if (result && result.content) {
            PopupRenderer.renderChatMessage(elements.chatMessages, "assistant", result.content);
          }
          if (result && result.chatHistory) {
            PopupState.chatHistory = result.chatHistory;
          }
          if (elements.chatStatus) {
            elements.chatStatus.textContent = "";
            elements.chatStatus.className = "";
          }
        } else if (result && result.answer) {
          var chatHistoryEl = document.getElementById("chatHistory");
          if (chatHistoryEl) {
            PopupRenderer.renderChatMessage(chatHistoryEl, "assistant", result.answer);
            var chatTabBtn = document.getElementById("chatTabBtn");
            if (chatTabBtn) chatTabBtn.click();
          }
          PopupControls.showRunButton(summarizeBtn, cancelBtn, askBtn);
        } else {
          if (result && result.finalAnswer) {
            PopupRenderer.renderQAResult({ answer: result.finalAnswer }, elements.summaryResult, elements.copyBtn);
          } else {
            PopupRenderer.renderSummary(result, elements.summaryResult, elements.copyBtn);
          }
          elements.summaryStatus.textContent = "✅ 完成";
          elements.summaryStatus.className = "";
          PopupControls.showRunButton(summarizeBtn, cancelBtn, askBtn);
        }
      } else if (phase === "failed" || phase === "cancelled") {
        if (PopupState.chatMode && elements.chatMessages) {
          PopupRenderer.removeChatTyping(elements.chatMessages);
          if (elements.chatStatus) {
            elements.chatStatus.textContent = "错误：" + (payload.error || "未知");
            elements.chatStatus.className = "summary-error";
          }
        } else {
          elements.summaryResult.textContent = "请求失败";
          elements.summaryStatus.textContent = "错误：" + (payload.error || "未知");
          elements.summaryStatus.className = "summary-error";
          PopupControls.showRunButton(summarizeBtn, cancelBtn, askBtn);
        }
      }
    });

    RuntimeAPI.subscribe("*", function() {
      if (elements.tracePanelEl) {
        PopupRenderer.renderTracePanel(elements.tracePanelEl);
      }
    });

    // 模式切换
    contentModeBtn.addEventListener("click", function() {
      if (PopupState.captureMode === "content") return;
      PopupState.captureMode = "content";
      PopupRenderer.updateModeButtons(contentModeBtn, fullModeBtn, visualModeBtn);
      elements.summaryResult.innerHTML = "";
      elements.summaryResult.classList.add("empty");
      elements.summaryResult.textContent = "正在重新抓取（内容模式）...";
      elements.fetchPageContent("content").catch(function(err) {
        console.error("模式切换失败:", err);
      });
    });

    fullModeBtn.addEventListener("click", function() {
      if (PopupState.captureMode === "full") return;
      PopupState.captureMode = "full";
      PopupRenderer.updateModeButtons(contentModeBtn, fullModeBtn, visualModeBtn);
      elements.summaryResult.innerHTML = "";
      elements.summaryResult.classList.add("empty");
      elements.summaryResult.textContent = "正在重新抓取（全局模式）...";
      elements.fetchPageContent("full").catch(function(err) {
        console.error("模式切换失败:", err);
      });
    });

    visualModeBtn.addEventListener("click", function() {
      if (PopupState.captureMode === "visual") return;
      PopupState.captureMode = "visual";
      PopupRenderer.updateModeButtons(contentModeBtn, fullModeBtn, visualModeBtn);
      elements.summaryResult.innerHTML = "";
      elements.summaryResult.classList.add("empty");
      elements.summaryResult.textContent = "正在重新抓取（图片模式）...";
      elements.fetchPageContent("visual").catch(function(err) {
        console.error("模式切换失败:", err);
      });
    });
  },

  showRunningButton: function(summarizeBtn, cancelBtn, askBtn) {
    summarizeBtn.style.display = "none";
    if (askBtn) askBtn.style.display = "none";
    cancelBtn.style.display = "inline-block";
  },

  showRunButton: function(summarizeBtn, cancelBtn, askBtn) {
    summarizeBtn.style.display = "inline-block";
    summarizeBtn.textContent = "🤖 AI 总结";
    cancelBtn.style.display = "none";
    PopupRenderer.updateSummarizeButton(summarizeBtn, askBtn);
  },

  showChatRunning: function(chatSendBtn, chatCancelBtn) {
    if (chatSendBtn) chatSendBtn.style.display = "none";
    if (chatCancelBtn) chatCancelBtn.style.display = "inline-block";
  },

  showChatSendButton: function(chatSendBtn, chatCancelBtn) {
    if (chatSendBtn) {
      chatSendBtn.style.display = "inline-block";
      chatSendBtn.disabled = !PopupState.hasApiKey;
    }
    if (chatCancelBtn) chatCancelBtn.style.display = "none";
  }
};
