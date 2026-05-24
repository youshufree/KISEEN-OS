/**
 * environmentManager.js — 环境管理器
 *
 * 职责：
 *   1. 注册和管理环境适配器（浏览器、桌面、CLI 等）
 *   2. 提供统一的环境操作入口
 *   3. 支持运行时切换环境适配器
 *
 * Runtime Core 通过 EnvironmentManager 操作环境，不直接依赖具体适配器。
 *
 * 使用方式：
 *   EnvironmentManager.register("browser", BrowserAdapter);
 *   EnvironmentManager.setCurrent("browser");
 *   await EnvironmentManager.perceive(context);
 *
 * 默认行为：首次调用时自动注册 BrowserAdapter 并设置为当前环境。
 */
var EnvironmentManager = {

  _currentAdapter: null,
  _adapters: {},
  _autoInitialized: false,

  /**
   * register(name, adapter)
   *
   * 注册一个环境适配器。
   *
   * @param {string} name - 适配器名称
   * @param {object} adapter - 实现 EnvironmentHAL 接口的对象
   */
  register: function(name, adapter) {
    this._adapters[name] = adapter;
    console.log("[EnvManager] 注册适配器:", name);
  },

  /**
   * setCurrent(name)
   *
   * 设置当前使用的环境适配器。
   *
   * @param {string} name - 适配器名称
   */
  setCurrent: function(name) {
    if (!this._adapters[name]) {
      throw new Error("[EnvManager] 未找到适配器: " + name);
    }
    this._currentAdapter = this._adapters[name];
    console.log("[EnvManager] 切换到环境:", name);
  },

  /**
   * getCurrent()
   *
   * 获取当前环境适配器。首次调用时自动初始化。
   *
   * @returns {object} 实现 EnvironmentHAL 接口的适配器
   */
  getCurrent: function() {
    if (!this._autoInitialized) {
      this._autoInitialize();
    }
    if (!this._currentAdapter) {
      throw new Error("[EnvManager] 未设置当前环境适配器，请先调用 setCurrent()");
    }
    return this._currentAdapter;
  },

  /**
   * get(name)
   *
   * 获取指定名称的适配器。
   *
   * @param {string} name - 适配器名称
   * @returns {object|null}
   */
  get: function(name) {
    return this._adapters[name] || null;
  },

  /**
   * getRegisteredNames()
   *
   * @returns {string[]}
   */
  getRegisteredNames: function() {
    return Object.keys(this._adapters);
  },

  // ==========================================
  //   便捷代理方法
  // ==========================================

  /**
   * perceive(context)
   *
   * 感知当前环境状态。
   */
  perceive: async function(context) {
    return await this.getCurrent().perceive(context);
  },

  /**
   * execute(action, context)
   *
   * 在当前环境中执行动作。
   */
  execute: async function(action, context) {
    return await this.getCurrent().execute(action, context);
  },

  /**
   * getContext(context)
   *
   * 获取当前环境上下文。
   */
  getContext: async function(context) {
    return await this.getCurrent().getContext(context);
  },

  /**
   * validateSelector(selector, tabId)
   *
   * 验证选择器在当前环境中是否可用。
   */
  validateSelector: async function(selector, tabId) {
    return await this.getCurrent().validateSelector(selector, tabId);
  },

  /**
   * validateTarget(target, tabId)
   */
  validateTarget: async function(target, tabId) {
    return await this.getCurrent().validateTarget(target, tabId);
  },

  /**
   * extractContent(action, context)
   */
  extractContent: async function(action, context) {
    return await this.getCurrent().extractContent(action, context);
  },

  /**
   * getCapabilities()
   */
  getCapabilities: function() {
    return this.getCurrent().getCapabilities();
  },

  /**
   * getType()
   */
  getType: function() {
    return this.getCurrent().getType();
  },

  // ==========================================
  //   内部方法
  // ==========================================

  /**
   * _autoInitialize()
   *
   * 首次调用时自动注册 BrowserAdapter 并设置为默认。
   */
  _autoInitialize: function() {
    if (this._autoInitialized) return;
    this._autoInitialized = true;
    if (typeof BrowserAdapter !== "undefined") {
      this.register("browser", BrowserAdapter);
    }
    if (!this._currentAdapter) {
      if (this._adapters["browser"]) {
        this.setCurrent("browser");
      } else if (Object.keys(this._adapters).length > 0) {
        var firstKey = Object.keys(this._adapters)[0];
        this.setCurrent(firstKey);
      }
    }
  }
};
