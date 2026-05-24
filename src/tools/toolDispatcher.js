/**
 * toolDispatcher.js — Tool 执行分发器 + Action 兼容层
 *
 * 职责：
 *   1. 根据 toolName 查找 ToolRegistry 中的定义
 *   2. 执行 executor，返回统一 Result Schema
 *   3. 提供 getDefinitions / has / getByCapability / getCapabilities 查询
 *   4. 兼容旧 ActionDispatcher API（getActionNames / execute）
 *
 * 依赖：ToolRegistry（由 toolRegistry.js 定义）
 */

var ToolDispatcher = {
  execute: async function(toolName, params, context) {
    var startedAt = Date.now();
    var tool = ToolRegistry[toolName];
    if (!tool) {
      console.warn("ToolDispatcher: 未知工具", toolName);
      return {
        success: false,
        tool: toolName,
        data: null,
        error: "未知工具: " + toolName,
        durationMs: Date.now() - startedAt
      };
    }
    try {
      var result = await tool.executor(params, context);
      if (result && typeof result === "object") {
        result.tool = result.tool || toolName;
        result.durationMs = result.durationMs || (Date.now() - startedAt);
        return result;
      }
      return {
        success: true,
        tool: toolName,
        data: result,
        error: null,
        durationMs: Date.now() - startedAt
      };
    } catch (err) {
      console.error("ToolDispatcher: 执行失败", toolName, err);
      return {
        success: false,
        tool: toolName,
        data: null,
        error: err.message,
        durationMs: Date.now() - startedAt
      };
    }
  },

  getDefinitions: function() {
    return Object.values(ToolRegistry).map(function(t) {
      return { name: t.name, description: t.description, parameters: t.parameters, capability: t.capability };
    });
  },

  has: function(toolName) {
    return toolName in ToolRegistry;
  },

  getByCapability: function(capability) {
    var results = [];
    for (var name in ToolRegistry) {
      if (ToolRegistry.hasOwnProperty(name) && ToolRegistry[name].capability === capability) {
        results.push(ToolRegistry[name]);
      }
    }
    return results;
  },

  getCapabilities: function() {
    var caps = {};
    for (var name in ToolRegistry) {
      if (ToolRegistry.hasOwnProperty(name)) {
        var cap = ToolRegistry[name].capability;
        if (cap) {
          if (!caps[cap]) caps[cap] = [];
          caps[cap].push(name);
        }
      }
    }
    return caps;
  }
};

// ==========================================
//   ToolActionMapping — Action → Tool 映射表
//   兼容旧 ActionDispatcher API（getActionNames / execute）
// ==========================================

var ToolActionMapping = {
  highlight_keywords: {
    name: "highlight_keywords",
    label: "高亮关键词",
    tool: "highlight_keywords",
    validate: function(data) {
      return data && Array.isArray(data.keywords) && data.keywords.length > 0;
    },
    normalize: function(data) {
      return { keywords: data.keywords || [] };
    }
  },
  none: {
    name: "none",
    label: "无操作",
    tool: null,
    validate: function() { return true; },
    normalize: function() { return null; }
  }
};

var ActionDispatcher = {
  get: function(actionName) {
    return ToolActionMapping[actionName] || null;
  },

  exists: function(actionName) {
    return actionName in ToolActionMapping;
  },

  execute: async function(actionName, data, context) {
    var action = ToolActionMapping[actionName];
    if (!action) {
      console.warn("ActionDispatcher: 未知 action", actionName);
      return { success: false, error: "未知 action: " + actionName };
    }
    if (action.name === "none") return { success: true };

    if (!action.validate(data)) {
      console.warn("ActionDispatcher: 参数校验失败", actionName, data);
      return { success: false, error: "参数校验失败" };
    }

    var params = action.normalize(data);
    return ToolDispatcher.execute(action.tool, params, context);
  },

  getActionNames: function() {
    return Object.values(ToolActionMapping)
      .filter(function(a) { return a.name !== "none"; })
      .map(function(a) { return a.name; });
  }
};
