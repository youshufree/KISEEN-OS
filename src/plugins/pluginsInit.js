/**
 * pluginsInit.js — 内置插件自动注册
 *
 * 初始化时加载所有编译到 bundle 中的内置插件。
 * 第三方插件可通过 PluginManager.load() 在运行时加载。
 */

var BuiltinPlugins = {
  init: function() {
    console.log("[Plugins] 初始化内置插件...");

    // === form-autofill 插件 ===
    // 清单（定义在 manifest.json 中，此处为运行时引用）
    var formAutofillManifest = {
      name: "form-autofill",
      version: "1.0.0",
      description: "自动填写/提交表单：fill_form, read_form, submit_form",
      capabilities: ["browser_action"],
      actions: [
        {
          name: "fill_form",
          description: "将键值对映射写入表单（name→value），同时填写所有匹配字段",
          parameters: {
            fields: { type: "object", required: true, description: "字段映射：{ \"字段名\": \"值\" }" }
          },
          safety: { cooldownMs: 1000, dangerous: false, maxPerSession: 50 }
        },
        {
          name: "read_form",
          description: "读取表单中所有输入字段的当前值，返回字段名→值映射",
          parameters: {},
          safety: { cooldownMs: 200, dangerous: false, maxPerSession: 100 }
        },
        {
          name: "submit_form",
          description: "查找并点击表单提交按钮",
          parameters: {
            formSelector: { type: "string", required: false, description: "表单选择器（可选）" }
          },
          safety: { cooldownMs: 1000, dangerous: true, maxPerSession: 10 }
        }
      ],
      contentScript: "fill-form-handler.js"
    };

    // Handler 映射（SidePanel 端：通过 chrome.tabs.sendMessage 转发到 Content Script）
    var formAutofillHandlers = {
      fill_form: {
        execute: async function(action, context) {
          try {
            var response = await chrome.tabs.sendMessage(context.activeTab.id, {
              type: "browser_action", action: "fill_form",
              target: action.target || {}, params: action.params || {}
            });
            return response || { success: false, error: "CS 无响应", action: "fill_form", data: {}, observation: {}, durationMs: 0 };
          } catch (e) {
            return { success: false, error: e.message, action: "fill_form", data: {}, observation: {}, durationMs: 0 };
          }
        }
      },
      read_form: {
        execute: async function(action, context) {
          try {
            var response = await chrome.tabs.sendMessage(context.activeTab.id, {
              type: "browser_action", action: "read_form",
              target: action.target || {}, params: action.params || {}
            });
            return response || { success: false, error: "CS 无响应", action: "read_form", data: {}, observation: {}, durationMs: 0 };
          } catch (e) {
            return { success: false, error: e.message, action: "read_form", data: {}, observation: {}, durationMs: 0 };
          }
        }
      },
      submit_form: {
        execute: async function(action, context) {
          try {
            var response = await chrome.tabs.sendMessage(context.activeTab.id, {
              type: "browser_action", action: "submit_form",
              target: action.target || {}, params: action.params || {}
            });
            return response || { success: false, error: "CS 无响应", action: "submit_form", data: {}, observation: {}, durationMs: 0 };
          } catch (e) {
            return { success: false, error: e.message, action: "submit_form", data: {}, observation: {}, durationMs: 0 };
          }
        }
      }
    };

    // 注册到 sidepanel bundles 的 ActionRegistry + BrowserActionDispatcher
    var result = PluginManager.load(formAutofillManifest, formAutofillHandlers);
    if (result.ok) {
      console.log("[Plugins] form-autofill 加载成功 (3 actions)");
    } else {
      console.warn("[Plugins] form-autofill 加载失败:", result.error);
    }

    console.log("[Plugins] 初始化完成。已加载:", PluginManager.list().length, "个插件");
  }
};
