/**
 * recoveryStrategyTracker.js — Recovery 策略成功率追踪
 *
 * 职责：
 *   1. 记录每个 Recovery 策略的成功/失败次数
 *   2. 按成功率排序策略优先级
 *   3. 淘汰连续失败的策略（自动降级）
 *   4. 持久化到 chrome.storage.local
 *
 * 核心理念：
 *   "让数据决定 Recovery 策略优先级，而非固定规则。"
 *
 * 运行环境：SidePanel
 */

var RecoveryStrategyTracker = {

  STORAGE_KEY: "recoveryStrategyStats",

  /**
   * 默认策略成功率（冷启动时）
   */
  DEFAULT_STATS: {
    retry_action: { attempts: 0, successes: 0, rate: 0.5 },
    re_locate_element: { attempts: 0, successes: 0, rate: 0.4 },
    fallback_selector: { attempts: 0, successes: 0, rate: 0.3 },
    scroll_and_retry: { attempts: 0, successes: 0, rate: 0.25 },
    wait_and_retry: { attempts: 0, successes: 0, rate: 0.2 },
    replan: { attempts: 0, successes: 0, rate: 0.15 }
  },

  _stats: null,
  _loaded: false,

  /**
   * load()
   *
   * 从 chrome.storage.local 加载策略统计数据。
   */
  load: async function() {
    try {
      var stored = await chrome.storage.local.get(this.STORAGE_KEY);
      this._stats = stored[this.STORAGE_KEY] || this._cloneStats(this.DEFAULT_STATS);
      this._loaded = true;
    } catch (e) {
      console.warn("[RecoveryTracker] 加载失败:", e.message);
      this._stats = this._cloneStats(this.DEFAULT_STATS);
      this._loaded = true;
    }
  },

  /**
   * record(strategyName, success)
   *
   * 记录一次策略执行结果。
   */
  record: async function(strategyName, success) {
    if (!this._loaded) await this.load();
    if (!this._stats[strategyName]) {
      this._stats[strategyName] = { attempts: 0, successes: 0, rate: 0 };
    }

    var s = this._stats[strategyName];
    s.attempts++;
    if (success) s.successes++;
    s.rate = Math.round((s.successes / s.attempts) * 100) / 100;

    await this._save();
  },

  /**
   * getSortedStrategies(strategyNames)
   *
   * 按成功率降序排列策略列表。
   * 返回：[{ name, rate, attempts }]
   */
  getSortedStrategies: function(strategyNames) {
    var self = this;
    var items = [];

    for (var i = 0; i < strategyNames.length; i++) {
      var name = strategyNames[i];
      var s = self._stats[name] || { attempts: 0, successes: 0, rate: 0 };
      items.push({ name: name, rate: s.rate, attempts: s.attempts });
    }

    items.sort(function(a, b) { return b.rate - a.rate; });
    return items;
  },

  /**
   * getEffectiveStrategies(strategyNames, minAttempts, minRate)
   *
   * 过滤掉成功率过低的策略。
   * 返回：按成功率排序的有效策略列表。
   */
  getEffectiveStrategies: function(strategyNames, minAttempts, minRate) {
    minAttempts = minAttempts || 3;
    minRate = minRate || 0.1;

    var sorted = this.getSortedStrategies(strategyNames);
    var effective = [];

    for (var i = 0; i < sorted.length; i++) {
      var s = sorted[i];
      // 冷启动（尝试次数不足）或成功率达标的策略保留
      if (s.attempts < minAttempts || s.rate >= minRate) {
        effective.push(s);
      }
    }

    return effective;
  },

  /**
   * getStats()
   *
   * 返回当前统计快照。
   */
  getStats: function() {
    return this._cloneStats(this._stats || this.DEFAULT_STATS);
  },

  /**
   * reset()
   *
   * 重置所有统计。
   */
  reset: async function() {
    this._stats = this._cloneStats(this.DEFAULT_STATS);
    await this._save();
  },

  /**
   * getReport()
   *
   * 生成人类可读的策略报告。
   */
  getReport: function() {
    var sorted = this.getSortedStrategies(Object.keys(this._stats || this.DEFAULT_STATS));
    var lines = ["=== Recovery 策略报告 ===", ""];

    for (var i = 0; i < sorted.length; i++) {
      var s = sorted[i];
      var pct = (s.rate * 100).toFixed(0);
      var status = s.rate >= 0.5 ? "OK" : (s.rate >= 0.2 ? "LOW" : "FAIL");
      lines.push("  [" + status + "] " + s.name + ": " + pct + "% (" + s.attempts + " 次)");
    }

    return lines.join("\n");
  },

  // ==========================================
  //   内部方法
  // ==========================================

  _save: async function() {
    try {
      var update = {};
      update[this.STORAGE_KEY] = this._stats;
      await chrome.storage.local.set(update);
    } catch (e) {
      console.warn("[RecoveryTracker] 保存失败:", e.message);
    }
  },

  _cloneStats: function(stats) {
    var clone = {};
    for (var key in stats) {
      if (stats.hasOwnProperty(key)) {
        clone[key] = {
          attempts: stats[key].attempts || 0,
          successes: stats[key].successes || 0,
          rate: stats[key].rate || 0
        };
      }
    }
    return clone;
  }
};
