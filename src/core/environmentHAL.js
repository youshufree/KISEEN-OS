/**
 * environmentHAL.js — Environment Hardware Abstraction Layer
 *
 * 核心理念：
 *   所有环境相关操作（感知、执行、验证、提取）都通过此接口进行。
 *   不同环境（浏览器、桌面、CLI、移动端）各自实现此接口。
 *
 * Runtime Core 只依赖此接口，不直接调用 Chrome API 或 DOM API。
 *
 * 使用方式：
 *   var env = EnvironmentManager.getCurrent();
 *   var state = await env.perceive();        // 感知环境状态
 *   var result = await env.execute(action);  // 执行动作
 *   var selResult = await env.validateSelector(sel, tabId); // 验证选择器
 *   var ctx = await env.getContext();        // 获取环境上下文
 *
 * 环境状态结构：
 *   EnvironmentState = {
 *     type: "browser" | "desktop" | "cli",
 *     url: string,
 *     title: string,
 *     pageType: string,        // article | form | list | dashboard | chat
 *     pageMeta: object,
 *     interactiveElements: [], // 页面上可交互的元素列表
 *     suggestedActions: [],    // 建议的下一步操作
 *     summary: string          // 语义摘要
 *   }
 *
 * 动作结果结构：
 *   ActionResult = {
 *     success: boolean,
 *     action: string,
 *     error: string | null,
 *     data: object,
 *     observation: object,
 *     durationMs: number,
 *     errorCategory: string | null
 *   }
 *
 * 环境上下文结构：
 *   EnvironmentContext = {
 *     type: string,
 *     tabId: number | null,
 *     url: string | null,
 *     title: string | null,
 *     capabilities: string[]   // 当前环境支持的操作能力
 *   }
 *
 * 验证结果结构：
 *   ValidationResult = {
 *     valid: boolean,
 *     reason: string | null,
 *     suggestion: { selector?, text? } | null
 *   }
 */

var EnvironmentHAL = {
  /**
   * 感知环境状态
   *
   * 职责：获取当前环境的完整状态快照。
   * 浏览器环境：获取页面 URL、可交互元素、页面类型等
   * 桌面环境：获取当前窗口标题、可操作控件等
   *
   * @returns {Promise<EnvironmentState>}
   */
  perceive: async function() {
    throw new Error("EnvironmentHAL.perceive: 未实现，请使用具体适配器");
  },

  /**
   * 执行动作
   *
   * 职责：在环境中执行一个动作（点击、输入、滚动等）。
   *
   * @param {object} action - { type, target, params, metadata }
   * @param {object} context - RuntimeContext（可选，某些适配器需要）
   * @returns {Promise<ActionResult>}
   */
  execute: async function(action, context) {
    throw new Error("EnvironmentHAL.execute: 未实现，请使用具体适配器");
  },

  /**
   * 获取环境上下文
   *
   * 职责：获取当前环境的元信息（标签页 ID、URL、支持的能力等）。
   *
   * @param {object} context - RuntimeContext（可选）
   * @returns {Promise<EnvironmentContext>}
   */
  getContext: async function(context) {
    throw new Error("EnvironmentHAL.getContext: 未实现，请使用具体适配器");
  },

  /**
   * 验证选择器
   *
   * 职责：在执行动作前验证选择器在当前环境中是否可用。
   *
   * @param {string} selector - CSS 选择器
   * @param {number} tabId - 标签页 ID（浏览器特有，其他环境可忽略）
   * @returns {Promise<ValidationResult>}
   */
  validateSelector: async function(selector, tabId) {
    throw new Error("EnvironmentHAL.validateSelector: 未实现，请使用具体适配器");
  },

  /**
   * 验证完整 target 对象
   *
   * @param {object} target - { selector?, text? }
   * @param {number} tabId - 标签页 ID
   * @returns {Promise<ValidationResult>}
   */
  validateTarget: async function(target, tabId) {
    throw new Error("EnvironmentHAL.validateTarget: 未实现，请使用具体适配器");
  },

  /**
   * 提取内容
   *
   * 职责：从环境中提取指定区域的内容。
   *
   * @param {object} action - extract 动作 { type, target, params }
   * @param {object} context - RuntimeContext
   * @returns {Promise<ActionResult>}
   */
  extractContent: async function(action, context) {
    throw new Error("EnvironmentHAL.extractContent: 未实现，请使用具体适配器");
  },

  /**
   * 获取当前环境的能力声明
   *
   * 返回：string[] — 如 ["click", "input", "scroll", "extract", "navigate", ...]
   */
  getCapabilities: function() {
    throw new Error("EnvironmentHAL.getCapabilities: 未实现，请使用具体适配器");
  },

  /**
   * 获取环境类型标识
   *
   * @returns {string} "browser" | "desktop" | "cli" | "mobile"
   */
  getType: function() {
    throw new Error("EnvironmentHAL.getType: 未实现，请使用具体适配器");
  }
};
