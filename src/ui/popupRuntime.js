/**
 * popupRuntime.js — Runtime 启动/取消（委托给 RuntimeAPI）
 */
var PopupRuntime = {
  _runTask: async function(template, extras, elements) {
    if (!PopupState.pageContent) {
      if (elements.summaryStatus) {
        elements.summaryStatus.textContent = "没有网页内容";
        elements.summaryStatus.className = "summary-error";
      }
      return;
    }

    PopupControls.showRunningButton(elements.summarizeBtn, elements.cancelBtn, elements.askBtn);

    try {
      var result = await RuntimeAPI.startTask({
        template: template,
        pageContent: PopupState.pageContent,
        question: extras && extras.question ? extras.question : "",
        goal: extras && extras.question ? extras.question : ""
      });
      return result;
    } catch (err) {
      console.error("PopupRuntime: runTask 执行失败", err);
      if (elements.summaryStatus) {
        elements.summaryStatus.textContent = "执行失败：" + (err.message || "未知错误");
        elements.summaryStatus.className = "summary-error";
      }
      PopupControls.showRunButton(elements.summarizeBtn, elements.cancelBtn, elements.askBtn);
    }
  },

  startRuntime: async function(elements) {
    return PopupRuntime._runTask("summarize", {}, elements);
  },

  startQA: async function(elements) {
    var question = elements.questionInput.value.trim();
    if (!question) return;
    PopupState.currentQuestion = question;
    return PopupRuntime._runTask("qa", { question: question }, elements);
  },

  startLoop: async function(elements) {
    var question = elements.questionInput ? elements.questionInput.value.trim() : "";
    return PopupRuntime._runTask("agent", { question: question }, elements);
  },

  startChat: async function(elements) {
    if (PopupState.providerType !== "openclaw" && !PopupState.hasApiKey) {
      if (elements.chatStatus) {
        elements.chatStatus.textContent = "请先设置 API Key";
        elements.chatStatus.className = "summary-error";
      }
      return;
    }

    var userMessage = elements.chatInput.value.trim();
    var imageBase64 = elements.imageBase64 || null;
    var imageMimeType = elements.imageMimeType || null;
    if (!userMessage && !imageBase64) return;

    elements.chatInput.value = "";

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

    PopupRenderer.renderChatMessage(elements.chatMessages, "user", displayContent);

    var lastUserBubble = elements.chatMessages.lastElementChild;

    PopupControls.showChatRunning(elements.chatSendBtn, elements.chatCancelBtn);

    var systemPrompt = PromptTemplates.chat.buildSystem(PopupState.captureMode, PopupState.pageContent);

    try {
      var result = await RuntimeAPI.sendMessage({
        userMessage: userMessage || "请描述这张图片",
        systemPrompt: systemPrompt,
        imageBase64: imageBase64,
        imageMimeType: imageMimeType
      });

      PopupState.chatHistory = result.chatHistory;
      PopupControls.showChatSendButton(elements.chatSendBtn, elements.chatCancelBtn);
    } catch (err) {
      console.error("PopupRuntime: startChat 执行失败", err);
      if (lastUserBubble && lastUserBubble.parentNode === elements.chatMessages) {
        lastUserBubble.remove();
      }
      var welcomeEl = elements.chatMessages.querySelector(".chat-empty");
      if (!welcomeEl && elements.chatMessages.children.length === 0) {
        elements.chatMessages.innerHTML = '<div class="chat-empty">开始提问，与页面对话</div>';
      }
      if (elements.chatStatus) {
        elements.chatStatus.textContent = "发送失败：" + (err.message || "未知错误");
        elements.chatStatus.className = "summary-error";
      }
      PopupControls.showChatSendButton(elements.chatSendBtn, elements.chatCancelBtn);
    }
  },

  clearChat: function(elements) {
    RuntimeAPI.clearChat(elements.url || "");
    PopupState.chatHistory = [];
    if (elements.chatMessages) {
      elements.chatMessages.innerHTML = '<div class="chat-empty">开始提问，与页面对话</div>';
    }
  },

  cancelRuntime: function(elements) {
    RuntimeAPI.stopTask();
    PopupControls.showRunButton(elements.summarizeBtn, elements.cancelBtn, elements.askBtn);
  },

  cancelChat: function(elements) {
    RuntimeAPI.stopTask();
    PopupControls.showChatSendButton(elements.chatSendBtn, elements.chatCancelBtn);
  }
};
