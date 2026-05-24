/**
 * browserMemory.js — Agent Experience System
 *
 * 职责：
 *   1. 以 domain + pageType 粒度存储 Agent 的运行经验
 *   2. 记录 selector 成功/失败统计（selectorStats）
 *   3. 记录失败经验（recentFailures）——比成功经验更值钱
 *   4. 记录行为模式（patterns）——LLM 总结，Runtime 消费
 *   5. 为 Planner / Recovery / Observation 提供先验知识
 *
 * 核心理念：
 *   Runtime 写结构化数据 → LLM 只总结 patterns
 *   防止 LLM 直接写 memory 导致 hallucination 和污染
 *
 * 存储位置：chrome.storage.local
 */

var BrowserMemory = {

  STORAGE_KEY: "browserMemory",
  MAX_FAILURES: 20,
  MAX_PATTERNS: 10,
  MAX_GOALS: 20,
  MAX_SELECTOR_STATS: 50,

  _data: null,
  _loaded: false,

  /**
   * load()
   *
   * 从 chrome.storage.local 加载记忆。
   * 在 startAgent() 之前调用。
   */
  load: async function() {
    try {
      var stored = await chrome.storage.local.get(this.STORAGE_KEY);
      var raw = stored[this.STORAGE_KEY];
      if (raw && typeof raw === "object") {
        this._data = raw;
      } else {
        this._data = this._empty();
      }
      this._loaded = true;
      return this._data;
    } catch (e) {
      console.warn("[BrowserMemory] 加载失败:", e.message);
      this._data = this._empty();
      this._loaded = true;
      return this._data;
    }
  },

  /**
   * save()
   *
   * 持久化到 chrome.storage.local（内部自动调用）。
   */
  _save: async function() {
    try {
      var jsonStr = JSON.stringify(this._data);
      if (jsonStr.length > 500000) {
        console.warn("[BrowserMemory] 数据量过大 (" + Math.round(jsonStr.length/1024) + "KB)，自动清理旧数据");
        this._pruneOldData();
        jsonStr = JSON.stringify(this._data);
      }
      var toSave = {};
      toSave[this.STORAGE_KEY] = this._data;
      await chrome.storage.local.set(toSave);
    } catch (e) {
      if (e.message && e.message.indexOf("quota") !== -1) {
        console.warn("[BrowserMemory] 存储配额满，尝试清理...");
        this._pruneOldData();
        try {
          var retry = {};
          retry[this.STORAGE_KEY] = this._data;
          await chrome.storage.local.set(retry);
        } catch (e2) {
          console.warn("[BrowserMemory] 清理后仍保存失败:", e2.message);
        }
      } else {
        console.warn("[BrowserMemory] 保存失败:", e.message);
      }
    }
  },

  _pruneOldData: function() {
    var cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    var newGoals = [];
    for (var i = 0; i < this._data.recentGoals.length; i++) {
      if (this._data.recentGoals[i].timestamp > cutoff) {
        newGoals.push(this._data.recentGoals[i]);
      }
    }
    this._data.recentGoals = newGoals.slice(-this.MAX_GOALS);

    var domainKeys = Object.keys(this._data.domains);
    for (var d = 0; d < domainKeys.length; d++) {
      var dm = this._data.domains[domainKeys[d]];
      if (dm.recentFailures) {
        dm.recentFailures = dm.recentFailures.filter(function(f) {
          return f.timestamp > cutoff;
        }).slice(-10);
      }
    }

    var selKeys = Object.keys(this._data.selectorStats);
    if (selKeys.length > 30) {
      var sorted = selKeys.map(function(k) {
        return { key: k, last: this._data.selectorStats[k].lastUsedAt || 0 };
      }.bind(this));
      sorted.sort(function(a, b) { return b.last - a.last; });
      var toRemove = sorted.slice(30);
      for (var s = 0; s < toRemove.length; s++) {
        delete this._data.selectorStats[toRemove[s].key];
      }
    }
  },

  /**
   * ensureLoaded()
   */
  _ensure: async function() {
    if (!this._loaded) await this.load();
  },

  _empty: function() {
    return {
      domains: {},
      recentGoals: [],
      selectorStats: {}
    };
  },

  /**
   * _domainKey(url)
   *
   * 从 URL 提取域名。如 "https://www.youtube.com/watch?v=xxx" → "youtube.com"
   */
  _domainKey: function(url) {
    if (!url) return null;
    try {
      var host = new URL(url).hostname;
      return host.replace(/^www\./, "");
    } catch (e) {
      return null;
    }
  },

  /**
   * _pageTypeKey(url)
   *
   * 从 URL 推断页面类型。
   * 如 "/watch" → "watch", "/results" → "search", "/" → "home"
   */
  _pageTypeKey: function(url) {
    if (!url) return "other";
    try {
      var pathname = new URL(url).pathname;
      if (!pathname || pathname === "/") return "home";
      var parts = pathname.split("/").filter(function(p) { return p.length > 0; });
      return parts[0] || "other";
    } catch (e) {
      return "other";
    }
  },

  /**
   * _ensureDomain(domain)
   */
  _ensureDomain: function(domain) {
    if (!this._data.domains[domain]) {
      this._data.domains[domain] = {
        visitCount: 0,
        successRate: 0,
        lastVisitAt: null,
        pageTypes: {},
        recentFailures: []
      };
    }
    return this._data.domains[domain];
  },

  /**
   * _ensurePageType(domain, pageType)
   */
  _ensurePageType: function(domain, pageType) {
    var dm = this._ensureDomain(domain);
    if (!dm.pageTypes[pageType]) {
      dm.pageTypes[pageType] = {
        stableSelectors: {},
        patterns: []
      };
    }
    return dm.pageTypes[pageType];
  },

  // ==========================================
  //   Public API
  // ==========================================

  /**
   * getContext(url)
   *
   * 返回给定 URL 的记忆上下文，注入到 Agent context 中。
   * 返回：{ domain, pageType, knownSelectors, patterns, selectorStats, recentFailures }
   */
  getContext: function(url) {
    var domain = this._domainKey(url);
    var pageType = this._pageTypeKey(url);

    if (!domain || !this._data.domains[domain]) {
      return {
        domain: domain,
        pageType: pageType,
        knownSelectors: {},
        patterns: [],
        recentFailures: [],
        hasExperience: false
      };
    }

    var dm = this._data.domains[domain];
    var pt = dm.pageTypes[pageType] || {};

    var allSelectors = {};
    if (pt.stableSelectors) {
      for (var key in pt.stableSelectors) {
        if (pt.stableSelectors.hasOwnProperty(key)) {
          allSelectors[key] = pt.stableSelectors[key];
        }
      }
    }

    var failSelectors = {};
    for (var i = 0; i < dm.recentFailures.length; i++) {
      var f = dm.recentFailures[i];
      if (f.selector) failSelectors[f.selector] = true;
    }

    var relevantStats = {};
    for (var selKey in allSelectors) {
      if (allSelectors.hasOwnProperty(selKey)) {
        var s = allSelectors[selKey];
        var stats = this._data.selectorStats[s];
        if (stats) relevantStats[s] = stats;
      }
    }

    return {
      domain: domain,
      pageType: pageType,
      knownSelectors: allSelectors,
      patterns: pt.patterns || [],
      recentFailures: dm.recentFailures.slice(0, 5),
      selectorStats: relevantStats,
      failedSelectors: failSelectors,
      hasExperience: true,
      visitCount: dm.visitCount || 0,
      successRate: dm.successRate || 0
    };
  },

  /**
   * recordVisit(url)
   *
   * 记录一次对某 domain 的访问。
   */
  recordVisit: async function(url) {
    await this._ensure();
    var domain = this._domainKey(url);
    if (!domain) return;

    var dm = this._ensureDomain(domain);
    dm.visitCount = (dm.visitCount || 0) + 1;
    dm.lastVisitAt = Date.now();

    await this._save();
  },

  /**
   * recordSelectorSuccess(domain, pageType, semanticKey, selector)
   *
   * 记录一个 selector 使用成功。
   * semanticKey 如 "searchInput"、"firstVideo"、"loginButton"
   *
   * Runtime 写入结构化数据，不经过 LLM。
   */
  recordSelectorSuccess: async function(domain, pageType, semanticKey, selector) {
    if (!domain || !selector) return;
    await this._ensure();

    var pt = this._ensurePageType(domain, pageType);
    pt.stableSelectors[semanticKey] = selector;

    if (!this._data.selectorStats[selector]) {
      this._data.selectorStats[selector] = {
        successCount: 0,
        failCount: 0,
        domains: [],
        lastUsedAt: null
      };
    }
    var stats = this._data.selectorStats[selector];
    stats.successCount = (stats.successCount || 0) + 1;
    stats.lastUsedAt = Date.now();
    if (stats.domains.indexOf(domain) === -1) {
      stats.domains.push(domain);
    }

    var dm = this._ensureDomain(domain);
    var total = (stats.successCount + stats.failCount) || 1;
    dm.successRate = Math.round((stats.successCount / total) * 100) / 100;

    this._cleanupSelectorStats();

    await this._save();
  },

  /**
   * recordSelectorFailure(domain, selector, actionType, reason)
   *
   * 失败经验比成功经验更值钱。
   */
  recordSelectorFailure: async function(domain, selector, actionType, reason) {
    if (!domain || !selector) return;
    await this._ensure();

    if (!this._data.selectorStats[selector]) {
      this._data.selectorStats[selector] = {
        successCount: 0,
        failCount: 0,
        domains: [],
        lastUsedAt: null
      };
    }
    var stats = this._data.selectorStats[selector];
    stats.failCount = (stats.failCount || 0) + 1;

    var dm = this._ensureDomain(domain);
    dm.recentFailures.push({
      action: actionType || "unknown",
      selector: selector,
      pageType: this._pageTypeKey(""),
      reason: reason || "",
      timestamp: Date.now()
    });

    while (dm.recentFailures.length > this.MAX_FAILURES) {
      dm.recentFailures.shift();
    }

    var total = (stats.successCount + stats.failCount) || 1;
    dm.successRate = Math.round((stats.successCount / total) * 100) / 100;

    this._cleanupSelectorStats();

    await this._save();
  },

  /**
   * addPattern(domain, pageType, pattern)
   *
   * 添加行为模式（由 LLM 总结，或 Runtime 自动）。
   */
  addPattern: async function(domain, pageType, pattern) {
    if (!domain || !pattern) return;
    await this._ensure();

    var pt = this._ensurePageType(domain, pageType);
    if (pt.patterns.indexOf(pattern) === -1) {
      pt.patterns.push(pattern);
      while (pt.patterns.length > this.MAX_PATTERNS) {
        pt.patterns.shift();
      }
    }

    await this._save();
  },

  /**
   * recordGoal(goal, result, url)
   *
   * 记录最近的目标和结果。
   */
  recordGoal: async function(goal, result, url) {
    await this._ensure();

    this._data.recentGoals.push({
      goal: goal,
      result: result || "unknown",
      domain: this._domainKey(url) || "",
      timestamp: Date.now()
    });

    while (this._data.recentGoals.length > this.MAX_GOALS) {
      this._data.recentGoals.shift();
    }

    await this._save();
  },

  /**
   * cleanupSelectorStats()
   *
   * 清理旧的 selector 统计数据，控制数据量。
   */
  _cleanupSelectorStats: function() {
    var keys = Object.keys(this._data.selectorStats);
    if (keys.length <= this.MAX_SELECTOR_STATS) return;

    var sorted = keys.map(function(k) {
      return { key: k, last: this._data.selectorStats[k].lastUsedAt || 0 };
    }.bind(this));

    sorted.sort(function(a, b) { return a.last - b.last; });

    var toRemove = sorted.slice(0, sorted.length - this.MAX_SELECTOR_STATS);
    for (var i = 0; i < toRemove.length; i++) {
      delete this._data.selectorStats[toRemove[i].key];
    }
  },

  /**
   * getStats()
   */
  getStats: function() {
    return {
      domainCount: this._data ? Object.keys(this._data.domains).length : 0,
      goalCount: this._data ? this._data.recentGoals.length : 0,
      selectorCount: this._data ? Object.keys(this._data.selectorStats).length : 0
    };
  },

  // ==========================================
  //   管理
  // ==========================================

  /**
   * clear()
   */
  clear: async function() {
    this._data = this._empty();
    await chrome.storage.local.remove(this.STORAGE_KEY);
    console.log("[BrowserMemory] 已清除所有记忆");
  },

  /**
   * getRaw()
   *
   * 调试用：返回完整数据。
   */
  getRaw: function() {
    return this._data;
  }
};
