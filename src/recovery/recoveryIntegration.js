/**
 * recoveryIntegration.js — Recovery 系统集成层
 *
 * 职责：
 *   1. 通过 RuntimeEvents 监听 recovery_completed / recovery_failed 事件
 *   2. 将结果记录到 RecoveryStrategyTracker
 *   3. 提供 getEffectiveStrategies() 给未来代码使用
 *   4. 不修改 recoveryManager.js，纯事件驱动集成
 *
 * 运行环境：SidePanel
 */

var RecoveryIntegration = {

  _initialized: false,

  init: function() {
    if (this._initialized) return;
    this._initialized = true;

    RuntimeEvents.on("recovery_completed", function(data) {
      var payload = data.payload || data;
      var strategy = payload.strategy || "unknown";
      var needsReplan = payload.needsReplan || false;
      RecoveryStrategyTracker.record(strategy, !needsReplan);
    });

    RuntimeEvents.on("recovery_failed", function(data) {
      var payload = data.payload || data;
      var strategy = payload.strategy || "unknown";
      RecoveryStrategyTracker.record(strategy, false);
    });

    RecoveryStrategyTracker.load();
    console.log("[RecoveryIntegration] 初始化完成，开始追踪 Recovery 策略成功率");
  },

  getEffectiveStrategies: function(strategyNames) {
    return RecoveryStrategyTracker.getEffectiveStrategies(strategyNames, 3, 0.1);
  },

  getReport: function() {
    return RecoveryStrategyTracker.getReport();
  },

  getStats: function() {
    return RecoveryStrategyTracker.getStats();
  },

  reset: async function() {
    await RecoveryStrategyTracker.reset();
    console.log("[RecoveryIntegration] 统计数据已重置");
  }
};

(function() {
  if (typeof RuntimeEvents !== "undefined" && typeof RecoveryStrategyTracker !== "undefined") {
    RecoveryIntegration.init();
  }
})();