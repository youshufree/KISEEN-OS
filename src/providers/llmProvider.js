/**
 * llmProvider.js — LLM 适配器层
 *
 * 基于 BaseProvider 的委托模式。
 * 上层代码通过 LLMProvider.call() 调用，不关心具体 Provider。
 */

var LLMProvider = {
  _current: null,
  _type: null,

  /**
   * setProvider(type, config)
   *
   * type: "deepseek" | "openclaw"
   * config: { apiKey, endpoint, model }
   */
  setProvider: function(type, config) {
    config = config || {};

    if (type === "deepseek") {
      this._current = DeepSeekProvider;
    } else if (type === "openclaw") {
      this._current = OpenClawProvider;
    } else {
      throw new Error("LLMProvider: 未知 provider 类型 " + type);
    }

    if (this._current && this._current.configure) {
      this._current.configure(config);
    }
    this._type = type;
  },

  /**
   * call(options)
   *
   * 委托给当前 provider 的 send()。
   * options: { messages, apiKey, signal, timeout }
   */
  call: async function(options) {
    if (!this._current) {
      throw new Error("LLMProvider: 未设置 provider，请先调用 setProvider()");
    }
    return await this._current.send(options.messages, {
      apiKey: options.apiKey,
      signal: options.signal,
      timeout: options.timeout
    });
  },

  /**
   * getCapabilities()
   */
  getCapabilities: function() {
    return this._current ? Object.assign({}, this._current.capabilities) : null;
  },

  /**
   * hasCapability(name)
   */
  hasCapability: function(name) {
    return this._current ? !!this._current.capabilities[name] : false;
  },

  /**
   * setConfig(options)
   *
   * 向后兼容接口。
   */
  setConfig: function(options) {
    if (!this._current) {
      console.warn("LLMProvider: setConfig 在未设置 provider 时调用");
      return;
    }
    if (this._current.configure) {
      this._current.configure(options);
    }
  }
};
