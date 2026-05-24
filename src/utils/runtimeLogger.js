var RuntimeLogger = {

  LEVELS: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, FATAL: 4, NONE: 5 },

  _level: 1,
  _labelMap: { 0: "DBG", 1: "INF", 2: "WRN", 3: "ERR", 4: "FTL" },

  configure: function(options) {
    options = options || {};
    if (options.level !== undefined) this._level = options.level;
  },

  setLevel: function(levelName) {
    var num = this.LEVELS[levelName];
    if (num !== undefined) this._level = num;
  },

  getLevel: function() {
    for (var key in this.LEVELS) {
      if (this.LEVELS[key] === this._level) return key;
    }
    return "INFO";
  },

  _shouldLog: function(levelNum) {
    return levelNum >= this._level;
  },

  _format: function(levelNum, tag, message) {
    var label = this._labelMap[levelNum] || "???";
    return "[" + label + "][" + tag + "] " + message;
  },

  debug: function(tag, message) {
    if (this._shouldLog(0)) console.debug(this._format(0, tag, message));
  },

  info: function(tag, message) {
    if (this._shouldLog(1)) console.log(this._format(1, tag, message));
  },

  warn: function(tag, message) {
    if (this._shouldLog(2)) console.warn(this._format(2, tag, message));
  },

  error: function(tag, message) {
    if (this._shouldLog(3)) console.error(this._format(3, tag, message));
  },

  fatal: function(tag, message) {
    if (this._shouldLog(4)) console.error(this._format(4, tag, message));
  }
};

RuntimeLogger.info("RuntimeLogger", "日志系统已初始化 level=" + RuntimeLogger.getLevel());

// ==========================================
//   共享工具函数
// ==========================================

var RUNTIME_LIMITS = {
  MAX_OUTPUT_LENGTH: 12000,
  REQUEST_TIMEOUT_MS: 30000,
  MAX_PARSE_RETRIES: 1
};

var RUNTIME_ERROR_CATEGORIES = {
  SELECTOR_NOT_FOUND: "selector_not_found",
  TIMEOUT: "timeout",
  PAGE_CHANGED: "page_changed",
  STALE_ELEMENT: "stale_element",
  BLOCKED_ACTION: "blocked_action",
  CONNECTION_LOST: "connection_lost",
  UNKNOWN: "unknown"
};

function sanitizeLLMOutput(raw) {
  if (!raw || typeof raw !== "string") throw new Error("AI 返回内容为空");
  var cleaned = raw.trim();
  if (cleaned.length > RUNTIME_LIMITS.MAX_OUTPUT_LENGTH) {
    throw new Error("AI 返回内容过长 (" + cleaned.length + " > " + RUNTIME_LIMITS.MAX_OUTPUT_LENGTH + ")");
  }
  var jsonBlock = cleaned.match(/```json\s*([\s\S]*?)```/);
  if (jsonBlock && jsonBlock[1]) {
    cleaned = jsonBlock[1].trim();
  } else {
    var codeBlock = cleaned.match(/```\s*([\s\S]*?)```/);
    if (codeBlock && codeBlock[1]) {
      cleaned = codeBlock[1].trim();
    } else if (cleaned.indexOf("{") !== -1 && cleaned.indexOf("}") !== -1) {
      var start = cleaned.indexOf("{");
      var end = cleaned.lastIndexOf("}");
      if (start < end) cleaned = cleaned.substring(start, end + 1);
    }
  }
  // 移除尾随逗号（JSON 标准不容忍）
  cleaned = cleaned.replace(/,\s*}/g, "}");
  cleaned = cleaned.replace(/,\s*]/g, "]");
  // 截断 JSON 之后的多余文本
  var lastBrace = cleaned.lastIndexOf("}");
  if (lastBrace > 0) {
    var afterBrace = cleaned.substring(lastBrace + 1).trim();
    if (afterBrace.length > 0) {
      cleaned = cleaned.substring(0, lastBrace + 1);
    }
  }
  return cleaned;
}

function classifyRuntimeError(errorMsg) {
  if (!errorMsg) return RUNTIME_ERROR_CATEGORIES.UNKNOWN;
  var lower = errorMsg.toLowerCase();
  if (lower.indexOf("receiving end does not exist") !== -1 ||
      lower.indexOf("could not establish") !== -1 ||
      lower.indexOf("content script") !== -1) return RUNTIME_ERROR_CATEGORIES.CONNECTION_LOST;
  if (lower.indexOf("元素不存在") !== -1 || lower.indexOf("未找到") !== -1 ||
      lower.indexOf("selector") !== -1 || lower.indexOf("元素不可见") !== -1) return RUNTIME_ERROR_CATEGORIES.SELECTOR_NOT_FOUND;
  if (lower.indexOf("超时") !== -1 || lower.indexOf("timeout") !== -1) return RUNTIME_ERROR_CATEGORIES.TIMEOUT;
  if (lower.indexOf("页面变化") !== -1 || lower.indexOf("page changed") !== -1 ||
      lower.indexOf("navigation") !== -1) return RUNTIME_ERROR_CATEGORIES.PAGE_CHANGED;
  if (lower.indexOf("stale") !== -1 || lower.indexOf("detached") !== -1 ||
      lower.indexOf("元素已禁用") !== -1) return RUNTIME_ERROR_CATEGORIES.STALE_ELEMENT;
  if (lower.indexOf("安全策略阻止") !== -1 || lower.indexOf("blocked") !== -1 ||
      lower.indexOf("危险") !== -1) return RUNTIME_ERROR_CATEGORIES.BLOCKED_ACTION;
  return RUNTIME_ERROR_CATEGORIES.UNKNOWN;
}
