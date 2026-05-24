var LoopController = {

  DEFAULT_LIMITS: {
    maxIterations: 20,
    timeoutMs: 180000,
    maxConsecutiveFailures: 3,
    tickIntervalMs: 500,
    maxRecoveryAttemptsPerStep: 3,
    emergencyStopEnabled: true
  },

  _limits: null,
  _state: "stopped",
  _startedAt: null,
  _pausedAt: null,
  _totalPausedMs: 0,
  _iteration: 0,
  _currentGoal: null,
  _lastAction: null,
  _lastObservation: null,
  _emergencyStopped: false,

  configure: function(limits) {
    this._limits = {};
    for (var key in this.DEFAULT_LIMITS) {
      if (this.DEFAULT_LIMITS.hasOwnProperty(key)) {
        this._limits[key] = (limits && limits.hasOwnProperty(key))
          ? limits[key]
          : this.DEFAULT_LIMITS[key];
      }
    }
  },

  start: function(goal) {
    this._state = "running";
    this._startedAt = Date.now();
    this._pausedAt = null;
    this._totalPausedMs = 0;
    this._iteration = 0;
    this._currentGoal = goal || "";
    this._lastAction = null;
    this._lastObservation = null;
    this._emergencyStopped = false;

    if (!this._limits) this.configure();

    console.log("[RuntimeLoop] 控制器启动, 目标:", this._currentGoal);
  },

  pause: function() {
    if (this._state !== "running") return false;
    this._state = "paused";
    this._pausedAt = Date.now();
    console.log("[RuntimeLoop] 暂停, iteration:", this._iteration);
    return true;
  },

  resume: function() {
    if (this._state !== "paused") return false;
    if (this._pausedAt) {
      this._totalPausedMs += Date.now() - this._pausedAt;
    }
    this._state = "running";
    this._pausedAt = null;
    console.log("[RuntimeLoop] 恢复, iteration:", this._iteration);
    return true;
  },

  stop: function() {
    this._state = "stopped";
    console.log("[RuntimeLoop] 停止, iteration:", this._iteration);
  },

  emergencyStop: function() {
    this._state = "stopped";
    this._emergencyStopped = true;
    console.warn("[RuntimeLoop] 紧急停止!");
  },

  canTick: function() {
    if (this._state !== "running") return false;
    if (this._emergencyStopped) return false;

    if (this._iteration >= this._limits.maxIterations) {
      console.warn("[RuntimeLoop] 达到最大 iteration:", this._limits.maxIterations);
      return false;
    }

    var elapsed = Date.now() - this._startedAt - this._totalPausedMs;
    if (this._pausedAt) {
      elapsed -= (Date.now() - this._pausedAt);
    }
    if (elapsed >= this._limits.timeoutMs) {
      console.warn("[RuntimeLoop] 超时:", this._limits.timeoutMs + "ms");
      return false;
    }

    return true;
  },

  shouldCircuitBreak: function(consecutiveFailures) {
    if (consecutiveFailures >= this._limits.maxConsecutiveFailures) {
      console.warn("[RuntimeLoop] 连续失败熔断:", consecutiveFailures);
      return true;
    }
    return false;
  },

  incrementIteration: function() {
    this._iteration++;
  },

  setLastAction: function(action) {
    this._lastAction = action;
  },

  setLastObservation: function(observation) {
    this._lastObservation = observation;
  },

  getState: function() {
    return {
      state: this._state,
      iteration: this._iteration,
      startedAt: this._startedAt,
      currentGoal: this._currentGoal,
      lastAction: this._lastAction,
      lastObservation: this._lastObservation,
      emergencyStopped: this._emergencyStopped,
      elapsedMs: this._startedAt ? (Date.now() - this._startedAt - this._totalPausedMs) : 0,
      maxIterations: this._limits ? this._limits.maxIterations : this.DEFAULT_LIMITS.maxIterations,
      timeoutMs: this._limits ? this._limits.timeoutMs : this.DEFAULT_LIMITS.timeoutMs
    };
  },

  isRunning: function() {
    return this._state === "running";
  },

  isPaused: function() {
    return this._state === "paused";
  },

  isStopped: function() {
    return this._state === "stopped";
  },

  getIteration: function() {
    return this._iteration;
  },

  getTickInterval: function() {
    return this._limits ? this._limits.tickIntervalMs : this.DEFAULT_LIMITS.tickIntervalMs;
  },

  getStopReason: function() {
    if (this._emergencyStopped) return "emergency_stop";
    if (this._iteration >= this._limits.maxIterations) return "max_iterations";
    var elapsed = Date.now() - this._startedAt - this._totalPausedMs;
    if (elapsed >= this._limits.timeoutMs) return "timeout";
    if (this._state === "stopped") return "user_stop";
    return "unknown";
  },

  reset: function() {
    this._state = "stopped";
    this._startedAt = null;
    this._pausedAt = null;
    this._totalPausedMs = 0;
    this._iteration = 0;
    this._currentGoal = null;
    this._lastAction = null;
    this._lastObservation = null;
    this._emergencyStopped = false;
  }
};
