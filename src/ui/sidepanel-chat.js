/**
 * sidepanel-chat.js — 对话 Tab 逻辑
 *
 * 职责：多轮对话 / 历史加载 / 清空对话
 * 通过 RuntimeAPI 发送消息，不直接调用 ChatRuntime / LLMProvider。
 */
var SidepanelChat = {
  init: function() {
    var self = this;
    self._elements = {
      questionInput: document.getElementById("questionInput"),
      askBtn: document.getElementById("askBtn"),
      chatHistoryEl: document.getElementById("chatHistory"),
      clearChatBtn: document.getElementById("clearChatBtn")
    };

    self._bindEvents();
  },

  _bindEvents: function() {
    var self = this;
    var el = self._elements;

    el.clearChatBtn.addEventListener("click", function() {
      var currentUrl = PopupState.activeTab ? PopupState.activeTab.url : "";
      RuntimeAPI.clearChat(currentUrl);
      el.chatHistoryEl.innerHTML = '<div class="chat-empty">开始提问，与页面对话</div>';
    });
  },

  sendMessage: async function() {
    var el = this._elements;
    var userMessage = el.questionInput.value.trim();
    var image = SidepanelImages.getPendingImage();
    var imageBase64 = image.base64;
    var imageMimeType = image.mimeType;

    if (!userMessage && !imageBase64) return;

    el.questionInput.value = "";
    el.askBtn.disabled = true;
    el.askBtn.textContent = "发送中...";

    var displayContent;
    if (imageBase64) {
      displayContent = [
        {
          type: "image_url",
          image_url: { url: "data:" + (imageMimeType || "image/jpeg") + ";base64," + imageBase64 }
        },
        { type: "text", text: userMessage || "请描述这张图片" }
      ];
    } else {
      displayContent = userMessage;
    }

    PopupRenderer.renderChatMessage(el.chatHistoryEl, "user", displayContent);

    var systemPrompt = PromptTemplates.chat.buildSystem(PopupState.captureMode, PopupState.pageContent);

    try {
      var result = await RuntimeAPI.sendMessage({
        userMessage: userMessage || "请描述这张图片",
        systemPrompt: systemPrompt,
        imageBase64: imageBase64,
        imageMimeType: imageMimeType
      });

      PopupState.chatHistory = result.chatHistory;

      if (result && result.content) {
        PopupRenderer.renderChatMessage(el.chatHistoryEl, "assistant", result.content);
      }
    } catch (err) {
      console.error("SidepanelChat: 发送失败", err);
      var errorText = err.message || "未知错误";
      PopupRenderer.renderChatMessage(el.chatHistoryEl, "assistant", "发送失败: " + errorText);
    } finally {
      el.askBtn.disabled = false;
      el.askBtn.textContent = "发送";
    }
  },

  loadHistory: async function() {
    var url = PopupState.activeTab ? PopupState.activeTab.url : "";
    if (!url) return;

    try {
      var history = await RuntimeAPI.loadChatHistory(url);
      var chatHistoryEl = this._elements.chatHistoryEl;
      chatHistoryEl.innerHTML = "";
      if (history && history.length > 0) {
        for (var i = 0; i < history.length; i++) {
          var msg = history[i];
          if (msg.role === "user" || msg.role === "assistant") {
            PopupRenderer.renderChatMessage(chatHistoryEl, msg.role, msg.content);
          }
        }
        chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;
      } else {
        chatHistoryEl.innerHTML = '<div class="chat-empty">开始提问，与页面对话</div>';
      }
    } catch (e) {
      console.warn("SidepanelChat: 加载对话历史失败", e);
    }
  }
};
