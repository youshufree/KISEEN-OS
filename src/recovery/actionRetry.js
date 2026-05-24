var ActionRetry = {

  DEFAULT_CONFIG: {
    maxRetries: 2,
    retryDelayMs: 500,
    exponentialBackoff: true,
    maxDelayMs: 5000
  },

  _config: null,
  _retryCounts: {},

  configure: function(config) {
    this._config = {};
    for (var key in this.DEFAULT_CONFIG) {
      if (this.DEFAULT_CONFIG.hasOwnProperty(key)) {
        this._config[key] = (config && config.hasOwnProperty(key))
          ? config[key]
          : this.DEFAULT_CONFIG[key];
      }
    }
  },

  execute: async function(action, context, executorFn) {
    if (!this._config) this.configure();

    var actionKey = action.type + ":" + JSON.stringify(action.target || {});
    var retryCount = this._retryCounts[actionKey] || 0;

    if (retryCount >= this._config.maxRetries) {
      console.warn("[Recovery] 重试次数已用尽:", action.type, "retries:", retryCount);
      return {
        success: false,
        retriesUsed: retryCount,
        error: "重试次数已用尽 (" + retryCount + "/" + this._config.maxRetries + ")"
      };
    }

    var delay = this._calculateDelay(retryCount);
    if (delay > 0) {
      console.log("[Recovery] 等待重试:", delay + "ms", "retry:", retryCount + 1);
      await this._sleep(delay);
    }

    this._retryCounts[actionKey] = retryCount + 1;

    try {
      var result = await executorFn(action, context);

      if (result.success) {
        delete this._retryCounts[actionKey];
        result.retriesUsed = retryCount + 1;
        return result;
      }

      return {
        success: false,
        retriesUsed: retryCount + 1,
        error: result.error
      };
    } catch (err) {
      return {
        success: false,
        retriesUsed: retryCount + 1,
        error: "重试执行异常: " + err.message
      };
    }
  },

  getRetryCount: function(action) {
    var actionKey = action.type + ":" + JSON.stringify(action.target || {});
    return this._retryCounts[actionKey] || 0;
  },

  canRetry: function(action) {
    if (!this._config) this.configure();
    var actionKey = action.type + ":" + JSON.stringify(action.target || {});
    return (this._retryCounts[actionKey] || 0) < this._config.maxRetries;
  },

  resetRetryCount: function(action) {
    if (!action) {
      this._retryCounts = {};
      return;
    }
    var actionKey = action.type + ":" + JSON.stringify(action.target || {});
    delete this._retryCounts[actionKey];
  },

  resetAll: function() {
    this._retryCounts = {};
  },

  _calculateDelay: function(retryCount) {
    if (!this._config) this.configure();

    if (!this._config.exponentialBackoff) {
      return this._config.retryDelayMs;
    }

    var delay = this._config.retryDelayMs * Math.pow(2, retryCount);
    return Math.min(delay, this._config.maxDelayMs);
  },

  _sleep: function(ms) {
    return new Promise(function(resolve) {
      setTimeout(resolve, ms);
    });
  }
};
