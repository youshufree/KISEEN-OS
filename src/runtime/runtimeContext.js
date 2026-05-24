/**
 * runtimeContext.js — RuntimeContext 标准化 Schema
 *
 * 职责：
 *   1. 定义 RuntimeContext 标准字段和默认值
 *   2. normalize() 统一补充缺省字段
 *   3. validate() 检查必填字段
 *   4. 所有模块应通过此函数构造/规范化 context，不再随意拼装
 *
 * RuntimeContext 标准字段：
 *   activeTab      chrome.tabs.Tab   (必填) Agent 操作的目标标签页
 *   apiKey         string            LLM API Key
 *   providerType   string             "deepseek" | "openclaw"
 *   pageContent    string             当前页面的文本内容
 *   mode           string             抓取模式: "content" | "full" | "visual"
 *   goal           string             当前任务目标
 *   question       string             用户问题 (QA/总结模式)
 *   template       string             模板名: "summarize" | "qa" | "agent"
 *   browserMemory  object|null        BrowserMemory.getContext() 的快照
 */

var RUNTIME_CONTEXT_DEFAULTS = {
  activeTab: null,
  apiKey: "",
  providerType: "deepseek",
  pageContent: "",
  mode: "content",
  goal: "",
  question: "",
  template: "",
  browserMemory: null
};

var RuntimeContext = {
  /**
   * normalize(partial)
   *
   * 接收任意形式的 context 片段，返回完整的标准化 RuntimeContext。
   * 缺失字段用默认值填充。
   */
  normalize: function(partial) {
    partial = partial || {};
    var ctx = {};

    for (var key in RUNTIME_CONTEXT_DEFAULTS) {
      if (RUNTIME_CONTEXT_DEFAULTS.hasOwnProperty(key)) {
        ctx[key] = (partial[key] !== undefined && partial[key] !== null)
          ? partial[key]
          : RUNTIME_CONTEXT_DEFAULTS[key];
      }
    }

    return ctx;
  },

  /**
   * validate(ctx)
   *
   * 检查必填字段。返回 { valid: boolean, missing: string[] }
   */
  validate: function(ctx) {
    var required = ["activeTab"];
    var missing = [];

    for (var i = 0; i < required.length; i++) {
      if (!ctx || !ctx[required[i]]) {
        missing.push(required[i]);
      }
    }

    return {
      valid: missing.length === 0,
      missing: missing
    };
  },

  /**
   * fromTab(tab, overrides)
   *
   * 从 chrome.tabs.Tab 创建 RuntimeContext 的便捷方法。
   */
  fromTab: function(tab, overrides) {
    overrides = overrides || {};
    return this.normalize({
      activeTab: tab,
      apiKey: overrides.apiKey || "",
      providerType: overrides.providerType || "deepseek",
      pageContent: overrides.pageContent || "",
      mode: overrides.mode || "content",
      goal: overrides.goal || "",
      question: overrides.question || "",
      template: overrides.template || ""
    });
  },

  /**
   * injectMemory(ctx, url)
   *
   * 将 BrowserMemory 上下文注入到 RuntimeContext 中。
   * 返回增强后的 ctx（会修改原对象）。
   */
  injectMemory: function(ctx, url) {
    if (!ctx) return ctx;
    ctx.browserMemory = BrowserMemory.getContext(url);
    return ctx;
  }
};