/**
 * PluginManager — KISEEN 插件生命周期管理
 *
 * 职责：
 *   1. 加载插件清单 → 验证 → 注册 Action
 *   2. 注入 Content Script handler
 *   3. 插件启用/禁用/卸载
 *   4. 查询已安装插件列表
 *
   * 使用方式：
   *   PluginManager.load(manifest, handlerMap, handlerCode)  // 注册 (handlerCode 可选, 用于持久化)
   *   PluginManager.loadFromStorage()          // 从 chrome.storage 恢复
   *   PluginManager.injectHandlersToTab(tabId) // 注入 CS handler 到指定 tab
   *   PluginManager.enable("plugin-name")
   *   PluginManager.disable("plugin-name")
   *   PluginManager.list()                     // 返回所有已注册插件
   */

var PluginManager = {

  _plugins: {},
  _storageKey: "kiseen_plugins",

  /**
   * load(manifest, handlerMap, handlerCode)
   *
   * manifest: 符合 plugin.schema.json 的插件清单对象
   * handlerMap: { actionName: { execute: fn } } — SidePanel 端 action handler
   * handlerCode: 可选，Content Script 端 handler 源码字符串（用于持久化 & 恢复）
   *
   * 返回：{ ok: boolean, error?: string }
   */
  load: function(manifest, handlerMap, handlerCode) {
    if (!manifest || !manifest.name || !manifest.actions) {
      return { ok: false, error: "插件清单不完整：缺少 name 或 actions" };
    }

    var name = manifest.name;
    if (this._plugins[name]) {
      return { ok: false, error: "插件 '" + name + "' 已加载" };
    }

    // === 1. 验证 actions ===
    for (var i = 0; i < manifest.actions.length; i++) {
      var act = manifest.actions[i];
      if (!act.name || !act.parameters) {
        return { ok: false, error: "Action 定义不完整: " + JSON.stringify(act).substring(0, 50) };
      }
      if (ActionRegistry.has(act.name)) {
        return { ok: false, error: "Action '" + act.name + "' 与已有 Action 冲突" };
      }
    }

    // === 2. 注册到 ActionRegistry ===
    for (var j = 0; j < manifest.actions.length; j++) {
      var action = manifest.actions[j];
      ActionRegistry.register(action.name, {
        name: action.name,
        capability: (manifest.capabilities && manifest.capabilities[0]) || "browser_action",
        description: action.description || "",
        parameters: action.parameters,
        safety: action.safety || { cooldownMs: 500, dangerous: false },
        _plugin: name  // 标记来源插件
      });

      // 注册到 BrowserActionDispatcher
      if (handlerMap && handlerMap[action.name]) {
        BrowserActionDispatcher.register(action.name, handlerMap[action.name]);
      }
    }

    // === 3. 记录插件 ===
    this._plugins[name] = {
      manifest: manifest,
      enabled: true,
      loadedAt: Date.now(),
      handlerMap: handlerMap || {},
      _handlerCode: handlerCode || null  // 持久化用
    };

    console.log("[PluginManager] 插件加载成功:", name, manifest.version);
    RuntimeEvents.emit("plugin_loaded", { type: "plugin_loaded", payload: { name: name, version: manifest.version } });
    return { ok: true };
  },

  /**
   * unload(name)
   */
  unload: function(name) {
    var plugin = this._plugins[name];
    if (!plugin) return { ok: false, error: "插件 '" + name + "' 未找到" };

    // 注销所有 Action
    var manifest = plugin.manifest;
    for (var i = 0; i < manifest.actions.length; i++) {
      ActionRegistry.unregister(manifest.actions[i].name);
    }

    delete this._plugins[name];
    console.log("[PluginManager] 插件卸载:", name);
    RuntimeEvents.emit("plugin_unloaded", { type: "plugin_unloaded", payload: { name: name } });
    return { ok: true };
  },

  /**
   * enable(name)
   */
  enable: function(name) {
    var plugin = this._plugins[name];
    if (!plugin) return { ok: false, error: "插件不存在" };
    plugin.enabled = true;
    return { ok: true };
  },

  /**
   * disable(name)
   */
  disable: function(name) {
    var plugin = this._plugins[name];
    if (!plugin) return { ok: false, error: "插件不存在" };
    plugin.enabled = false;
    return { ok: true };
  },

  /**
   * list() → [{ name, version, enabled, actions }]
   */
  list: function() {
    var result = [];
    for (var name in this._plugins) {
      if (this._plugins.hasOwnProperty(name)) {
        var p = this._plugins[name];
        result.push({
          name: name,
          version: p.manifest.version,
          description: p.manifest.description || "",
          enabled: p.enabled,
          actions: (p.manifest.actions || []).map(function(a) { return a.name; }),
          loadedAt: p.loadedAt
        });
      }
    }
    return result;
  },

  /**
   * saveToStorage() — 持久化插件清单 + handler 源码到 chrome.storage
   */
  saveToStorage: async function() {
    var data = {};
    for (var name in this._plugins) {
      if (this._plugins.hasOwnProperty(name)) {
        var p = this._plugins[name];
        if (!p._handlerCode) continue;
        data[name] = {
          manifest: p.manifest,
          handlerCode: p._handlerCode
        };
      }
    }
    var update = {};
    update[this._storageKey] = data;
    await chrome.storage.local.set(update);
  },

  /**
   * loadFromStorage() — 从 chrome.storage 恢复插件（含 handler 源码）
   */
  loadFromStorage: async function(builtinHandlerMap) {
    var stored = await chrome.storage.local.get([this._storageKey]);
    var data = stored[this._storageKey] || {};
    var loaded = 0;

    for (var name in data) {
      if (data.hasOwnProperty(name)) {
        if (this._plugins[name]) continue;
        var entry = data[name];
        var manifest = entry.manifest;
        var handlerCode = entry.handlerCode;

        // 重建 handlerMap
        var handlerMap = builtinHandlerMap && builtinHandlerMap[name];
        if (!handlerMap && handlerCode) {
          handlerMap = this._rebuildHandlerMap(manifest, handlerCode);
        }

        var result = this.load(manifest, handlerMap || {}, handlerCode);
        if (result.ok) loaded++;
      }
    }

    console.log("[PluginManager] 从存储恢复 " + loaded + " 个插件");
    return loaded;
  },

  /**
   * _rebuildHandlerMap(manifest, handlerCode) → SidePanel handler map
   *
   * 从 handler 源码重建 { actionName: { execute: fn } } 映射。
   * 不执行 handler 代码本身（那是 Content Script 的事），
   * 只创建 chrome.tabs.sendMessage 转发器。
   */
  _rebuildHandlerMap: function(manifest, handlerCode) {
    var self = this;
    var handlerMap = {};
    var actions = manifest.actions || [];

    for (var i = 0; i < actions.length; i++) {
      (function(actionName) {
        handlerMap[actionName] = {
          execute: async function(action, context) {
            try {
              var response = await chrome.tabs.sendMessage(context.activeTab.id, {
                type: "browser_action", action: actionName,
                target: action.target || {}, params: action.params || {}
              });
              return response || { success: false, error: "CS 无响应", action: actionName, data: {}, observation: {}, durationMs: 0 };
            } catch (e) {
              return { success: false, error: e.message, action: actionName, data: {}, observation: {}, durationMs: 0 };
            }
          }
        };
      })(actions[i].name);
    }

    return handlerMap;
  },

  /**
   * injectHandlersToTab(tabId) — 将所有已安装插件的 CS handler 注入指定 tab
   *
   * 在 Agent 任务启动前调用，确保运行时安装的插件 handler 在 Content Script 中存在。
   */
  injectHandlersToTab: async function(tabId) {
    if (!tabId) return;
    for (var name in this._plugins) {
      if (!this._plugins.hasOwnProperty(name)) continue;
      var p = this._plugins[name];
      if (!p._handlerCode || !p.enabled) continue;

      var wrapperCode = p._handlerCode + ";\n" +
        "if (typeof pluginHandler !== 'undefined' && typeof ContentRuntime !== 'undefined') {\n" +
        "  for (var k in pluginHandler) {\n" +
        "    if (pluginHandler.hasOwnProperty(k) && typeof pluginHandler[k] === 'function') {\n" +
        "      ContentRuntime.registerHandler(k, pluginHandler[k]);\n" +
        "    }\n" +
        "  }\n" +
        "}\n";
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: new Function(wrapperCode)
        });
      } catch (e) {
        // tab 可能不可注入（chrome:// 页面等）
      }
    }
  }
};
