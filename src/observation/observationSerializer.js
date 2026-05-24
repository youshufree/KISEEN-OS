/**
 * ObservationSerializer - Observation Token 大小控制层
 *
 * 职责：
 *   1. 将 Observation 序列化为 LLM 可消费的文本
 *   2. 控制 Token 大小（maxTextLength / includeDOM / includeForms / includeImages）
 *   3. 避免 Observation 无限膨胀
 *   4. 发射 observation_serialized 事件
 *
 * 运行环境：SidePanel / Popup
 */

var ObservationSerializer = {

  DEFAULT_OPTIONS: {
    maxTextLength: 4000,
    includeDOM: true,
    includeForms: true,
    includeImages: false,
    maxInteractiveElements: 15,
    maxForms: 5,
    maxActions: 8
  },

  /**
   * serialize(observation, options)
   *
   * observation: ObservationBuilder.build() 的返回值
   * options: {
   *   maxTextLength: 4000,
   *   includeDOM: true,
   *   includeForms: true,
   *   includeImages: false,
   *   maxInteractiveElements: 15,
   *   maxForms: 5,
   *   maxActions: 8
   * }
   *
   * 返回：string（给 LLM 的观察文本）
   */
  serialize: function(observation, options) {
    if (!observation) return "无页面观察数据";

    var opts = this._mergeOptions(options);
    var lines = [];

    lines.push("=== 页面观察 ===");
    lines.push("");

    if (observation.summary) {
      lines.push(observation.summary);
      lines.push("");
    }

    if (observation.observationText) {
      var text = observation.observationText;
      if (text.length > opts.maxTextLength) {
        text = text.substring(0, opts.maxTextLength) + "\n...（内容已截断）";
      }
      lines.push(text);
    }

    if (opts.includeDOM && observation.interactiveElements) {
      var elements = observation.interactiveElements;
      var visibleElements = [];
      for (var i = 0; i < elements.length; i++) {
        if (elements[i].visible) visibleElements.push(elements[i]);
      }

      if (visibleElements.length > 0) {
        lines.push("");
        lines.push("=== DOM 可交互元素（" + visibleElements.length + " 个可见）===");

        var count = Math.min(visibleElements.length, opts.maxInteractiveElements);
        for (var j = 0; j < count; j++) {
          var el = visibleElements[j];
          var desc = "  " + (j + 1) + ". [" + el.tag.toUpperCase() + "]";
          if (el.text) desc += " 「" + el.text + "」";
          if (el.selector) desc += " selector=" + el.selector;
          if (el.type) desc += " type=" + el.type;
          if (el.href) desc += " href=" + el.href.substring(0, 80);
          lines.push(desc);
        }

        if (visibleElements.length > opts.maxInteractiveElements) {
          lines.push("  ... 还有 " + (visibleElements.length - opts.maxInteractiveElements) + " 个元素未显示");
        }
      }
    }

    if (opts.includeForms && observation.forms && observation.forms.length > 0) {
      lines.push("");
      lines.push("=== 表单结构 ===");

      var formCount = Math.min(observation.forms.length, opts.maxForms);
      for (var f = 0; f < formCount; f++) {
        var form = observation.forms[f];
        var formDesc = "  表单" + (f + 1);
        if (form.id) formDesc += " (#" + form.id + ")";
        if (form.action) formDesc += " action=" + form.action.substring(0, 80);
        formDesc += " method=" + (form.method || "get");
        lines.push(formDesc);

        if (form.inputs) {
          for (var inp = 0; inp < form.inputs.length && inp < 8; inp++) {
            var input = form.inputs[inp];
            var inputDesc = "    - " + input.tag;
            if (input.type) inputDesc += " type=" + input.type;
            if (input.name) inputDesc += " name=" + input.name;
            if (input.placeholder) inputDesc += " placeholder=\"" + input.placeholder + "\"";
            lines.push(inputDesc);
          }
          if (form.inputs.length > 8) {
            lines.push("    ... 还有 " + (form.inputs.length - 8) + " 个输入项");
          }
        }
      }
    }

    if (observation.availableActions && observation.availableActions.length > 0) {
      lines.push("");
      lines.push("=== 可用操作 ===");
      var actionCount = Math.min(observation.availableActions.length, opts.maxActions);
      for (var a = 0; a < actionCount; a++) {
        lines.push("  " + (a + 1) + ". " + observation.availableActions[a]);
      }
    }

    var result = lines.join("\n");

    RuntimeEvents.emit("observation_serialized", {
      type: "observation_serialized",
      timestamp: Date.now(),
      payload: {
        totalLength: result.length,
        interactiveCount: observation.interactiveElements ? observation.interactiveElements.length : 0,
        formCount: observation.forms ? observation.forms.length : 0,
        truncated: result.length >= opts.maxTextLength
      }
    });

    return result;
  },

  /**
   * serializeCompact(observation)
   *
   * 精简版序列化，只保留核心信息。
   * 用于 Token 预算紧张的场景。
   */
  serializeCompact: function(observation) {
    return this.serialize(observation, {
      maxTextLength: 2000,
      includeDOM: true,
      includeForms: false,
      includeImages: false,
      maxInteractiveElements: 8,
      maxForms: 2,
      maxActions: 5
    });
  },

  /**
   * getObservationStats(observation)
   *
   * 返回观察数据的统计信息，供 UI Trace 面板使用。
   */
  getObservationStats: function(observation) {
    if (!observation) return {};

    var interactiveCount = observation.interactiveElements ? observation.interactiveElements.length : 0;
    var visibleCount = 0;
    if (observation.interactiveElements) {
      for (var i = 0; i < observation.interactiveElements.length; i++) {
        if (observation.interactiveElements[i].visible) visibleCount++;
      }
    }

    return {
      pageType: observation.pageType || "unknown",
      interactiveCount: interactiveCount,
      visibleInteractiveCount: visibleCount,
      formCount: observation.forms ? observation.forms.length : 0,
      actionCount: observation.availableActions ? observation.availableActions.length : 0,
      observationSize: observation.observationText ? observation.observationText.length : 0
    };
  },

  _mergeOptions: function(options) {
    if (!options) return this.DEFAULT_OPTIONS;

    var merged = {};
    for (var key in this.DEFAULT_OPTIONS) {
      if (this.DEFAULT_OPTIONS.hasOwnProperty(key)) {
        merged[key] = options.hasOwnProperty(key) ? options[key] : this.DEFAULT_OPTIONS[key];
      }
    }
    return merged;
  }
};
