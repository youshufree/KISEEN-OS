var SelectorRecovery = {

  _cache: {},

  CACHE_TTL_MS: 60000,

  recover: async function(failedSelector, target, context) {
    var text = target.text || null;
    var ariaLabel = target.ariaLabel || null;
    var placeholder = target.placeholder || null;
    var role = target.role || null;

    if (!context || !context.activeTab || !context.activeTab.id) {
      return { recovered: false, selector: null, method: null };
    }

    var methods = [
      { name: "text_match", fn: function() { return SelectorRecovery._findByText(text, context); } },
      { name: "aria_label", fn: function() { return SelectorRecovery._findByAriaLabel(ariaLabel, context); } },
      { name: "placeholder", fn: function() { return SelectorRecovery._findByPlaceholder(placeholder, context); } },
      { name: "role", fn: function() { return SelectorRecovery._findByRole(role, context); } },
      { name: "similar_selector", fn: function() { return SelectorRecovery._findSimilarSelector(failedSelector, context); } },
      { name: "nearby_element", fn: function() { return SelectorRecovery._findNearbyElement(failedSelector, text, context); } },
      { name: "button_text", fn: function() { return SelectorRecovery._findButtonByText(text, context); } }
    ];

    for (var i = 0; i < methods.length; i++) {
      try {
        var newSelector = await methods[i].fn();
        if (newSelector) {
          console.log("[Recovery] selector 恢复成功:", methods[i].name, "→", newSelector);
          this._cache[failedSelector] = {
            newSelector: newSelector,
            method: methods[i].name,
            timestamp: Date.now()
          };
          return {
            recovered: true,
            selector: newSelector,
            method: methods[i].name
          };
        }
      } catch (e) {
        console.warn("[Recovery] selector 恢复方法失败:", methods[i].name, e.message);
      }
    }

    return { recovered: false, selector: null, method: null };
  },

  getCachedSelector: function(originalSelector) {
    var cached = this._cache[originalSelector];
    if (!cached) return null;
    if (Date.now() - cached.timestamp > this.CACHE_TTL_MS) {
      delete this._cache[originalSelector];
      return null;
    }
    return cached.newSelector;
  },

  clearCache: function() {
    this._cache = {};
  },

  _findByText: async function(text, context) {
    if (!text) return null;

    var response = await chrome.tabs.sendMessage(context.activeTab.id, {
      type: "browser_action",
      action: "selector_recovery",
      target: {},
      params: {
        method: "text_match",
        text: text
      }
    });

    if (response && response.success && response.data && response.data.selector) {
      return response.data.selector;
    }
    return null;
  },

  _findByAriaLabel: async function(ariaLabel, context) {
    if (!ariaLabel) return null;

    var response = await chrome.tabs.sendMessage(context.activeTab.id, {
      type: "browser_action",
      action: "selector_recovery",
      target: {},
      params: {
        method: "aria_label",
        ariaLabel: ariaLabel
      }
    });

    if (response && response.success && response.data && response.data.selector) {
      return response.data.selector;
    }
    return null;
  },

  _findByPlaceholder: async function(placeholder, context) {
    if (!placeholder) return null;

    var response = await chrome.tabs.sendMessage(context.activeTab.id, {
      type: "browser_action",
      action: "selector_recovery",
      target: {},
      params: {
        method: "placeholder",
        placeholder: placeholder
      }
    });

    if (response && response.success && response.data && response.data.selector) {
      return response.data.selector;
    }
    return null;
  },

  _findByRole: async function(role, context) {
    if (!role) return null;

    var response = await chrome.tabs.sendMessage(context.activeTab.id, {
      type: "browser_action",
      action: "selector_recovery",
      target: {},
      params: {
        method: "role",
        role: role
      }
    });

    if (response && response.success && response.data && response.data.selector) {
      return response.data.selector;
    }
    return null;
  },

  _findSimilarSelector: async function(failedSelector, context) {
    if (!failedSelector) return null;

    var response = await chrome.tabs.sendMessage(context.activeTab.id, {
      type: "browser_action",
      action: "selector_recovery",
      target: {},
      params: {
        method: "similar_selector",
        failedSelector: failedSelector
      }
    });

    if (response && response.success && response.data && response.data.selector) {
      return response.data.selector;
    }
    return null;
  },

  _findNearbyElement: async function(failedSelector, text, context) {
    if (!failedSelector && !text) return null;

    var response = await chrome.tabs.sendMessage(context.activeTab.id, {
      type: "browser_action",
      action: "selector_recovery",
      target: {},
      params: {
        method: "nearby_element",
        failedSelector: failedSelector,
        text: text
      }
    });

    if (response && response.success && response.data && response.data.selector) {
      return response.data.selector;
    }
    return null;
  },

  _findButtonByText: async function(text, context) {
    if (!text) return null;

    var response = await chrome.tabs.sendMessage(context.activeTab.id, {
      type: "browser_action",
      action: "selector_recovery",
      target: {},
      params: {
        method: "button_text",
        text: text
      }
    });

    if (response && response.success && response.data && response.data.selector) {
      return response.data.selector;
    }
    return null;
  }
};
