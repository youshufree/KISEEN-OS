/**
 * sidepanel-config.js — Provider 配置模块
 *
 * 职责：Provider 切换 / API Key 保存 / OpenClaw Endpoint 管理 / 连接测试
 * 所有 UI 层 Provider 操作集中在此。
 */
var SidepanelConfig = {
  init: async function() {
    var self = this;
    self._elements = {
      settingsToggle: document.getElementById("settingsToggle"),
      settingsPanel: document.getElementById("settingsPanel"),
      apiKeyInput: document.getElementById("apiKeyInput"),
      saveKeyBtn: document.getElementById("saveKeyBtn"),
      apiStatus: document.getElementById("apiStatus"),
      openclawEndpointInput: document.getElementById("openclawEndpointInput"),
      saveEndpointBtn: document.getElementById("saveEndpointBtn"),
      openclawConnectionStatus: document.getElementById("openclawConnectionStatus"),
      testConnectionBtn: document.getElementById("testConnectionBtn"),
      deepseekConfig: document.getElementById("deepseekConfig"),
      openclawConfig: document.getElementById("openclawConfig"),
      summarizeBtn: document.getElementById("summarizeBtn"),
      askBtn: document.getElementById("askBtn"),
      agentRunBtn: document.getElementById("agentRunBtn"),
      // 插件管理
      pluginList: document.getElementById("pluginList"),
      pluginDropZone: document.getElementById("pluginDropZone"),
      pluginFileInput: document.getElementById("pluginFileInput"),
      pluginDropStatus: document.getElementById("pluginDropStatus"),
      pluginInstallBtn: document.getElementById("pluginInstallBtn"),
      pluginInstallName: document.getElementById("pluginInstallName"),
      pluginInstallManifest: document.getElementById("pluginInstallManifest"),
      pluginInstallHandler: document.getElementById("pluginInstallHandler"),
      pluginInstallStatus: document.getElementById("pluginInstallStatus")
    };

    var storedData = await chrome.storage.sync.get(["providerType", "deepseekApiKey", "openclawEndpoint"]);
    var providerType = storedData.providerType || "deepseek";
    self._savedApiKey = storedData.deepseekApiKey || "";
    self._savedEndpoint = storedData.openclawEndpoint || "http://localhost:18789/hooks/agent";

    PopupState.providerType = providerType;
    PopupState.openclawEndpoint = self._savedEndpoint;

    if (providerType === "deepseek") {
      if (self._savedApiKey) {
        self._elements.apiKeyInput.value = self._savedApiKey;
        self._elements.apiStatus.textContent = "✓ API Key 已保存";
        self._elements.apiStatus.className = "api-status saved";
      }
      PopupState.hasApiKey = !!self._savedApiKey;
    } else {
      self._elements.openclawEndpointInput.value = self._savedEndpoint;
      PopupState.hasApiKey = true;
    }

    self._applyProviderUI(providerType);
    self._applyProviderState(providerType, true);

    self._bindEvents();

    // 渲染插件列表 + 绑定插件事件
    self._renderPluginList();
    self._bindPluginEvents();
    self._bindPluginDropEvents();

    if (providerType === 'openclaw') {
      setTimeout(async function() {
        try {
          var result = await RuntimeAPI.testConnection();
          if (!result.ok && self._elements && self._elements.openclawConnectionStatus) {
            self._elements.openclawConnectionStatus.textContent = '\u2717 \u670D\u52A1\u672A\u8FDE\u63A5 \u2014 \u8BF7\u542F\u52A8\u672C\u5730 OpenClaw \u6216\u5207\u6362\u5230 DeepSeek';
            self._elements.openclawConnectionStatus.className = 'connection-status disconnected';
          }
        } catch (e) {}
      }, 1500);
    }
  },

  _applyProviderUI: function(type) {
    var el = this._elements;
    var providerBtns = document.querySelectorAll(".provider-btn");
    for (var i = 0; i < providerBtns.length; i++) {
      providerBtns[i].classList.toggle("active", providerBtns[i].getAttribute("data-provider") === type);
    }
    if (type === "deepseek") {
      el.deepseekConfig.style.display = "block";
      el.openclawConfig.style.display = "none";
    } else {
      el.deepseekConfig.style.display = "none";
      el.openclawConfig.style.display = "block";
    }
  },

  _applyProviderState: function(type, isInit) {
    var el = this._elements;
    var self = this;
    PopupState.providerType = type;

    var apiKey = isInit ? (self._savedApiKey || "") : el.apiKeyInput.value.trim();
    var endpoint = self._savedEndpoint || "http://localhost:18789/hooks/agent";

    RuntimeAPI.configure({
      providerType: type,
      apiKey: apiKey,
      openclawEndpoint: endpoint
    });

    if (type === "deepseek") {
      PopupState.hasApiKey = !!apiKey;
    } else {
      PopupState.hasApiKey = true;
    }
    PopupRenderer.updateSummarizeButton(el.summarizeBtn, el.askBtn);
    AgentModeController.updateRunButton();
    self._applyCapabilityUI();
  },

  _applyCapabilityUI: function() {
    var caps = RuntimeAPI.getProviderCapabilities();
    var hasVision = caps && caps.vision;

    var screenshotBtn = document.getElementById("screenshotBtn");
    var uploadImageBtn = document.getElementById("uploadImageBtn");

    if (screenshotBtn) screenshotBtn.style.display = hasVision ? "" : "none";
    if (uploadImageBtn) uploadImageBtn.style.display = hasVision ? "" : "none";

    if (!hasVision && SidepanelImages._elements) {
      SidepanelImages.clear();
    }
  },

  _bindEvents: function() {
    var self = this;
    var el = self._elements;

    el.settingsToggle.addEventListener("click", function() {
      var isVisible = el.settingsPanel.style.display !== "none";
      el.settingsPanel.style.display = isVisible ? "none" : "block";
      el.settingsToggle.classList.toggle("active", !isVisible);
    });

    el.saveKeyBtn.addEventListener("click", async function() {
      var key = el.apiKeyInput.value.trim();
      if (!key) {
        el.apiStatus.textContent = "请输入 API Key";
        el.apiStatus.className = "api-status missing";
        PopupState.hasApiKey = false;
        PopupRenderer.updateSummarizeButton(el.summarizeBtn, el.askBtn);
        return;
      }
      await chrome.storage.sync.set({ deepseekApiKey: key });
      RuntimeAPI.configure({ apiKey: key });
      PopupState.hasApiKey = true;
      el.apiStatus.textContent = "✓ API Key 已保存";
      el.apiStatus.className = "api-status saved";
      PopupRenderer.updateSummarizeButton(el.summarizeBtn, el.askBtn);
      AgentModeController.updateRunButton();
    });

    var providerBtns = document.querySelectorAll(".provider-btn");
    for (var p = 0; p < providerBtns.length; p++) {
      providerBtns[p].addEventListener("click", async function() {
        var type = this.getAttribute("data-provider");
        if (type === PopupState.providerType) return;
        await chrome.storage.sync.set({ providerType: type });
        self._applyProviderUI(type);
        self._applyProviderState(type);
      });
    }

    el.saveEndpointBtn.addEventListener("click", async function() {
      var endpoint = el.openclawEndpointInput.value.trim();
      if (!endpoint) {
        el.openclawConnectionStatus.textContent = "请输入 Endpoint 地址";
        el.openclawConnectionStatus.className = "connection-status disconnected";
        return;
      }
      await chrome.storage.sync.set({ openclawEndpoint: endpoint });
      PopupState.openclawEndpoint = endpoint;
      RuntimeAPI.configure({ openclawEndpoint: endpoint });
      el.openclawConnectionStatus.textContent = "✓ Endpoint 已保存";
      el.openclawConnectionStatus.className = "connection-status connected";
    });

    el.testConnectionBtn.addEventListener("click", async function() {
      var endpoint = el.openclawEndpointInput.value.trim() || "http://localhost:18789/hooks/agent";
      RuntimeAPI.configure({ openclawEndpoint: endpoint });
      el.openclawConnectionStatus.textContent = "连接中...";
      el.openclawConnectionStatus.className = "connection-status connecting";
      el.testConnectionBtn.disabled = true;
      try {
        var result = await RuntimeAPI.testConnection();
        if (result.ok) {
          el.openclawConnectionStatus.textContent = result.message;
          el.openclawConnectionStatus.className = "connection-status connected";
        } else {
          el.openclawConnectionStatus.textContent = "✗ " + result.message;
          el.openclawConnectionStatus.className = "connection-status disconnected";
        }
      } catch (err) {
        el.openclawConnectionStatus.textContent = "✗ 连接失败：" + err.message;
        el.openclawConnectionStatus.className = "connection-status disconnected";
      }
      el.testConnectionBtn.disabled = false;
    });

    var clearMemoryBtn = document.getElementById("clearMemoryBtn");
    if (clearMemoryBtn) {
      clearMemoryBtn.addEventListener("click", async function() {
        if (!confirm("确定要清空所有记忆数据吗？这将移除对话历史、浏览记忆和运行日志。")) return;
        try {
          await BrowserMemory.clear();
          await ChatMemory.clearAll();
          await new Promise(function(r) { chrome.storage.local.remove(["runtimeTraces"], r); });
          alert("所有记忆数据已清空");
        } catch (e) {
          alert("清理失败：" + e.message);
        }
      });
    }
  },

  // ==========================================
  //   插件管理
  // ==========================================

  /**
   * _renderPluginList() — 渲染已安装插件
   */
  _renderPluginList: function() {
    var el = this._elements;
    if (!el.pluginList) return;
    var plugins = PluginManager.list();

    if (plugins.length === 0) {
      el.pluginList.innerHTML = '<div style="color:#999; padding:4px 0;">暂无插件，点击下方「安装新插件」添加</div>';
      return;
    }

    var html = "";
    for (var i = 0; i < plugins.length; i++) {
      var p = plugins[i];
      var statusColor = p.enabled ? "#10b981" : "#ef4444";
      html += [
        '<div class="plugin-item" style="padding:6px 0; border-bottom:1px solid #e8e8e8;">',
        '  <div style="display:flex; align-items:center; justify-content:space-between;">',
        '    <span>',
        '      <span style="color:' + statusColor + '; margin-right:4px;">' + (p.enabled ? "✅" : "⛔") + '</span>',
        '      <strong>' + p.name + '</strong>',
        '      <span style="color:#999;"> v' + p.version + '</span>',
        '    </span>',
        '    <span>',
        '      <button class="plugin-toggle-btn" data-plugin="' + p.name + '" style="font-size:10px; padding:2px 6px; margin-right:2px;">' + (p.enabled ? "禁用" : "启用") + '</button>',
        '      <button class="plugin-unload-btn" data-plugin="' + p.name + '" style="font-size:10px; padding:2px 6px; color:#e74c3c;">卸载</button>',
        '    </span>',
        '  </div>',
        '  <div style="color:#888; font-size:11px; margin-top:2px;">' + p.actions.length + ' actions: ' + p.actions.join(", ") + '</div>',
        '</div>'
      ].join("");
    }
    el.pluginList.innerHTML = html;
  },

  /**
   * _bindPluginEvents() — 绑定插件按钮事件
   */
  _bindPluginEvents: function() {
    var self = this;
    var el = self._elements;

    // 委托事件：启用/禁用
    el.pluginList.addEventListener("click", async function(e) {
      var btn = e.target.closest("button");
      if (!btn) return;
      var pluginName = btn.getAttribute("data-plugin");

      if (btn.classList.contains("plugin-toggle-btn")) {
        var plugins = PluginManager.list();
        var plug = null;
        for (var i = 0; i < plugins.length; i++) { if (plugins[i].name === pluginName) { plug = plugins[i]; break; } }
        if (!plug) return;
        if (plug.enabled) {
          PluginManager.disable(pluginName);
        } else {
          PluginManager.enable(pluginName);
        }
        self._renderPluginList();
        PluginManager.saveToStorage();
        return;
      }

      if (btn.classList.contains("plugin-unload-btn")) {
        if (!confirm("确定卸载插件 '" + pluginName + "' 吗？")) return;
        PluginManager.unload(pluginName);
        self._renderPluginList();
        PluginManager.saveToStorage();
        return;
      }
    });

    // 安装按钮
    el.pluginInstallBtn.addEventListener("click", async function() {
      var name = el.pluginInstallName.value.trim();
      var manifestText = el.pluginInstallManifest.value.trim();
      var handlerText = el.pluginInstallHandler.value.trim();

      if (!name) { el.pluginInstallStatus.textContent = "错误: 请输入插件名称"; return; }
      if (!manifestText) { el.pluginInstallStatus.textContent = "错误: 请输入 JSON 清单"; return; }

      var manifest;
      try {
        manifest = JSON.parse(manifestText);
        manifest.name = manifest.name || name;
      } catch (e) {
        el.pluginInstallStatus.textContent = "错误: JSON 清单格式无效 - " + e.message;
        return;
      }

      if (!manifest.actions || manifest.actions.length === 0) {
        el.pluginInstallStatus.textContent = "错误: 清单中缺少 actions 定义";
        return;
      }

      // 解析 handler
      var handlerMap = {};
      if (handlerText) {
        try {
          var handlerObj = (new Function("return " + handlerText))();
          if (typeof handlerObj !== "object") throw new Error("handler 必须返回对象");
          // 为每个 action 创建 chrome.tabs.sendMessage 代理
          for (var a = 0; a < manifest.actions.length; a++) {
            var actName = manifest.actions[a].name;
            if (handlerObj[actName]) {
              (function(an) {
                handlerMap[an] = {
                  execute: async function(action, context) {
                    try {
                      var response = await chrome.tabs.sendMessage(context.activeTab.id, {
                        type: "browser_action", action: an,
                        target: action.target || {}, params: action.params || {}
                      });
                      return response || { success: false, error: "CS 无响应", action: an, data: {}, observation: {}, durationMs: 0 };
                    } catch (e2) {
                      return { success: false, error: e2.message, action: an, data: {}, observation: {}, durationMs: 0 };
                    }
                  }
                };
              })(actName);
            }
          }
        } catch (e) {
          el.pluginInstallStatus.textContent = "错误: Handler JS 解析失败 - " + e.message;
          return;
        }

        // 注入 Content Script handler
      var handlerNames = manifest.actions.map(function(a) { return a.name; });
      try {
        var csCode = handlerText + ";\n" +
          "// Auto-register with ContentRuntime\n" +
          "if (typeof ContentRuntime !== 'undefined' && typeof pluginHandler !== 'undefined') {\n" +
          "  var names = " + JSON.stringify(handlerNames) + ";\n" +
          "  for (var n = 0; n < names.length; n++) {\n" +
          "    if (typeof pluginHandler[names[n]] === 'function') {\n" +
          "      ContentRuntime.registerHandler(names[n], pluginHandler[names[n]]);\n" +
          "    }\n" +
          "  }\n" +
          "}\n";
        await chrome.scripting.executeScript({
          target: { tabId: (PopupState.activeTab || {}).id },
          func: new Function(csCode)
        });
      } catch (e) {
        console.warn("[Plugins] Content Script 注入失败（将重试）:", e.message);
      }
      }

      var result = PluginManager.load(manifest, handlerMap);
      if (result.ok) {
        el.pluginInstallStatus.textContent = "✅ 安装成功! " + manifest.actions.length + " 个 action 已注册";
        el.pluginInstallName.value = "";
        el.pluginInstallManifest.value = "";
        el.pluginInstallHandler.value = "";
        self._renderPluginList();
        PluginManager.saveToStorage();

        // 注入到当前 tab
        var tabId = (PopupState.activeTab || {}).id;
        if (tabId) {
          await PluginManager.injectHandlersToTab(tabId);
        }
      } else {
        el.pluginInstallStatus.textContent = "❌ " + result.error;
      }
    });
  },

  // ==========================================
  //   拖拽安装 (.kplg 文件)
  // ==========================================

  _bindPluginDropEvents: function() {
    var self = this;
    var el = self._elements;
    var dropZone = el.pluginDropZone;
    var fileInput = el.pluginFileInput;
    var status = el.pluginDropStatus;

    if (!dropZone) return;

    // 点击打开文件选择
    dropZone.addEventListener("click", function() {
      fileInput.click();
    });

    // 文件选择器
    fileInput.addEventListener("change", function() {
      var file = fileInput.files[0];
      if (file) {
        self._handlePluginFile(file);
        fileInput.value = "";
      }
    });

    // 拖拽事件
    dropZone.addEventListener("dragover", function(e) {
      e.preventDefault();
      e.stopPropagation();
      dropZone.style.background = "rgba(74,144,217,0.08)";
      dropZone.style.borderColor = "#2d6fc2";
    });

    dropZone.addEventListener("dragleave", function(e) {
      e.preventDefault();
      e.stopPropagation();
      dropZone.style.background = "";
      dropZone.style.borderColor = "#4a90d9";
    });

    dropZone.addEventListener("drop", function(e) {
      e.preventDefault();
      e.stopPropagation();
      dropZone.style.background = "";
      dropZone.style.borderColor = "#4a90d9";
      var file = e.dataTransfer.files[0];
      if (file) {
        self._handlePluginFile(file);
      }
    });
  },

  /**
   * _parseKplgText(text) → parsed object
   *
   * 鲁棒解析 .kplg 文件：只精准清理 handler 字段内的控制字符，
   * 不碰 manifest 部分，避免正则误伤。
   */
  _parseKplgText: function(text) {
    // 1. 移除 BOM + 非法控制字符
    text = text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
    text = text.replace(/^\uFEFF/, "");

    // 2. 去除 markdown 代码块包裹
    text = text.replace(/```json\s*/g, "").replace(/```\s*/g, "");

    // 3. 提取 JSON 对象：从第一个 { 到最后一个 }
    var start = text.indexOf("{");
    var end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("文件中未找到 JSON 对象");
    }
    text = text.substring(start, end + 1);

    // 4. 修复 GPT 常见错误：连续引号（"value""next" → "value","next"）
    text = text.replace(/""/g, '","');

    // 5. 修复被换行打断的属性值："semant\n"version" → "semant",\n"version"
    text = text.replace(/"([^"\n]*)\n\s*"/g, '"$1",\n"');

    // 6. 状态机：JSON 字符串内真实换行/Tab/回车 → 转义序列
    var result = "";
    var inString = false;
    var escapeNext = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (escapeNext) {
        result += ch;
        escapeNext = false;
        continue;
      }
      if (inString) {
        if (ch === "\\") {
          escapeNext = true;
          result += ch;
        } else if (ch === '"') {
          inString = false;
          result += ch;
        } else if (ch === "\n") {
          result += "\\n";
        } else if (ch === "\r") {
          result += "\\r";
        } else if (ch === "\t") {
          result += "\\t";
        } else {
          result += ch;
        }
      } else {
        if (ch === '"') inString = true;
        result += ch;
      }
    }

    return JSON.parse(result);
  },

  /**
   * _handlePluginFile(file) — 读取 .kplg 文件并安装
   */
  _handlePluginFile: function(file) {
    var self = this;
    var status = self._elements.pluginDropStatus;

    if (!file.name.endsWith(".kplg") && !file.name.endsWith(".json")) {
      status.textContent = "❌ 仅支持 .kplg 或 .json 文件";
      status.style.color = "#e74c3c";
      return;
    }

    status.textContent = "读取中...";
    status.style.color = "#999";

    var reader = new FileReader();
    reader.onload = function(e) {
      var text = e.target.result;

      try {
        var data = self._parseKplgText(text);
        if (!data.manifest) {
          status.textContent = "❌ 文件格式错误：缺少 manifest 字段";
          status.style.color = "#e74c3c";
          return;
        }
        if (!data.manifest.name) {
          status.textContent = "❌ manifest 缺少 name 字段";
          status.style.color = "#e74c3c";
          return;
        }

        // 检查是否与已有插件重名
        var exists = false;
        var plugins = PluginManager.list();
        for (var i = 0; i < plugins.length; i++) {
          if (plugins[i].name === data.manifest.name) {
            exists = true;
            break;
          }
        }
        if (exists) {
          status.textContent = "❌ 插件 '" + data.manifest.name + "' 已存在，请先卸载旧版本";
          status.style.color = "#e74c3c";
          return;
        }

        // 构建 handlerMap（SidePanel 端转发器）
        var handlerCode = data.handler || "";
        var handlerMap = PluginManager._rebuildHandlerMap(data.manifest, handlerCode);

        // 安装
        var result = PluginManager.load(data.manifest, handlerMap, handlerCode);
        if (result.ok) {
          status.textContent = "✅ " + data.manifest.name + " v" + data.manifest.version + " 安装成功! (" + data.manifest.actions.length + " actions)";
          status.style.color = "#10b981";
          self._renderPluginList();
          PluginManager.saveToStorage();

          // 注入到当前 tab
          var tabId = (PopupState.activeTab || {}).id;
          if (tabId) {
            PluginManager.injectHandlersToTab(tabId).then(function() {
              // 静默完成
            });
          }
        } else {
          status.textContent = "❌ " + result.error;
          status.style.color = "#e74c3c";
        }
      } catch (err) {
        status.textContent = "❌ 文件解析失败: " + err.message;
        status.style.color = "#e74c3c";
      }
    };
    reader.readAsText(file);
  }
};
