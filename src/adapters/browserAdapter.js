/**
 * browserAdapter.js — 浏览器环境适配器
 *
 * 实现 EnvironmentHAL 接口，封装所有浏览器/Chrome API 调用。
 * Runtime Core 通过此适配器操作浏览器，不直接调用 chrome.* API。
 *
 * 注意：此适配器使用现有的基础设施（ObservationFetcher、ObservationBuilder、
 * BrowserActionDispatcher、SelectorValidator 等），仅作为统一入口。
 */
var BrowserAdapter = {

  _type: "browser",

  /**
   * perceive() — 感知浏览器页面状态
   *
   * 复用 ObservationFetcher.fetch() + ObservationBuilder.build()
   */
  perceive: async function(context) {
    try {
      var snapshot = await ObservationFetcher.fetch(context);
      if (snapshot) {
        var observation = ObservationBuilder.build(snapshot, context);
        return {
          type: this._type,
          url: observation.pageMeta && observation.pageMeta.url ? observation.pageMeta.url : "",
          title: observation.pageMeta && observation.pageMeta.title ? observation.pageMeta.title : "",
          pageType: observation.pageType || "unknown",
          pageMeta: observation.pageMeta || {},
          interactiveElements: observation.interactiveElements || [],
          suggestedActions: observation.availableActions || [],
          summary: observation.summary || "",
          observationText: observation.observationText || ""
        };
      }
    } catch (e) {
      console.warn("[BrowserAdapter] perceive 失败:", e.message);
    }

    return {
      type: this._type,
      url: "",
      title: "",
      pageType: "unknown",
      pageMeta: {},
      interactiveElements: [],
      suggestedActions: [],
      summary: "无法感知页面状态",
      observationText: ""
    };
  },

  /**
   * execute(action, context) — 执行浏览器动作
   *
   * 复用 BrowserActionDispatcher.execute()
   */
  execute: async function(action, context) {
    var result = await BrowserActionDispatcher.execute(action, context);
    return result;
  },

  /**
   * getContext(context) — 获取浏览器上下文
   */
  getContext: async function(context) {
    var activeTab = context && context.activeTab;
    if (!activeTab) {
      try {
        var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        activeTab = tabs[0];
      } catch (e) {
        activeTab = null;
      }
    }

    return {
      type: this._type,
      tabId: activeTab && activeTab.id ? activeTab.id : null,
      url: activeTab && activeTab.url ? activeTab.url : null,
      title: activeTab && activeTab.title ? activeTab.title : null,
      capabilities: this.getCapabilities()
    };
  },

  /**
   * validateSelector(selector, tabId) — 验证选择器
   *
   * 复用 SelectorValidator.validate()
   */
  validateSelector: async function(selector, tabId) {
    return await SelectorValidator.validate(selector, tabId);
  },

  /**
   * validateTarget(target, tabId) — 验证 target 对象
   *
   * 复用 SelectorValidator.validateTarget()
   */
  validateTarget: async function(target, tabId) {
    return await SelectorValidator.validateTarget(target, tabId);
  },

  /**
   * extractContent(action, context) — 提取页面内容
   */
  extractContent: async function(action, context) {
    return await this.execute(action, context);
  },

  /**
   * getCapabilities() — 返回浏览器支持的操作能力
   */
  getCapabilities: function() {
    return BrowserActionDispatcher.getRegisteredTypes();
  },

  /**
   * getType() — 返回环境类型
   */
  getType: function() {
    return this._type;
  }
};
