var AgentModeController = {

  _running: false,
  _elements: null,
  _lastLoopInfo: null,

  init: function(elements) {
    this._elements = elements;
    var self = this;

    elements.summaryModeBtn.addEventListener("click", function() {
      self.switchMode("summary");
    });

    elements.agentModeBtn.addEventListener("click", function() {
      self.switchMode("agent");
    });

    elements.agentRunBtn.addEventListener("click", function() {
      if (!self._running) {
        self.startAgent();
      }
    });

    elements.agentCancelBtn.addEventListener("click", function() {
      self.cancelAgent();
    });

    self._stepLogEl = document.getElementById("agentStepLog");

    this._bindRuntimeEvents();
  },

  switchMode: function(mode) {
    var el = this._elements;
    if (mode === "summary") {
      el.summaryModeBtn.classList.add("active");
      el.agentModeBtn.classList.remove("active");
      el.summaryModeContent.style.display = "block";
      el.agentModeContent.style.display = "none";
      PopupState.analyzeMode = "summary";
    } else {
      el.agentModeBtn.classList.add("active");
      el.summaryModeBtn.classList.remove("active");
      el.agentModeContent.style.display = "block";
      el.summaryModeContent.style.display = "none";
      PopupState.analyzeMode = "agent";
    }
  },

  startAgent: async function() {
    var el = this._elements;
    var goal = el.agentGoalInput.value.trim();
    if (!goal) {
      el.agentGoalInput.focus();
      return;
    }
    if (!PopupState.activeTab || !PopupState.activeTab.id) {
      el.agentCurrentStep.textContent = "\u8BF7\u5148\u7B49\u5F85\u9875\u9762\u5185\u5BB9\u52A0\u8F7D\u5B8C\u6210";
      return;
    }

    var data = await chrome.storage.sync.get(["deepseekApiKey"]);
    var apiKey = data.deepseekApiKey || "";
    if (PopupState.providerType !== "openclaw" && !apiKey) {
      el.agentCurrentStep.textContent = "\u8BF7\u5148\u5728\u8BBE\u7F6E\u4E2D\u914D\u7F6E API Key";
      return;
    }

    this._running = true;
    el.agentRunBtn.style.display = "none";
    el.agentCancelBtn.style.display = "inline-block";
    el.agentProgress.style.display = "block";
    el.agentAnswer.style.display = "none";
    el.planNodeList.innerHTML = "";
    el.agentCurrentStep.textContent = "\uD83D\uDD04 \u6B63\u5728\u521D\u59CB\u5316 Agent...";

    this._clearStepLog();

    var url = PopupState.activeTab.url || "";
    await BrowserMemory.load();
    BrowserMemory.recordVisit(url);

    try {
      var result = await RuntimeAPI.startTask({
        template: "agent",
        goal: goal,
        activeTab: PopupState.activeTab
      });

      var resultType = result && result.success ? "success" : "fail";
      BrowserMemory.recordGoal(goal, resultType, url);

      this._renderFinalAnswer(result);
    } catch (err) {
      BrowserMemory.recordGoal(goal, "error", url);
      this._renderFinalAnswer({
        success: false,
        error: err.message || "\u672A\u77E5\u9519\u8BEF"
      });
    } finally {
      this._running = false;
      el.agentRunBtn.style.display = "inline-block";
      el.agentCancelBtn.style.display = "none";
    }
  },

  cancelAgent: function() {
    RuntimeAPI.stopTask();
    this._running = false;
    var el = this._elements;
    el.agentRunBtn.style.display = "inline-block";
    el.agentCancelBtn.style.display = "none";
    el.agentCurrentStep.textContent = "\u23F9 \u5DF2\u53D6\u6D88";
  },

  updateRunButton: function() {
    var el = this._elements;
    if (!el || !el.agentRunBtn) return;
    var canRun = PopupState.activeTab &&
      PopupState.activeTab.id &&
      (PopupState.hasApiKey || PopupState.providerType === "openclaw");
    el.agentRunBtn.disabled = !canRun;
  },

  _clearStepLog: function() {
    if (!this._stepLogEl) return;
    this._stepLogEl.innerHTML = "";
  },

  _appendStepLog: function(icon, text, className) {
    if (!this._stepLogEl) return;
    var now = new Date();
    var time = pad2(now.getHours()) + ":" + pad2(now.getMinutes()) + ":" + pad2(now.getSeconds());

    var entry = document.createElement("div");
    entry.className = "log-entry " + (className || "");
    entry.innerHTML = '<span class="log-time">' + time + '</span><span class="log-icon">' + icon + '</span><span class="log-text">' + escapeHtml(text) + '</span>';

    this._stepLogEl.appendChild(entry);
    this._stepLogEl.scrollTop = this._stepLogEl.scrollHeight;
  },

  _bindRuntimeEvents: function() {
    var self = this;

    RuntimeAPI.subscribe("browser_action_started", function(data) {
      var payload = data.payload || data;
      var text = (payload.action || "") + (payload.selector ? " " + payload.selector : "");
      self._appendStepLog("\u26A1", text, "");
      self._elements.agentCurrentStep.textContent = "\u26A1 \u64CD\u4F5C: " + (payload.action || "");
    });

    RuntimeAPI.subscribe("browser_action_completed", function(data) {
      var payload = data.payload || data;
      var ms = payload.durationMs ? " (" + payload.durationMs + "ms)" : "";
      self._appendStepLog("\u2705", (payload.action || "") + " \u5B8C\u6210" + ms, "log-ok");
    });

    RuntimeAPI.subscribe("browser_action_failed", function(data) {
      var payload = data.payload || data;
      self._appendStepLog("\u274C", (payload.action || "") + " \u5931\u8D25: " + (payload.error || ""), "log-fail");
      self._elements.agentCurrentStep.textContent = "\u26A0 \u64CD\u4F5C\u5931\u8D25: " + (payload.error || "");
    });

    RuntimeAPI.subscribe("recovery_started", function(data) {
      var payload = data.payload || data;
      self._appendStepLog("\uD83D\uDD27", "\u6062\u590D\u4E2D: " + (payload.errorCategory || ""), "log-recovery");
    });

    RuntimeAPI.subscribe("recovery_completed", function(data) {
      var payload = data.payload || data;
      self._appendStepLog("\u2705", "\u6062\u590D\u6210\u529F: " + (payload.strategy || ""), "log-ok");
    });

    RuntimeAPI.subscribe("recovery_failed", function(data) {
      var payload = data.payload || data;
      self._appendStepLog("\u274C", "\u6062\u590D\u5931\u8D25: " + (payload.reason || ""), "log-fail");
    });

    RuntimeAPI.subscribe("plan_created", function(data) {
      var payload = data.payload || data;
      self._appendStepLog("\uD83D\uDCCB", "\u8BA1\u5212\u751F\u6210: " + (payload.stepCount || 0) + " \u6B65", "");
      var nodes = RuntimeAPI.getPlanNodes();
      if (nodes.length > 0) {
        self._renderPlanNodes(nodes);
      }
    });

    RuntimeAPI.subscribe("plan_step_started", function(data) {
      var payload = data.payload || data;
      self._updateNodeStatus(payload.nodeId, "running");
      self._elements.agentCurrentStep.textContent =
        "\u25B6 \u6267\u884C\u4E2D: " + (payload.description || payload.action || payload.nodeId || "");
    });

    RuntimeAPI.subscribe("plan_step_completed", function(data) {
      var payload = data.payload || data;
      self._updateNodeStatus(payload.nodeId, "completed");
    });

    RuntimeAPI.subscribe("plan_updated", function(data) {
      var payload = data.payload || data;
      if (payload.status === "failed" && payload.nodeId) {
        self._updateNodeStatus(payload.nodeId, "failed");
      }
      var nodes = RuntimeAPI.getPlanNodes();
      if (nodes.length > 0) {
        self._renderPlanNodes(nodes);
      }
    });

    RuntimeAPI.subscribe("plan_replanned", function(data) {
      var payload = data.payload || data;
      self._appendStepLog("\uD83D\uDD27", "\u91CD\u89C4\u5212: \u7B2C " + (payload.attempt || 1) + " \u6B21", "log-recovery");
      self._elements.agentCurrentStep.textContent =
        "\uD83D\uDD27 \u91CD\u89C4\u5212\u4E2D... (\u7B2C " + (payload.attempt || 1) + " \u6B21)";
      var nodes = RuntimeAPI.getPlanNodes();
      if (nodes.length > 0) {
        self._renderPlanNodes(nodes);
      }
    });

    RuntimeAPI.subscribe("plan_failed", function(data) {
      var payload = data.payload || data;
      self._appendStepLog("\u274C", "\u8BA1\u5212\u5931\u8D25: " + (payload.reason || "\u672A\u77E5\u539F\u56E0"), "log-fail");
      self._elements.agentCurrentStep.textContent =
        "\u274C \u8BA1\u5212\u5931\u8D25: " + (payload.reason || "\u672A\u77E5\u539F\u56E0");
    });

    RuntimeAPI.subscribe("loop_tick", function(data) {
      var payload = data.payload || data;
      var iter = payload.iteration || "?";
      if (self._elements.agentCurrentStep.textContent.indexOf("\u6267\u884C\u4E2D") === -1) {
        self._elements.agentCurrentStep.textContent = "\uD83D\uDD04 \u5FAA\u73AF #" + iter;
      }
    });

    RuntimeAPI.subscribe("loop_stopped", function(data) {
      var payload = data.payload || data;
      self._lastLoopInfo = {
        iterations: payload.iterations || 0,
        reason: payload.reason || "unknown"
      };
      var reason = payload.reason || "unknown";
      var labels = {
        planner_done: "\u2705 \u6267\u884C\u5B8C\u6210",
        user_stop: "\u23F9 \u5DF2\u505C\u6B62",
        max_iterations: "\u26A0 \u8FBE\u5230\u6700\u5927\u5FAA\u73AF\u6B21\u6570",
        timeout: "\u26A0 \u6267\u884C\u8D85\u65F6",
        circuit_break: "\u26A0 \u8FDE\u7EED\u5931\u8D25\u7194\u65AD",
        error: "\u274C \u6267\u884C\u9519\u8BEF"
      };
      self._elements.agentCurrentStep.textContent = labels[reason] || ("\u23F9 \u5DF2\u505C\u6B62: " + reason);
    });

    RuntimeAPI.subscribe("loop_error", function(data) {
      var payload = data.payload || data;
      self._appendStepLog("\u274C", "Loop \u9519\u8BEF: " + (payload.error || ""), "log-fail");
      self._elements.agentCurrentStep.textContent = "\u274C \u9519\u8BEF: " + (payload.error || "");
    });
  },

  _renderPlanNodes: function(nodes) {
    var el = this._elements;
    el.planNodeList.innerHTML = "";

    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var div = document.createElement("div");
      div.className = "plan-node " + (node.status || "pending");
      div.id = "plan-node-" + node.id;

      var iconMap = {
        pending: "\u25EF",
        running: "\u25B6",
        completed: "\u2713",
        failed: "\u2717",
        skipped: "\u21B7"
      };
      var statusMap = {
        pending: "\u5F85\u6267\u884C",
        running: "\u6267\u884C\u4E2D",
        completed: "\u5B8C\u6210",
        failed: "\u5931\u8D25",
        skipped: "\u5DF2\u8DF3\u8FC7"
      };

      var icon = document.createElement("span");
      icon.className = "plan-node-icon";
      icon.textContent = iconMap[node.status] || "\u25EF";

      var label = document.createElement("span");
      label.className = "plan-node-label";
      label.textContent = node.description || node.action || node.id;

      var status = document.createElement("span");
      status.className = "plan-node-status";
      status.textContent = statusMap[node.status] || node.status;

      div.appendChild(icon);
      div.appendChild(label);
      div.appendChild(status);
      el.planNodeList.appendChild(div);
    }
  },

  _updateNodeStatus: function(nodeId, status) {
    if (!nodeId) return;
    var nodeEl = document.getElementById("plan-node-" + nodeId);
    if (!nodeEl) return;

    var iconMap = {
      running: "\u25B6",
      completed: "\u2713",
      failed: "\u2717",
      skipped: "\u21B7"
    };
    var statusMap = {
      running: "\u6267\u884C\u4E2D",
      completed: "\u5B8C\u6210",
      failed: "\u5931\u8D25",
      skipped: "\u5DF2\u8DF3\u8FC7"
    };

    nodeEl.className = "plan-node " + status;
    var iconEl = nodeEl.querySelector(".plan-node-icon");
    if (iconEl) iconEl.textContent = iconMap[status] || "\u25EF";
    var statusEl = nodeEl.querySelector(".plan-node-status");
    if (statusEl) statusEl.textContent = statusMap[status] || status;
  },

  _renderFinalAnswer: function(result) {
    var el = this._elements;
    var answer = "";
    var isError = false;
    var summary = "";

    if (result) {
      if (result.finalAnswer) {
        answer = result.finalAnswer;
      } else if (result.success === false && result.error) {
        answer = result.error;
        isError = true;
      } else if (result.reason && result.error) {
        answer = result.reason + ": " + result.error;
        isError = true;
      } else if (typeof result === "string") {
        answer = result;
      }
    }

    if (!answer) {
      answer = "\u4EFB\u52A1\u5DF2\u5B8C\u6210\uFF08\u65E0\u8BE6\u7EC6\u7ED3\u679C\uFF09";
    }

    var iterations = (result && result.iterations) || (this._lastLoopInfo && this._lastLoopInfo.iterations) || 0;
    if (iterations > 0) {
      summary = "\u2705 \u4EFB\u52A1\u5B8C\u6210 \u00B7 \u5171\u6267\u884C " + iterations + " \u6B65";
    }

    var html = "";
    if (!isError && summary) {
      html += '<div class="answer-meta">' + escapeHtml(summary) + '</div>';
    }
    if (isError) {
      html += '<div class="answer-meta answer-error-meta">\u274C ' + escapeHtml(summary || "\u4EFB\u52A1\u5931\u8D25") + '</div>';
    }
    html += '<div class="answer-body' + (isError ? ' answer-error' : '') + '">';
    var lines = answer.split("\n");
    for (var i = 0; i < lines.length; i++) {
      html += escapeHtml(lines[i]) || "&nbsp;";
      if (i < lines.length - 1) html += "<br>";
    }
    html += '</div>';

    el.agentAnswerText.innerHTML = html;
    el.agentAnswer.style.display = "block";
    el.agentAnswer.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
};
