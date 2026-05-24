var ObservationFetcher = {
  // 全局超时常量（毫秒）
  FETCH_TIMEOUT: 5000,

  /**
   * fetch(context) - 获取页面观察信息
   * @param {Object} context - {activeTab: {id, url, title}}
   * @returns {Promise<Object|null>}
   */
  fetch: async function(context) {
    if (!context || !context.activeTab || !context.activeTab.id) {
      return null;
    }

    try {
      // ✅ 使用 Promise.race() 实现超时控制
      var response = await Promise.race([
        this._fetchWithMessage(context.activeTab.id),
        this._timeout(this.FETCH_TIMEOUT)
      ]);

      if (response && response.snapshot) {
        return response.snapshot;
      }

      return null;
    } catch (e) {
      console.warn("[ObservationFetcher] 获取失败:", e.message);
      // 区分超时和其他错误
      if (e.message === 'OBSERVATION_TIMEOUT') {
        console.error("[ObservationFetcher] 超时: Content Script无响应");
      }
      return null;
    }
  },

  /**
   * 发送消息获取观察
   * @private
   */
  _fetchWithMessage: function(tabId) {
    return new Promise((resolve, reject) => {
      try {
        chrome.tabs.sendMessage(
          tabId,
          { action: "getObservation" },
          (response) => {
            // 检查chrome API错误
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            resolve(response);
          }
        );
      } catch (err) {
        reject(err);
      }
    });
  },

  /**
   * 超时Promise
   * @private
   */
  _timeout: function(ms) {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error('OBSERVATION_TIMEOUT'));
      }, ms);
    });
  }
};
