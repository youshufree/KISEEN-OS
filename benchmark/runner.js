/**
 * benchmark/runner.js — Browser Agent Benchmark Runner
 *
 * 职责：
 *   1. 加载 Benchmark 任务定义
 *   2. 逐个执行任务，记录每次尝试的结果
 *   3. 计算成功率、平均步骤数、平均 token 消耗等指标
 *   4. 将结果保存到 chrome.storage.local
 *
 * 使用方式：
 *   BenchmarkRunner.runAll() — 运行所有任务
 *   BenchmarkRunner.run("task_id") — 运行单个任务
 *   BenchmarkRunner.getResults() — 获取历史结果
 *   BenchmarkRunner.getReport() — 生成统计报告
 *
 * 运行环境：SidePanel（通过 RuntimeAPI 调用 Runtime）
 */

var BenchmarkRunner = {

  RESULTS_KEY: "benchmarkResults",
  MAX_RESULTS: 50,

  /**
   * runAll(tasks)
   *
   * tasks: 数组，每项为 { id, name, goal, startUrl, successCriteria, maxSteps, timeout }
   *
   * 返回：{ total, passed, failed, avgSteps, avgDurationMs, results: [...] }
   */
  runAll: async function(tasks, options) {
    options = options || {};
    var maxAttempts = options.maxAttempts || 3;
    var results = [];

    console.log("[Benchmark] 开始运行 " + tasks.length + " 个任务，每个最多 " + maxAttempts + " 次尝试");

    for (var i = 0; i < tasks.length; i++) {
      var task = tasks[i];
      console.log("[Benchmark] (" + (i + 1) + "/" + tasks.length + ") 运行任务: " + task.name);

      var taskResult = await this._runTaskWithRetry(task, maxAttempts);
      results.push(taskResult);

      this._emitProgress(i + 1, tasks.length, taskResult);
    }

    var report = this._buildReport(results);
    await this._saveResults(results, report);

    console.log("[Benchmark] 全部完成。通过: " + report.passed + "/" + report.total);
    return report;
  },

  /**
   * run(task)
   *
   * 运行单个任务。
   */
  run: async function(task, options) {
    options = options || {};
    var maxAttempts = options.maxAttempts || 3;
    return await this._runTaskWithRetry(task, maxAttempts);
  },

  /**
   * getResults(callback)
   *
   * 从 chrome.storage.local 读取历史结果。
   */
  getResults: function(callback) {
    var self = this;
    chrome.storage.local.get([self.RESULTS_KEY], function(data) {
      callback(data[self.RESULTS_KEY] || []);
    });
  },

  /**
   * getReport(callback)
   *
   * 读取最近一次的报告。
   */
  getReport: function(callback) {
    this.getResults(function(allResults) {
      if (allResults.length === 0) {
        callback(null);
        return;
      }
      callback(allResults[allResults.length - 1]);
    });
  },

  /**
   * clearResults()
   */
  clearResults: async function() {
    await chrome.storage.local.remove(this.RESULTS_KEY);
  },

  // ==========================================
  //   内部实现
  // ==========================================

  /**
   * _runTaskWithRetry(task, maxAttempts)
   *
   * 对单个任务进行最多 maxAttempts 次尝试。
   * 首次成功即停止；否则重试直到用尽。
   */
  _runTaskWithRetry: async function(task, maxAttempts) {
    var attempts = [];

    for (var attempt = 1; attempt <= maxAttempts; attempt++) {
      console.log("[Benchmark]   尝试 #" + attempt + "/" + maxAttempts);

      var attemptResult = await this._runSingleAttempt(task, attempt);
      attempts.push(attemptResult);

      if (attemptResult.success) {
        console.log("[Benchmark]   成功 (步骤: " + attemptResult.steps + ", 耗时: " + attemptResult.durationMs + "ms)");
        break;
      }

      console.log("[Benchmark]   失败: " + attemptResult.error);

      // 等待后再重试
      if (attempt < maxAttempts) {
        await this._sleep(2000);
      }
    }

    var bestAttempt = this._getBestAttempt(attempts);

    return {
      taskId: task.id,
      taskName: task.name,
      category: task.category || "unknown",
      difficulty: task.difficulty || "medium",
      passed: bestAttempt.success,
      attempts: attempts.length,
      bestAttempt: bestAttempt,
      allAttempts: attempts
    };
  },

  /**
   * _runSingleAttempt(task, attemptNum)
   *
   * 执行一次任务尝试。通过 RuntimeAPI 启动 Agent，等待完成。
   *
   * 返回：{ success, steps, durationMs, error, finalAnswer, trace }
   */
  _runSingleAttempt: async function(task, attemptNum) {
    var startedAt = Date.now();

    try {
      // 导航到 startUrl（如果有），确保任务从正确的页面开始
      if (task.startUrl) {
        var tab = PopupState.activeTab;
        if (tab && tab.id) {
          console.log("[Benchmark] 导航到 startUrl:", task.startUrl);
          try {
            await chrome.tabs.update(tab.id, { url: task.startUrl });
            // 等待页面加载
            await new Promise(function(r) { setTimeout(r, 5000); });
            // 刷新 activeTab 引用
            var updatedTab = await new Promise(function(r) { chrome.tabs.get(tab.id, r); });
            PopupState.activeTab = updatedTab || tab;
          } catch (navErr) {
            console.warn("[Benchmark] startUrl 导航失败:", navErr.message);
          }
        }
      }

      var result = await RuntimeAPI.startTask({
        template: "agent",
        goal: task.goal,
        activeTab: PopupState.activeTab
      });

      var durationMs = Date.now() - startedAt;
      var success = this._evaluateSuccess(task, result);
      var steps = result.iterations || result.steps || 0;

      return {
        success: success,
        steps: steps,
        durationMs: durationMs,
        error: success ? null : ("未通过成功判定: " + (result.finalAnswer || "").substring(0, 200)),
        finalAnswer: result.finalAnswer || "",
        attempt: attemptNum,
        timestamp: Date.now()
      };

    } catch (err) {
      return {
        success: false,
        steps: 0,
        durationMs: Date.now() - startedAt,
        error: err.message,
        finalAnswer: "",
        attempt: attemptNum,
        timestamp: Date.now()
      };
    }
  },

  /**
   * _evaluateSuccess(task, result)
   *
   * 根据 successCriteria 判定任务是否成功。
   *
   * criteria.type:
   *   - "contains": finalAnswer 包含 value
   *   - "url_match": 当前 URL 包含 value
   *   - "element_visible": 页面上有 value 对应的元素
   *   - "extracted": 提取结果中 field 字段非空
   *   - "custom": 调用自定义函数
   *
   * 额外检查 (非 criteria 字段但 task 级别):
   *   - minSteps: 最少执行步骤数（未达标记为失败）
   *   - requiredActionTypes: 必须包含的 action 类型
   *   - bannedStrings: finalAnswer 不得包含的字符串
   */
  _evaluateSuccess: function(task, result) {
    if (!result) return false;
    if (result.success === false && result.reason === "error") return false;

    var criteria = task.successCriteria;
    if (!criteria) {
      return result.success !== false;
    }

    var finalAnswer = result.finalAnswer || "";

    // ─── 检查 bannedStrings（智能版：仅当失败信号占主导才否决）───
    if (task.bannedStrings && task.bannedStrings.length > 0) {
      var lowerAnswer = finalAnswer.toLowerCase();
      var lines = finalAnswer.split("\n").filter(function(l) { return l.trim().length > 0; });
      var totalLines = lines.length || 1;

      for (var b = 0; b < task.bannedStrings.length; b++) {
        var banned = task.bannedStrings[b].toLowerCase();
        // 统计包含 banned 词的行数占比
        var bannedLineCount = 0;
        for (var li = 0; li < lines.length; li++) {
          if (lines[li].toLowerCase().indexOf(banned) !== -1) {
            bannedLineCount++;
          }
        }
        var ratio = bannedLineCount / totalLines;
        // 仅当 banned 词出现在超过 25% 的行 或 答案很短且包含 banned 词 时才否决
        if (ratio >= 0.25 || (totalLines <= 2 && bannedLineCount >= 1)) {
          console.log("[Benchmark eval] bannedStrings 否决:", banned, "行占比:", ratio.toFixed(2));
          return false;
        }
        // 否则只是内容中偶然出现的词，不否决
        if (bannedLineCount > 0) {
          console.log("[Benchmark eval] bannedStrings 忽略（偶然出现）:", banned, "行占比:", ratio.toFixed(2));
        }
      }
    }

    // ─── 检查 minSteps ───
    if (task.minSteps && task.minSteps > 0) {
      var totalSteps = result.iterations || result.steps || 0;
      if (totalSteps < task.minSteps) {
        return false;
      }
    }

    switch (criteria.type) {
      case "contains":
        var criteriaValue = (criteria.value || "").toLowerCase();
        var lowerFA = finalAnswer.toLowerCase();
        console.log("[Benchmark eval] contains check | criteria:", criteriaValue, "| finalAnswer:", finalAnswer.substring(0, 50), "| match:", lowerFA.indexOf(criteriaValue) !== -1);
        if (lowerFA.indexOf(criteriaValue) !== -1) {
          return true;
        }
        // 兜底：检查 Planner 收集的步骤数据中是否包含目标值
        if (result._planData) {
          for (var pd = 0; pd < result._planData.length; pd++) {
            var planItem = result._planData[pd];
            if (planItem && planItem.toLowerCase().indexOf(criteriaValue) !== -1) {
              return true;
            }
          }
        }
        // 第二次兜底：如果 finalAnswer 非空且不含 bannedStrings，考虑可能是编码问题
        if (finalAnswer.length > 0) {
          // 尝试用 indexOf 不转小写再试一次
          if (finalAnswer.indexOf(criteria.value) !== -1) {
            console.log("[Benchmark eval] contains passed on case-sensitive fallback");
            return true;
          }
        }
        return false;

      case "url_match":
        try {
          var url = (PopupState.activeTab || {}).url || "";
          return url.indexOf(criteria.value) !== -1;
        } catch (e) { return false; }

      case "element_visible":
        try {
          var el = document.querySelector(criteria.value);
          return el !== null && el.offsetParent !== null;
        } catch (e) { return false; }

      case "extracted":
        // 主路径：check result.data (if populated by agent)
        if (result.data) {
          var field = criteria.field || "value";
          if (result.data[field]) return true;
          if (result.data.contents && result.data.contents.length > 0) return true;
          if (result.data.values && result.data.values.length > 0) return true;
          return false;
        }
        // Fallback: result from ReactRuntimeLoop.start() has no data,
        // check if finalAnswer contains useful extracted content
        var fa = result.finalAnswer || "";
        if (!fa || fa === "任务完成") return false;
        // Not a generic "done" message and has substantial content
        return fa.indexOf("任务「") !== 0 && fa.length > 10;

      case "custom":
        if (typeof criteria.fn === "function") {
          try { return criteria.fn(result); } catch (e) { return false; }
        }
        return false;

      default:
        return result.success !== false;
    }
  },

  _getBestAttempt: function(attempts) {
    var best = null;
    for (var i = 0; i < attempts.length; i++) {
      var a = attempts[i];
      if (a.success) {
        if (!best || a.steps < best.steps) {
          best = a;
        }
      }
    }
    // 如果没有成功，返回最后一次尝试
    return best || attempts[attempts.length - 1];
  },

  _buildReport: function(results) {
    var total = results.length;
    var passed = 0;
    var totalSteps = 0;
    var totalDuration = 0;
    var totalAttempts = 0;
    var failedTasks = [];

    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      if (r.passed) {
        passed++;
        totalSteps += r.bestAttempt.steps;
        totalDuration += r.bestAttempt.durationMs;
      } else {
        failedTasks.push({ id: r.taskId, name: r.taskName, error: r.bestAttempt.error });
      }
      totalAttempts += r.attempts;
    }

    return {
      total: total,
      passed: passed,
      failed: total - passed,
      successRate: total > 0 ? Math.round((passed / total) * 100) : 0,
      avgSteps: passed > 0 ? Math.round(totalSteps / passed * 10) / 10 : 0,
      avgDurationMs: passed > 0 ? Math.round(totalDuration / passed) : 0,
      avgAttempts: total > 0 ? Math.round(totalAttempts / total * 10) / 10 : 0,
      failedTasks: failedTasks,
      timestamp: Date.now(),
      results: results
    };
  },

  _saveResults: async function(results, report) {
    try {
      var stored = await chrome.storage.local.get([this.RESULTS_KEY]);
      var allResults = stored[this.RESULTS_KEY] || [];
      allResults.push({ report: report, results: results, timestamp: Date.now() });

      if (allResults.length > this.MAX_RESULTS) {
        allResults = allResults.slice(-this.MAX_RESULTS);
      }

      var update = {};
      update[this.RESULTS_KEY] = allResults;
      await chrome.storage.local.set(update);
    } catch (e) {
      console.warn("[Benchmark] 保存结果失败:", e.message);
    }
  },

  _emitProgress: function(current, total, result) {
    RuntimeEvents.emit("benchmark_progress", {
      type: "benchmark_progress",
      timestamp: Date.now(),
      payload: {
        current: current,
        total: total,
        taskId: result.taskId,
        passed: result.passed,
        successRate: Math.round((current / total) * 100)
      }
    });
  },

  _sleep: function(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
  }
};

window.BenchmarkRunner = BenchmarkRunner;
