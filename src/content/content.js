/**
 * content.js - 消息路由层
 *
 * 职责：
 *   1. 接收 popup 消息，路由到对应处理器
 *   2. 不包含任何 DOM 操作逻辑
 *   3. 不包含 switch-case 分发 Action/Tool
 *
 * DOM 操作 → contentRuntime.js
 * 内容提取 → contentProcessor.js
 */

// ========== 注册插件 Content Script handlers ==========
(function registerPluginHandlers() {
  if (typeof FormAutofillPlugin !== "undefined") {
    ContentRuntime.registerHandler("fill_form", function(target, params) {
      return FormAutofillPlugin.execute({ type: "fill_form", params: params });
    });
    ContentRuntime.registerHandler("read_form", function(target, params) {
      return FormAutofillPlugin.execute({ type: "read_form", params: params });
    });
    ContentRuntime.registerHandler("submit_form", function(target, params) {
      return FormAutofillPlugin.execute({ type: "submit_form", params: params });
    });
    console.log("[Plugins] Content Script: form-autofill 已注册 (3 handlers)");
  }
})();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getPageContent") {
    var pageTitle = document.title;
    var mode = request.mode || "content";

    var rawText = document.body.innerText || "";
    var rawLength = rawText.length;

    var cleanText = ContentProcessor.extract(mode);
    var cleanLength = cleanText.length;

    var preview;
    if (mode === "visual") {
      try {
        var parsed = JSON.parse(cleanText);
        preview = "图片数量: " + parsed.length;
      } catch (e) {
        preview = cleanText.substring(0, 600);
      }
    } else {
      preview = cleanText.substring(0, 600);
    }

    console.log("===== ContentProcessor 调试信息 =====");
    console.log("当前模式:", mode);
    console.log("原始长度:", rawLength);
    console.log("清洗后长度:", cleanLength);
    console.log("缩减比例:", rawLength > 0
      ? (100 - Math.round(cleanLength / rawLength * 100)) + "%"
      : "N/A");
    console.log("最终发送内容(前200字):", cleanText.slice(0, 200));

    sendResponse({
      title: pageTitle,
      preview: preview,
      fullText: cleanText,
      totalLength: cleanLength,
      rawLength: rawLength,
      mode: mode
    });
    return true;
  }

  if (request.action === "getObservation") {
    var snapshot = ContentObserver.buildObservation();
    sendResponse({
      snapshot: snapshot
    });
    return true;
  }

  if (request.type === "execute_action") {
    var result = ContentRuntime.execute(request.action, request.data);
    sendResponse(result);
    return true;
  }

  if (request.type === "browser_action") {
    ContentRuntime.handleBrowserAction(request.action, request.target, request.params)
      .then(function(result) {
        sendResponse(result);
      })
      .catch(function(err) {
        sendResponse({
          success: false,
          error: "执行异常: " + err.message,
          data: {},
          observation: {},
          durationMs: 0
        });
      });
    return true;
  }

  if (request.action === "getPageState") {
    var state = ContentRuntime.getPageState();
    sendResponse(state);
    return true;
  }
});
