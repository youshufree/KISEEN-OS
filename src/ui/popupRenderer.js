/**
 * popupRenderer.js - UI 渲染函数
 *
 * 职责：
 *   1. 渲染 AI 总结结果
 *   2. 渲染 Runtime Trace 面板
 *   3. 更新按钮状态
 *
 * 所有 DOM 操作集中在此文件。
 */

function escapeHtml(text) {
  var div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

var PopupRenderer = {
  /**
   * updateSummarizeButton(summarizeBtn, askBtn)
   */
  updateSummarizeButton: function(summarizeBtn, askBtn) {
    var ready;
    if (PopupState.providerType === "openclaw") {
      ready = !!PopupState.pageContent;
    } else {
      ready = !!(PopupState.pageContent && PopupState.hasApiKey);
    }
    summarizeBtn.disabled = !ready;
    if (askBtn) askBtn.disabled = !ready;
  },

  /**
   * updateModeButtons(contentBtn, fullBtn, visualBtn)
   */
  updateModeButtons: function(contentBtn, fullBtn, visualBtn) {
    contentBtn.className = PopupState.captureMode === "content" ? "mode-btn active" : "mode-btn";
    fullBtn.className = PopupState.captureMode === "full" ? "mode-btn active" : "mode-btn";
    visualBtn.className = PopupState.captureMode === "visual" ? "mode-btn active" : "mode-btn";
  },

  /**
   * updatePageInfo(response, pageTitleEl, pagePreviewEl, pageLengthEl)
   */
  updatePageInfo: function(response, pageTitleEl, pagePreviewEl, pageLengthEl, pageFaviconEl) {
    pageTitleEl.textContent = response.title || "(无标题)";
    pagePreviewEl.textContent = response.preview;
    if (response.rawLength && response.rawLength !== response.totalLength) {
      pageLengthEl.textContent =
        response.totalLength + " 字符";
    } else {
      pageLengthEl.textContent =
        response.totalLength + " 字符";
    }
    if (pageFaviconEl && response.favIconUrl) {
      pageFaviconEl.src = response.favIconUrl;
      pageFaviconEl.style.display = "inline";
      pageFaviconEl.onerror = function() { this.style.display = "none"; };
    } else if (pageFaviconEl) {
      pageFaviconEl.style.display = "none";
    }
  },

  /**
   * renderSummary(parsed, summaryResult, copyBtn)
   */
  renderSummary: function(parsed, summaryResult, copyBtn) {
    summaryResult.innerHTML = "";
    summaryResult.classList.remove("empty");

    if (parsed.topic) {
      summaryResult.innerHTML +=
        '<div class="summary-card">' +
        '<div class="summary-label">主题</div>' +
        '<div class="summary-value">' + escapeHtml(parsed.topic) + '</div>' +
        '</div>';
    }

    if (parsed.summary) {
      summaryResult.innerHTML +=
        '<div class="summary-card">' +
        '<div class="summary-label">总结</div>' +
        '<div class="summary-value">' + escapeHtml(parsed.summary) + '</div>' +
        '</div>';
    }

    if (parsed.keywords && parsed.keywords.length > 0) {
      var tagsHtml = '';
      for (var i = 0; i < parsed.keywords.length; i++) {
        tagsHtml += '<span class="keyword-tag">' + escapeHtml(parsed.keywords[i]) + '</span>';
      }
      summaryResult.innerHTML +=
        '<div class="summary-card">' +
        '<div class="summary-label">关键词</div>' +
        '<div class="summary-value">' + tagsHtml + '</div>' +
        '</div>';
    }

    if (parsed.sentiment) {
      var badgeClass = parsed.sentiment === "positive" ? "positive" :
        parsed.sentiment === "negative" ? "negative" : "neutral";
      summaryResult.innerHTML +=
        '<div class="summary-card">' +
        '<div class="summary-label">情感倾向</div>' +
        '<div class="summary-value"><span class="sentiment-badge ' + badgeClass + '">' +
        escapeHtml(parsed.sentiment) + '</span></div>' +
        '</div>';
    }

    if (parsed.important_points && parsed.important_points.length > 0) {
      var pointsHtml = '';
      for (var j = 0; j < parsed.important_points.length; j++) {
        pointsHtml += '<div class="point-item">' + escapeHtml(parsed.important_points[j]) + '</div>';
      }
      summaryResult.innerHTML +=
        '<div class="summary-card">' +
        '<div class="summary-label">核心观点</div>' +
        '<div class="summary-value">' + pointsHtml + '</div>' +
        '</div>';
    }

    if (!summaryResult.innerHTML) {
      summaryResult.textContent = JSON.stringify(parsed);
    }

    PopupState.lastParsedData = parsed;
    copyBtn.style.display = "inline-block";
    copyBtn.textContent = "📋 复制";
    copyBtn.className = "";
  },

  /**
   * renderQAResult(parsed, summaryResult, copyBtn)
   */
  renderQAResult: function(parsed, summaryResult, copyBtn) {
    summaryResult.innerHTML = "";
    summaryResult.classList.remove("empty");

    if (parsed.answer) {
      summaryResult.innerHTML +=
        '<div class="summary-card">' +
        '<div class="summary-label">回答</div>' +
        '<div class="summary-value">' + escapeHtml(parsed.answer) + '</div>' +
        '</div>';
    }

    if (!summaryResult.innerHTML) {
      summaryResult.textContent = JSON.stringify(parsed);
    }

    PopupState.lastParsedData = parsed;
    copyBtn.style.display = "inline-block";
    copyBtn.textContent = "📋 复制";
    copyBtn.className = "";
  },

  /**
   * renderTracePanel(tracePanelEl)
   *
   * 渲染 Runtime Trace 时间线。
   * 自动读取 RuntimeTrace.getAll()。
   */
  renderTracePanel: function(tracePanelEl) {
    var logs = RuntimeTrace.getAll();
    if (!logs || !logs.length) {
      tracePanelEl.innerHTML = '<div class="trace-empty">暂无事件</div>';
      return;
    }

    var currentRunId = null;
    var html = "";
    for (var i = 0; i < logs.length; i++) {
      var entry = logs[i];
      var time = new Date(entry.timestamp);
      var timeStr =
        pad2(time.getHours()) + ":" +
        pad2(time.getMinutes()) + ":" +
        pad2(time.getSeconds());

      if (entry.runId && entry.runId !== currentRunId) {
        currentRunId = entry.runId;
        html +=
          '<div class="trace-run-sep">── run: ' + escapeHtml(currentRunId) + ' ──</div>';
      }

      var phaseBadge = "";
      if (entry.phase && entry.phase !== "idle") {
        phaseBadge = ' <span class="trace-status">' + escapeHtml(entry.phase) + '</span>';
      }

      var durationStr = "";
      if (entry.durationMs !== null) {
        durationStr = ' <span class="trace-duration">' + entry.durationMs + "ms</span>";
      }

      var tagClass = "trace-" + entry.type;
      html +=
        '<div class="trace-line">' +
        '<span class="trace-time">[' + timeStr + ']</span> ' +
        '<span class="' + tagClass + '">' + escapeHtml(entry.type) + '</span>' +
        phaseBadge +
        durationStr +
        '</div>';
    }

    tracePanelEl.innerHTML = html;
    tracePanelEl.scrollTop = tracePanelEl.scrollHeight;
  },

  /**
   * renderChatMessage(chatMessagesEl, role, content)
   *
   * 追加单条对话气泡。不替换整体，只 append。
   * content 可以是字符串（纯文本）或数组（Vision 格式）。
   */
  renderChatMessage: function(chatMessagesEl, role, content) {
    var welcomeEl = chatMessagesEl.querySelector(".chat-welcome");
    if (welcomeEl) welcomeEl.remove();

    var bubbleClass = role === "user" ? "chat-bubble user" : "chat-bubble assistant";
    var label = role === "user" ? "你" : "AI";

    var bubble = document.createElement("div");
    bubble.className = bubbleClass;

    var labelDiv = document.createElement("div");
    labelDiv.className = "chat-bubble-label";
    labelDiv.textContent = label;

    var contentDiv = document.createElement("div");
    contentDiv.className = "chat-bubble-content";

    if (Array.isArray(content)) {
      for (var i = 0; i < content.length; i++) {
        var part = content[i];
        if (part.type === "image_url" && part.image_url && part.image_url.url) {
          var img = document.createElement("img");
          img.src = part.image_url.url;
          img.className = "chat-bubble-image";
          contentDiv.appendChild(img);
        } else if (part.type === "text" && part.text) {
          var textNode = document.createTextNode(part.text);
          contentDiv.appendChild(textNode);
        }
      }
    } else {
      contentDiv.textContent = content;
    }

    bubble.appendChild(labelDiv);
    bubble.appendChild(contentDiv);

    chatMessagesEl.appendChild(bubble);
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  },

  /**
   * renderChatHistory(chatMessagesEl, history)
   *
   * 从 chatHistory[] 重建整个对话列表。
   * 跳过前两条（网页上下文注入的隐藏消息）。
   */
  renderChatHistory: function(chatMessagesEl, history) {
    chatMessagesEl.innerHTML = "";

    if (!history || history.length === 0) {
      chatMessagesEl.innerHTML = '<div class="chat-welcome">开始新对话，问我关于当前网页的任何问题</div>';
      return;
    }

    var startIndex = 0;
    if (history.length >= 2
        && history[0].role === "user"
        && typeof history[0].content === "string"
        && history[0].content.indexOf("当前网页内容：") === 0
        && history[1].role === "assistant") {
      startIndex = 2;
    }

    for (var i = startIndex; i < history.length; i++) {
      var msg = history[i];
      PopupRenderer.renderChatMessage(chatMessagesEl, msg.role, msg.content);
    }
  },

  /**
   * renderChatTyping(chatMessagesEl)
   *
   * 显示 AI 正在输入的提示气泡。
   */
  renderChatTyping: function(chatMessagesEl) {
    var existing = chatMessagesEl.querySelector(".chat-typing");
    if (existing) return;

    var typing = document.createElement("div");
    typing.className = "chat-bubble assistant chat-typing";

    var labelDiv = document.createElement("div");
    labelDiv.className = "chat-bubble-label";
    labelDiv.textContent = "AI";

    var contentDiv = document.createElement("div");
    contentDiv.className = "chat-bubble-content";
    contentDiv.textContent = "正在思考...";

    typing.appendChild(labelDiv);
    typing.appendChild(contentDiv);

    chatMessagesEl.appendChild(typing);
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  },

  /**
   * removeChatTyping(chatMessagesEl)
   */
  removeChatTyping: function(chatMessagesEl) {
    var typing = chatMessagesEl.querySelector(".chat-typing");
    if (typing) typing.remove();
  }
};

function pad2(n) {
  return n < 10 ? "0" + n : "" + n;
}
