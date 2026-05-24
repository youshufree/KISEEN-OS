/**
 * toolRegistry.js — Tool 注册表
 *
 * 职责：
 *   1. 声明所有可用 Tool（name / description / parameters / capability / executor）
 *   2. 不负责执行逻辑
 *   3. 新增 Tool 只需在此文件中添加条目
 */

var ToolRegistry = {
  highlight_keywords: {
    name: "highlight_keywords",
    description: "在网页中高亮显示指定的关键词列表",
    capability: "dom_manipulation",
    parameters: {
      keywords: { type: "array", items: "string", description: "要高亮的关键词列表" }
    },
    executor: async function(params, context) {
      if (!context || !context.activeTab || !context.activeTab.id) {
        throw new Error("Tool: 缺少 RuntimeContext.activeTab");
      }
      return chrome.tabs.sendMessage(context.activeTab.id, {
        type: "execute_action",
        action: "highlight_keywords",
        data: params
      });
    }
  }
};
