/**
 * validationIntegration.js — Validation 系统集成层
 *
 * 职责：
 *   1. 提供 validateBeforeExecution() 方法，在 Action 执行前验证 selector
 *   2. 通过 SelectorValidator 检查元素是否存在
 *   3. 如果验证失败，返回修正建议
 *   4. 不修改现有执行流程，作为可选工具模块
 *
 * 运行环境：SidePanel
 */

var ValidationIntegration = {

  validateBeforeExecution: async function(action, tabId) {
    if (!action || !action.target) {
      return { valid: true, reason: null, fixedAction: null };
    }
    if (!action.target.selector && !action.target.text) {
      return { valid: true, reason: null, fixedAction: null };
    }
    try {
      var result = await SelectorValidator.validateTarget(action.target, tabId);
      if (result.valid) {
        return { valid: true, reason: null, fixedAction: null };
      }
      if (result.suggestion) {
        var fixedAction = this._applySuggestion(action, result.suggestion);
        return { valid: false, reason: result.reason, fixedAction: fixedAction };
      }
      return { valid: false, reason: result.reason, fixedAction: null };
    } catch (err) {
      return { valid: true, reason: null, fixedAction: null };
    }
  },

  validateAndFixPlan: async function(steps, tabId) {
    if (!steps || !Array.isArray(steps)) return steps;
    var fixedSteps = [];
    for (var i = 0; i < steps.length; i++) {
      var step = steps[i];
      if (step.target && (step.target.selector || step.target.text)) {
        var result = await this.validateBeforeExecution(step, tabId);
        if (result.fixedAction) {
          fixedSteps.push(result.fixedAction);
        } else {
          fixedSteps.push(step);
        }
      } else {
        fixedSteps.push(step);
      }
    }
    return fixedSteps;
  },

  _applySuggestion: function(action, suggestion) {
    var fixed = JSON.parse(JSON.stringify(action));
    if (suggestion.selector) {
      fixed.target.selector = suggestion.selector;
    }
    if (suggestion.text) {
      fixed.target.text = suggestion.text;
      delete fixed.target.selector;
    }
    return fixed;
  }
};