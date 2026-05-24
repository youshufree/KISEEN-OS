var StepEvaluator = {

  evaluate: async function(step, actionResult, observation, context) {
    if (!step) return { completed: false, confidence: 0, reason: "无步骤" };
    if (!actionResult) return { completed: false, confidence: 0, reason: "无执行结果" };

    if (!actionResult.success) {
      return {
        completed: false,
        confidence: 0,
        reason: actionResult.error || "Action 执行失败"
      };
    }

    var action = step.action || step.type;

    var evaluator = this._evaluators[action];
    if (evaluator) {
      return evaluator(step, actionResult, observation, context);
    }

    return this._defaultEvaluate(step, actionResult, observation);
  },

  _evaluators: {},

  registerEvaluator: function(actionType, evaluatorFn) {
    this._evaluators[actionType] = evaluatorFn;
  },

  _defaultEvaluate: function(step, actionResult, observation) {
    if (actionResult.success) {
      return {
        completed: true,
        confidence: 0.7,
        reason: "Action 执行成功"
      };
    }

    return {
      completed: false,
      confidence: 0,
      reason: actionResult.error || "执行失败"
    };
  }
};

StepEvaluator.registerEvaluator("click", function(step, actionResult, observation) {
  if (!actionResult.success) {
    return { completed: false, confidence: 0, reason: actionResult.error || "点击失败" };
  }

  var confidence = 0.6;
  var reason = "点击成功";

  if (observation) {
    var obsText = (observation.observationText || observation.summary || "").toLowerCase();
    var targetText = step.target && step.target.text ? step.target.text.toLowerCase() : "";

    if (targetText && obsText.indexOf(targetText) === -1) {
      confidence = 0.5;
      reason = "点击成功，但页面未明显变化";
    } else {
      confidence = 0.8;
      reason = "点击成功，页面状态已变化";
    }
  }

  return { completed: true, confidence: confidence, reason: reason };
});

StepEvaluator.registerEvaluator("input", function(step, actionResult, observation) {
  if (!actionResult.success) {
    return { completed: false, confidence: 0, reason: actionResult.error || "输入失败" };
  }

  var inputValue = step.params && step.params.value ? step.params.value : "";
  var confidence = 0.7;
  var reason = "输入成功";

  if (observation && inputValue) {
    var obsText = (observation.observationText || observation.summary || "").toLowerCase();
    if (obsText.indexOf(inputValue.toLowerCase()) !== -1) {
      confidence = 0.9;
      reason = "输入成功，页面可见输入内容";
    }
  }

  return { completed: true, confidence: confidence, reason: reason };
});

StepEvaluator.registerEvaluator("scroll", function(step, actionResult, observation) {
  if (!actionResult.success) {
    return { completed: false, confidence: 0, reason: actionResult.error || "滚动失败" };
  }

  return {
    completed: true,
    confidence: 0.8,
    reason: "滚动完成"
  };
});

StepEvaluator.registerEvaluator("extract", function(step, actionResult, observation) {
  if (!actionResult.success) {
    return { completed: false, confidence: 0, reason: actionResult.error || "提取失败" };
  }

  var data = actionResult.data || {};
  var contents = data.contents || [];
  var count = data.count || 0;
  var confidence = 0.6;
  var reason = "提取成功";

  // 元素存在但内容为空（常见于动态渲染页面）
  if (contents.length === 0 && count === 0) {
    return {
      completed: true,
      confidence: 0.3,
      reason: "提取完成但未找到匹配元素"
    };
  }

  var hasText = false;
  for (var i = 0; i < contents.length; i++) {
    if (contents[i].text && contents[i].text.trim().length > 0) {
      hasText = true;
      break;
    }
  }

  if (hasText) {
    confidence = 0.9;
    reason = "提取成功，内容丰富 (" + contents.length + " 项)";
  } else {
    confidence = 0.4;
    reason = "提取成功但文本内容较少（" + (count || contents.length) + " 项）";
  }

  return { completed: true, confidence: confidence, reason: reason };
});

StepEvaluator.registerEvaluator("wait_element", function(step, actionResult, observation) {
  if (!actionResult.success) {
    return { completed: false, confidence: 0, reason: actionResult.error || "等待元素超时" };
  }

  return {
    completed: true,
    confidence: 0.9,
    reason: "元素已出现"
  };
});
