/**
 * RuntimeEvents - 轻量运行时事件系统
 *
 * 职责：
 *   1. 发布/订阅模式（on / emit / off）
 *   2. 单个 listener 报错不影响其他 listener
 *   3. Scoped 模式：每个 Runtime 实例拥有独立事件通道
 *   4. 全局 on/emit 向后兼容（UI 监听器继续工作）
 *   5. 零依赖
 */

var RuntimeEvents = {
  _listeners: {},
  _scopedListeners: {},
  _throttleMs: 0,
  _lastEmitTimes: {},

  // ==========================================
  //   全局通道（向后兼容，UI 面使用）
  // ==========================================

  /**
   * on(eventName, handler)
   *
   * 订阅全局事件。同一 handler 不重复注册。
   */
  on: function(eventName, handler) {
    if (!this._listeners[eventName]) {
      this._listeners[eventName] = [];
    }
    var list = this._listeners[eventName];
    if (list.indexOf(handler) === -1) {
      list.push(handler);
    }
  },

  /**
   * emit(eventName, payload)
   *
   * 触发全局事件。每个 listener 在 try/catch 中执行。
   * 单个报错只 console.error，不中断其它 listener。
   * payload 自动注入 type 字段。
   * 同时触发 "*" 通配符 listener。
   */
  emit: function(eventName, payload) {
    var data = payload || {};
    data.type = eventName;

    this._fire(eventName, data);

    if (eventName !== "*") {
      this._fire("*", data);
    }
  },

  /**
   * off(eventName, handler)
   *
   * 取消订阅。不传 handler 则清空该事件所有 listener。
   */
  off: function(eventName, handler) {
    if (!this._listeners[eventName]) return;
    if (!handler) {
      delete this._listeners[eventName];
      return;
    }
    var list = this._listeners[eventName];
    var idx = list.indexOf(handler);
    if (idx !== -1) {
      list.splice(idx, 1);
    }
  },

  // ==========================================
  //   Scoped 通道（Runtime 实例隔离事件）
  // ==========================================

  /**
   * onScoped(runtimeId, eventName, handler)
   *
   * 订阅某个 Runtime 实例的私有事件。
   * 不同 runtimeId 的事件不会互相污染。
   */
  onScoped: function(runtimeId, eventName, handler) {
    if (!runtimeId) return;
    if (!this._scopedListeners[runtimeId]) {
      this._scopedListeners[runtimeId] = {};
    }
    var scope = this._scopedListeners[runtimeId];
    if (!scope[eventName]) {
      scope[eventName] = [];
    }
    var list = scope[eventName];
    if (list.indexOf(handler) === -1) {
      list.push(handler);
    }
  },

  /**
   * offScoped(runtimeId, eventName, handler)
   *
   * 取消 Scoped 订阅。
   */
  offScoped: function(runtimeId, eventName, handler) {
    if (!runtimeId) return;
    var scope = this._scopedListeners[runtimeId];
    if (!scope) return;
    if (!handler) {
      delete scope[eventName];
      return;
    }
    var list = scope[eventName];
    if (!list) return;
    var idx = list.indexOf(handler);
    if (idx !== -1) {
      list.splice(idx, 1);
    }
  },

  /**
   * emitScoped(runtimeId, eventName, payload)
   *
   * 触发 Scoped 事件 + 同时触发全局事件（带 runtimeId 标记）。
   *
   * 这样：
   *   - Scoped listener 只收到自己 runtime 的事件
   *   - 全局 listener（如 RuntimeTrace）收到所有事件，可据 runtimeId 过滤
   */
  emitScoped: function(runtimeId, eventName, payload) {
    var data = payload || {};
    data.type = eventName;
    data.runtimeId = runtimeId;

    if (runtimeId) {
      var scope = this._scopedListeners[runtimeId];
      if (scope && scope[eventName]) {
        var slist = scope[eventName];
        for (var si = 0; si < slist.length; si++) {
          try {
            slist[si](data);
          } catch (err) {
            console.error("RuntimeEvents: scoped listener 执行出错", runtimeId, eventName, err);
          }
        }
      }
    }

    this._fire(eventName, data);

    if (eventName !== "*") {
      this._fire("*", data);
    }
  },

  /**
   * removeScope(runtimeId)
   *
   * 移除某个 Runtime 实例的全部 scoped listener。
   * Runtime 销毁时调用。
   */
  removeScope: function(runtimeId) {
    if (!runtimeId) return;
    delete this._scopedListeners[runtimeId];
  },

  /**
   * enableThrottle(ms)
   *
   * 开启事件节流。同一事件在 ms 毫秒内最多触发一次。
   * 设为 0 则关闭节流。
   */
  enableThrottle: function(ms) {
    this._throttleMs = ms || 0;
  },

  disableThrottle: function() {
    this._throttleMs = 0;
  },

  _shouldFire: function(eventName) {
    if (this._throttleMs <= 0) return true;
    var now = Date.now();
    var last = this._lastEmitTimes[eventName] || 0;
    if (now - last < this._throttleMs) return false;
    this._lastEmitTimes[eventName] = now;
    return true;
  },

  _fire: function(eventName, data) {
    if (!this._shouldFire(eventName)) return;
    var list = this._listeners[eventName];
    if (!list || !list.length) return;
    for (var i = 0; i < list.length; i++) {
      try {
        list[i](data);
      } catch (err) {
        console.error("RuntimeEvents: listener 执行出错", eventName, err);
      }
    }
  }
};
