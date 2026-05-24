/**
 * traceStore.js — Runtime Trace 持久化存储
 *
 * Phase 1 后端：chrome.storage.local
 * 接口抽象：save / query / getSession / getTimeline / clearSession / getStats
 *
 * 容量管理：
 *   - MAX_TRACES_PER_SESSION: 200  每条 session 最多保存条数
 *   - MAX_SESSIONS: 20             最多保留的 session 数
 *   - 超过限制时自动淘汰最早的 session
 *
 * 未来升级路径：
 *   chrome.storage.local → IndexedDB → SQLite WASM → Cloud Trace
 *   只需替换存储后端，接口不变
 */

var TraceStore = {

  STORAGE_KEY: "runtimeTraces",
  MAX_TRACES_PER_SESSION: 50,
  MAX_SESSIONS: 5,

  /**
   * save(traceEvent)
   *
   * 追加一条 TraceEvent 到 chrome.storage.local。
   * 自动按 session 分桶，超限自动淘汰。
   */
  save: function(traceEvent) {
    if (!traceEvent || !traceEvent.sessionId) {
      console.warn("[TraceStore] 缺少 sessionId，放弃保存");
      return;
    }

    var self = this;

    chrome.storage.local.get([this.STORAGE_KEY], function(result) {
      var data = result[self.STORAGE_KEY] || {};
      var sessionId = traceEvent.sessionId;

      if (!data[sessionId]) {
        data[sessionId] = [];
      }

      data[sessionId].push(traceEvent);

      if (data[sessionId].length > self.MAX_TRACES_PER_SESSION) {
        data[sessionId] = data[sessionId].slice(-self.MAX_TRACES_PER_SESSION);
      }

      var sessionIds = Object.keys(data);
      if (sessionIds.length > self.MAX_SESSIONS) {
        sessionIds.sort(function(a, b) {
          var tracesA = data[a] || [];
          var tracesB = data[b] || [];
          var timeA = tracesA.length > 0 ? tracesA[0].timestamp : 0;
          var timeB = tracesB.length > 0 ? tracesB[0].timestamp : 0;
          return timeA - timeB;
        });
        var toDelete = sessionIds.slice(0, sessionIds.length - self.MAX_SESSIONS);
        for (var i = 0; i < toDelete.length; i++) {
          delete data[toDelete[i]];
        }
      }

      chrome.storage.local.set({ [self.STORAGE_KEY]: data }, function() {
        if (chrome.runtime.lastError) {
          console.error("[TraceStore] 保存失败:", chrome.runtime.lastError.message);
        }
      });
    });
  },

  /**
   * query(sessionId, filter, callback)
   *
   * filter: { phase, minTimestamp, maxTimestamp, limit, offset }
   * 异步，通过 callback 返回结果。
   */
  query: function(sessionId, filter, callback) {
    filter = filter || {};
    var self = this;

    chrome.storage.local.get([this.STORAGE_KEY], function(result) {
      var data = result[self.STORAGE_KEY] || {};
      var traces = data[sessionId] || [];

      if (filter.phase) {
        traces = traces.filter(function(t) { return t.phase === filter.phase; });
      }
      if (filter.minTimestamp) {
        traces = traces.filter(function(t) { return t.timestamp >= filter.minTimestamp; });
      }
      if (filter.maxTimestamp) {
        traces = traces.filter(function(t) { return t.timestamp <= filter.maxTimestamp; });
      }

      traces.sort(function(a, b) { return a.timestamp - b.timestamp; });

      if (filter.offset) {
        traces = traces.slice(filter.offset);
      }
      if (filter.limit) {
        traces = traces.slice(0, filter.limit);
      }

      if (typeof callback === "function") {
        callback(traces);
      }
    });
  },

  /**
   * getSession(sessionId, callback)
   *
   * 返回该 session 的全部 trace，按时间排序。
   */
  getSession: function(sessionId, callback) {
    this.query(sessionId, {}, callback);
  },

  /**
   * getTimeline(sessionId, callback)
   *
   * 返回 Timeline 视图：每条 trace 只保留 id/phase/iteration/timestamp 概要。
   */
  getTimeline: function(sessionId, callback) {
    var self = this;
    chrome.storage.local.get([this.STORAGE_KEY], function(result) {
      var data = result[self.STORAGE_KEY] || {};
      var traces = data[sessionId] || [];

      traces.sort(function(a, b) { return a.timestamp - b.timestamp; });

      var timeline = [];
      for (var i = 0; i < traces.length; i++) {
        var t = traces[i];
        timeline.push({
          traceId:   t.traceId,
          phase:     t.phase,
          iteration: t.iteration,
          timestamp: t.timestamp,
          success:   t.result ? t.result.success : null
        });
      }

      if (typeof callback === "function") {
        callback(timeline);
      }
    });
  },

  /**
   * clearSession(sessionId, callback)
   */
  clearSession: function(sessionId, callback) {
    var self = this;
    chrome.storage.local.get([this.STORAGE_KEY], function(result) {
      var data = result[self.STORAGE_KEY] || {};
      delete data[sessionId];
      chrome.storage.local.set({ [self.STORAGE_KEY]: data }, function() {
        if (typeof callback === "function") {
          callback();
        }
      });
    });
  },

  /**
   * getStats(callback)
   *
   * 返回 { sessionCount, totalTraces, sizeKB, sessions: [...] }
   */
  getStats: function(callback) {
    var self = this;
    chrome.storage.local.get([this.STORAGE_KEY], function(result) {
      var data = result[self.STORAGE_KEY] || {};
      var sessionIds = Object.keys(data);
      var totalTraces = 0;
      var sessions = [];

      for (var i = 0; i < sessionIds.length; i++) {
        var sid = sessionIds[i];
        var traces = data[sid] || [];
        totalTraces += traces.length;

        var firstTs = traces.length > 0 ? traces[0].timestamp : 0;
        var lastTs = traces.length > 0 ? traces[traces.length - 1].timestamp : 0;
        var successCount = 0;
        var failureCount = 0;
        for (var j = 0; j < traces.length; j++) {
          if (traces[j].result) {
            if (traces[j].result.success) successCount++;
            else if (traces[j].result.error) failureCount++;
          }
        }

        sessions.push({
          sessionId: sid,
          traceCount: traces.length,
          firstTimestamp: firstTs,
          lastTimestamp: lastTs,
          successCount: successCount,
          failureCount: failureCount
        });
      }

      var sizeKB = 0;
      try {
        sizeKB = Math.round(JSON.stringify(data).length / 1024);
      } catch (e) {}

      if (typeof callback === "function") {
        callback({
          sessionCount: sessionIds.length,
          totalTraces: totalTraces,
          sizeKB: sizeKB,
          maxSessions: self.MAX_SESSIONS,
          maxTracesPerSession: self.MAX_TRACES_PER_SESSION,
          sessions: sessions
        });
      }
    });
  }
};
