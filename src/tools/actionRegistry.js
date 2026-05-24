/**
 * ActionRegistry - Browser Action 注册中心
 *
 * 职责：
 *   1. 注册所有 Browser Actions（click_element / input_text / scroll_page / navigate_url）
 *   2. 每个 Action 包含 capability / description / parameters / safety 配置
 *   3. 提供 getDefinitions() 供 Planner 读取可用操作
 *   4. 提供 getCapabilities() 按能力分类
 *
 * 运行环境：SidePanel / Popup
 */

var ActionRegistry = {

  _actions: {
    click_element: {
      name: "click_element",
      capability: "browser_action",
      description: "点击页面上的元素（按钮、链接等）",
      parameters: {
        selector: { type: "string", required: true, description: "CSS 选择器" }
      },
      safety: {
        cooldownMs: 500,
        dangerous: false
      }
    },

    input_text: {
      name: "input_text",
      capability: "browser_action",
      description: "在输入框中输入文本",
      parameters: {
        selector: { type: "string", required: true, description: "CSS 选择器" },
        text: { type: "string", required: true, description: "要输入的文本" }
      },
      safety: {
        cooldownMs: 300,
        dangerous: false
      }
    },

    scroll_page: {
      name: "scroll_page",
      capability: "browser_action",
      description: "滚动页面",
      parameters: {
        direction: { type: "string", required: true, description: "滚动方向：up / down" },
        amount: { type: "number", required: false, description: "滚动像素数，默认 500" }
      },
      safety: {
        cooldownMs: 300,
        dangerous: false
      }
    },

    navigate_url: {
      name: "navigate_url",
      capability: "browser_action",
      description: "导航到指定 URL",
      parameters: {
        url: { type: "string", required: true, description: "目标 URL" }
      },
      safety: {
        cooldownMs: 500,
        dangerous: true
      }
    },

    open_tab: {
      name: "open_tab",
      capability: "tab_management",
      description: "打开一个新标签页并将 Agent 目标切换到该 Tab",
      parameters: {
        url: { type: "string", required: true, description: "要打开的 URL（仅限 http/https）" }
      },
      safety: {
        cooldownMs: 1000,
        dangerous: true
      }
    },

    switch_tab: {
      name: "switch_tab",
      capability: "tab_management",
      description: "将 Agent 操作目标切换到已有的标签页",
      parameters: {
        tabId: { type: "number", required: true, description: "目标 Tab 的 ID" }
      },
      safety: {
        cooldownMs: 300,
        dangerous: false
      }
    },

    close_tab: {
      name: "close_tab",
      capability: "tab_management",
      description: "关闭指定标签页（不允许关闭最后一个 Tab）",
      parameters: {
        tabId: { type: "number", required: false, description: "要关闭的 Tab ID，不传则关闭当前 Agent 目标 Tab" }
      },
      safety: {
        cooldownMs: 500,
        dangerous: true
      }
    },

    click: {
      name: "click",
      capability: "browser_action",
      description: "点击页面元素",
      parameters: {
        selector: { type: "string", required: false, description: "CSS 选择器" },
        text: { type: "string", required: false, description: "元素文本" }
      },
      safety: {
        cooldownMs: 300,
        dangerous: false
      }
    },

    input: {
      name: "input",
      capability: "browser_action",
      description: "在输入框中输入文本",
      parameters: {
        selector: { type: "string", required: true, description: "CSS 选择器" },
        value: { type: "string", required: true, description: "要输入的文本" }
      },
      safety: {
        cooldownMs: 300,
        dangerous: false
      }
    },

    scroll: {
      name: "scroll",
      capability: "browser_action",
      description: "滚动页面",
      parameters: {
        direction: { type: "string", required: false, description: "滚动方向" },
        amount: { type: "number", required: false, description: "滚动像素数" }
      },
      safety: {
        cooldownMs: 200,
        dangerous: false
      }
    },

    extract: {
      name: "extract",
      capability: "browser_action",
      description: "提取页面内容",
      parameters: {
        selector: { type: "string", required: true, description: "CSS 选择器" }
      },
      safety: {
        cooldownMs: 200,
        dangerous: false
      }
    },

    wait_element: {
      name: "wait_element",
      capability: "browser_action",
      description: "等待元素出现",
      parameters: {
        selector: { type: "string", required: true, description: "CSS 选择器" },
        timeout: { type: "number", required: false, description: "超时毫秒数" }
      },
      safety: {
        cooldownMs: 100,
        dangerous: false
      }
    },

    hover: {
      name: "hover",
      capability: "browser_action",
      description: "悬停在元素上，触发 hover 菜单或提示",
      parameters: {
        selector: { type: "string", required: false, description: "CSS 选择器" },
        text: { type: "string", required: false, description: "元素文本" }
      },
      safety: {
        cooldownMs: 200,
        dangerous: false
      }
    },

    press_key: {
      name: "press_key",
      capability: "browser_action",
      description: "按下键盘按键（Enter/Tab/Escape/ArrowDown/ArrowUp 等）",
      parameters: {
        key: { type: "string", required: true, description: "按键名称：Enter, Tab, Escape, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Backspace, Delete, PageDown, PageUp, Home, End" },
        selector: { type: "string", required: false, description: "先聚焦到此元素再按键" }
      },
      safety: {
        cooldownMs: 200,
        dangerous: false
      }
    },

    scroll_to_element: {
      name: "scroll_to_element",
      capability: "browser_action",
      description: "滚动页面直到指定元素出现在视野中",
      parameters: {
        selector: { type: "string", required: true, description: "CSS 选择器" }
      },
      safety: {
        cooldownMs: 200,
        dangerous: false
      }
    },

    scroll_to_bottom: {
      name: "scroll_to_bottom",
      capability: "browser_action",
      description: "滚动到页面底部，常用于加载更多内容",
      parameters: {},
      safety: {
        cooldownMs: 500,
        dangerous: false
      }
    },

    select_option: {
      name: "select_option",
      capability: "browser_action",
      description: "选择下拉框（SELECT）中的选项",
      parameters: {
        selector: { type: "string", required: true, description: "SELECT 元素的 CSS 选择器" },
        value: { type: "string", required: false, description: "选项的 value 值" },
        label: { type: "string", required: false, description: "选项的显示文本" }
      },
      safety: {
        cooldownMs: 300,
        dangerous: false
      }
    },

    extract_attribute: {
      name: "extract_attribute",
      capability: "browser_action",
      description: "提取元素的指定属性值（如 href、src、data-*）",
      parameters: {
        selector: { type: "string", required: true, description: "CSS 选择器" },
        attr: { type: "string", required: false, description: "属性名，默认 href" }
      },
      safety: {
        cooldownMs: 200,
        dangerous: false
      }
    }
  },

  get: function(actionName) {
    return this._actions[actionName] || null;
  },

  register: function(actionName, definition) {
    this._actions[actionName] = definition;
    console.log("[ActionRegistry] 注册:", actionName);
  },

  unregister: function(actionName) {
    delete this._actions[actionName];
    console.log("[ActionRegistry] 注销:", actionName);
  },

  has: function(actionName) {
    return actionName in this._actions;
  },

  getDefinitions: function() {
    var results = [];
    for (var name in this._actions) {
      if (this._actions.hasOwnProperty(name)) {
        var action = this._actions[name];
        results.push({
          name: action.name,
          capability: action.capability,
          description: action.description,
          parameters: action.parameters
        });
      }
    }
    return results;
  },

  getCapabilities: function() {
    var caps = {};
    for (var name in this._actions) {
      if (this._actions.hasOwnProperty(name)) {
        var action = this._actions[name];
        var cap = action.capability;
        if (!caps[cap]) caps[cap] = [];
        caps[cap].push(name);
      }
    }
    return caps;
  },

  getSafetyConfig: function(actionName) {
    var action = this._actions[actionName];
    if (!action) return null;
    return action.safety || {};
  },

  getAllNames: function() {
    var names = [];
    for (var name in this._actions) {
      if (this._actions.hasOwnProperty(name)) {
        names.push(name);
      }
    }
    return names;
  }
};
