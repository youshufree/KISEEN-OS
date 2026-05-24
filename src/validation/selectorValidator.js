/**
 * selectorValidator.js — Selector 执行前验证
 *
 * 职责：
 *   1. 在 Action 执行前验证 selector 是否在页面上存在
 *   2. 验证元素是否可见、可交互
 *   3. 提供 fallback 建议（文本匹配、aria-label 等）
 *   4. 减少无效的 Recovery 循环
 *
 * 核心理念：
 *   "Prevention is better than cure"
 *   在执行前发现不可用的 selector，比执行失败后再 Recovery 更高效。
 *
 * 运行环境：SidePanel
 */

var SelectorValidator = {

  /**
   * validate(selector, tabId)
   *
   * 验证 selector 在目标页面上是否可用。
   *
   * 返回 Promise<{ valid, reason, suggestion }>
   *   valid: true/false
   *   reason: 不可用的原因
   *   suggestion: { selector, text } 建议的替代定位方式
   */
  validate: async function(selector, tabId) {
    if (!selector) {
      return { valid: false, reason: "selector 为空", suggestion: null };
    }
    if (!tabId) {
      return { valid: false, reason: "缺少 tabId", suggestion: null };
    }

    try {
      var response = await chrome.tabs.sendMessage(tabId, {
        type: "browser_action",
        action: "extract_attribute",
        target: { selector: selector },
        params: { attr: "tagName" }
      });

      if (response && response.success && response.data && response.data.values && response.data.values.length > 0) {
        return { valid: true, reason: null, suggestion: null };
      }

      return await this._findAlternative(selector, tabId);

    } catch (err) {
      return await this._findAlternative(selector, tabId);
    }
  },

  /**
   * validateTarget(target, tabId)
   *
   * 验证完整 target 对象（可含 selector 或 text）。
   */
  validateTarget: async function(target, tabId) {
    if (!target) return { valid: false, reason: "target 为空", suggestion: null };

    if (target.selector) {
      return await this.validate(target.selector, tabId);
    }

    if (target.text) {
      return await this._validateByText(target.text, tabId);
    }

    return { valid: false, reason: "target 缺少 selector 或 text", suggestion: null };
  },

  /**
   * validateAndFix(action, tabId)
   *
   * 验证 action 的 selector，如果不可用则尝试修复。
   * 返回修复后的 action（不修改原对象）。
   *
   * 如果无法修复，返回 null。
   */
  validateAndFix: async function(action, tabId) {
    if (!action || !action.target) return action;

    var result = await this.validateTarget(action.target, tabId);
    if (result.valid) return action;

    if (result.suggestion) {
      var fixed = this._cloneAction(action);
      if (result.suggestion.selector) {
        fixed.target.selector = result.suggestion.selector;
      }
      if (result.suggestion.text) {
        fixed.target.text = result.suggestion.text;
        delete fixed.target.selector;
      }
      return fixed;
    }

    return null;
  },

  /**
   * batchValidate(selectors, tabId)
   *
   * 批量验证多个 selector。
   * 返回 { [selector]: { valid, reason } }
   */
  batchValidate: async function(selectors, tabId) {
    var results = {};
    for (var i = 0; i < selectors.length; i++) {
      results[selectors[i]] = await this.validate(selectors[i], tabId);
    }
    return results;
  },

  // ==========================================
  //   内部方法
  // ==========================================

  /**
   * _findAlternative(selector, tabId)
   *
   * 当原始 selector 不可用时，尝试找到替代定位方式。
   */
  _findAlternative: async function(selector, tabId) {
    var textMatch = this._extractTextFromSelector(selector);
    if (textMatch) {
      var textResult = await this._validateByText(textMatch, tabId);
      if (textResult.valid) {
        return {
          valid: false,
          reason: "selector 不可用，但找到文本匹配",
          suggestion: { text: textMatch }
        };
      }
    }

    var ariaLabel = this._extractAriaLabel(selector);
    if (ariaLabel) {
      try {
        var ariaResult = await chrome.tabs.sendMessage(tabId, {
          type: "browser_action",
          action: "extract_attribute",
          target: { selector: "[aria-label*='" + ariaLabel + "']" },
          params: { attr: "tagName" }
        });
        if (ariaResult && ariaResult.success && ariaResult.data && ariaResult.data.values && ariaResult.data.values.length > 0) {
          return {
            valid: false,
            reason: "selector 不可用，但找到 aria-label 匹配",
            suggestion: { selector: "[aria-label*='" + ariaLabel + "']" }
          };
        }
      } catch (e) {}
    }

    return { valid: false, reason: "selector 不可用且未找到替代", suggestion: null };
  },

  /**
   * _validateByText(text, tabId)
   *
   * 通过文本内容验证元素是否存在。
   */
  _validateByText: async function(text, tabId) {
    try {
      var response = await chrome.tabs.sendMessage(tabId, {
        type: "browser_action",
        action: "selector_recovery",
        target: {},
        params: { method: "text_match", text: text }
      });

      if (response && response.success && response.data && response.data.selector) {
        return {
          valid: true,
          reason: null,
          suggestion: { selector: response.data.selector, text: text }
        };
      }
    } catch (e) {}

    return { valid: false, reason: "文本匹配未找到元素", suggestion: null };
  },

  /**
   * _extractTextFromSelector(selector)
   *
   * 从 selector 中提取可能的文本内容。
   * 如 "button.search-btn" → null
   * 如 "[title='Search']" → "Search"
   * 如 ":contains('搜索')" → "搜索"
   */
  _extractTextFromSelector: function(selector) {
    var titleMatch = selector.match(/\[title=['"]([^'"]+)['"]\]/);
    if (titleMatch) return titleMatch[1];

    var placeholderMatch = selector.match(/\[placeholder=['"]([^'"]+)['"]\]/);
    if (placeholderMatch) return placeholderMatch[1];

    var containsMatch = selector.match(/:contains\(['"]([^'"]+)['"]\)/);
    if (containsMatch) return containsMatch[1];

    return null;
  },

  /**
   * _extractAriaLabel(selector)
   *
   * 从 selector 中提取 aria-label。
   */
  _extractAriaLabel: function(selector) {
    var match = selector.match(/\[aria-label=['"]([^'"]+)['"]\]/);
    return match ? match[1] : null;
  },

  /**
   * _cloneAction(action)
   *
   * 深拷贝 action 对象。
   */
  _cloneAction: function(action) {
    return JSON.parse(JSON.stringify(action));
  }
};
