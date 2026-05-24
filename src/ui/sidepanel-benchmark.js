/**
 * sidepanel-benchmark.js — Benchmark 基准测试面板
 *
 * 职责：运行 Benchmark 任务 / 显示进度 / 显示结果
 */
var SidepanelBenchmark = {

  _running: false,
  _elements: {},

  init: function() {
    var self = this;
    self._elements = {
      runBtn: document.getElementById("benchmarkRunBtn"),
      cancelBtn: document.getElementById("benchmarkCancelBtn"),
      progressBar: document.getElementById("benchmarkProgressBar"),
      progressText: document.getElementById("benchmarkProgressText"),
      resultSummary: document.getElementById("benchmarkResultSummary"),
      resultTable: document.getElementById("benchmarkResultTable"),
      statusEl: document.getElementById("benchmarkStatus")
    };

    self._elements.runBtn.addEventListener("click", function() {
      self.runAll();
    });

    self._elements.cancelBtn.addEventListener("click", function() {
      self.cancel();
    });

    // 监听 benchmark_progress 事件
    RuntimeAPI.subscribe("benchmark_progress", function(payload) {
      self._onProgress(payload);
    });
  },

  runAll: async function() {
    var self = this;
    if (self._running) return;

    if (!window.BENCHMARK_TASKS || window.BENCHMARK_TASKS.length === 0) {
      self._elements.statusEl.textContent = "错误: 未加载 Benchmark 任务定义";
      return;
    }

    self._running = true;
    self._elements.runBtn.disabled = true;
    self._elements.cancelBtn.style.display = "inline-block";
    self._elements.progressBar.style.width = "0%";
    self._elements.progressText.textContent = "0 / " + window.BENCHMARK_TASKS.length;
    self._elements.resultSummary.innerHTML = "";
    self._elements.resultTable.innerHTML = "";
    self._elements.statusEl.textContent = "正在运行基准测试...";
    self._elements.statusEl.className = "";

    try {
      var report = await BenchmarkRunner.runAll(window.BENCHMARK_TASKS, {
        maxAttempts: 1
      });

      self._renderResults(report);
      self._elements.statusEl.textContent = "✅ 测试完成 — 通过率: " + report.successRate + "%";
      self._elements.statusEl.className = "benchmark-done";
    } catch (err) {
      self._elements.statusEl.textContent = "❌ 测试失败: " + (err.message || "未知错误");
      self._elements.statusEl.className = "benchmark-error";
      console.error("[Benchmark] 运行失败:", err);
    } finally {
      self._running = false;
      self._elements.runBtn.disabled = false;
      self._elements.cancelBtn.style.display = "none";
    }
  },

  cancel: function() {
    if (!this._running) return;
    RuntimeAPI.stopTask();
    this._running = false;
    this._elements.runBtn.disabled = false;
    this._elements.cancelBtn.style.display = "none";
    this._elements.statusEl.textContent = "已取消";
  },

  _onProgress: function(payload) {
    var self = this;
    var data = payload.payload || payload;
    if (!data || !data.total) return;

    var pct = Math.round((data.current / data.total) * 100);
    self._elements.progressBar.style.width = pct + "%";
    self._elements.progressText.textContent = data.current + " / " + data.total;
  },

  _renderResults: function(report) {
    var self = this;

    // 汇总卡片
    var summary = self._elements.resultSummary;
    var passRate = report.successRate;
    var color = passRate >= 80 ? "#10b981" : passRate >= 60 ? "#f59e0b" : "#ef4444";

    summary.innerHTML = [
      '<div style="display:flex;gap:12px;flex-wrap:wrap;">',
      '<div style="flex:1;min-width:80px;text-align:center;padding:8px;background:#f8fafc;border-radius:6px;">',
      '<div style="font-size:28px;font-weight:bold;color:' + color + ';">' + passRate + '%</div>',
      '<div style="font-size:11px;color:#64748b;">通过率</div>',
      '</div>',
      '<div style="flex:1;min-width:60px;text-align:center;padding:8px;background:#f8fafc;border-radius:6px;">',
      '<div style="font-size:22px;font-weight:bold;color:#334155;">' + report.passed + '/' + report.total + '</div>',
      '<div style="font-size:11px;color:#64748b;">通过</div>',
      '</div>',
      '<div style="flex:1;min-width:60px;text-align:center;padding:8px;background:#f8fafc;border-radius:6px;">',
      '<div style="font-size:22px;font-weight:bold;color:#334155;">' + report.avgSteps + '</div>',
      '<div style="font-size:11px;color:#64748b;">平均步数</div>',
      '</div>',
      '<div style="flex:1;min-width:80px;text-align:center;padding:8px;background:#f8fafc;border-radius:6px;">',
      '<div style="font-size:22px;font-weight:bold;color:#334155;">' + (report.avgDurationMs / 1000).toFixed(1) + 's</div>',
      '<div style="font-size:11px;color:#64748b;">平均耗时</div>',
      '</div>',
      '</div>'
    ].join("");

    // 详细结果表格
    var table = self._elements.resultTable;
    var rows = [];
    for (var i = 0; i < report.results.length; i++) {
      var r = report.results[i];
      var icon = r.passed ? "✅" : "❌";
      var rowClass = r.passed ? "benchmark-pass" : "benchmark-fail";
      var duration = r.bestAttempt ? (r.bestAttempt.durationMs / 1000).toFixed(1) + "s" : "—";
      var steps = r.bestAttempt ? r.bestAttempt.steps : "—";
      var error = r.bestAttempt && r.bestAttempt.error
        ? r.bestAttempt.error.substring(0, 80)
        : "";

      rows.push(
        '<tr class="' + rowClass + '">' +
        '<td>' + icon + '</td>' +
        '<td>' + r.taskName + '</td>' +
        '<td>' + r.category + '</td>' +
        '<td>' + steps + '</td>' +
        '<td>' + duration + '</td>' +
        '<td style="font-size:11px;color:#64748b;">' + (error || "—") + '</td>' +
        '</tr>'
      );
    }

    table.innerHTML = [
      '<table style="width:100%;border-collapse:collapse;font-size:12px;">',
      '<thead>',
      '<tr style="text-align:left;border-bottom:1px solid #e2e8f0;">',
      '<th></th><th>任务</th><th>类别</th><th>步数</th><th>耗时</th><th>备注</th>',
      '</tr>',
      '</thead>',
      '<tbody>',
      rows.join(""),
      '</tbody>',
      '</table>'
    ].join("");
  }
};
