/**
 * ContentRuntime - Browser Agent 内容端运行时
 *
 * 职责：
 *   1. 集中管理所有 DOM 操作函数
 *   2. 使用 Registry Map（非 switch-case）分发 Tool 执行
 *   3. content.js 只负责消息路由，不变动 DOM
 *
 * 新增 Tool 时只需在 DOMTools 中注册新条目即可。
 * 运行环境：Content Script（可访问页面 DOM）
 */

// ==========================================
//   DOMTools Registry
//   每个 key 是一个 toolName，value 是执行函数
// ==========================================

var DOMTools = {
  highlight_keywords: function(params) {
    var keywords = params.keywords || [];
    if (!keywords || keywords.length === 0) return;

    DOMTools._removeHighlights();

    var regexPattern = keywords.map(function(kw) {
      return DOMTools._escapeRegex(kw);
    }).join("|");
    var regex = new RegExp("(" + regexPattern + ")", "gi");

    var walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    var textNodes = [];
    var node;
    while ((node = walker.nextNode())) {
      if (node.parentElement &&
          !node.parentElement.classList.contains("highlight-keyword") &&
          !DOMTools._isExcludedElement(node.parentElement)) {
        textNodes.push(node);
      }
    }

    for (var i = 0; i < textNodes.length; i++) {
      var textNode = textNodes[i];
      var parent = textNode.parentElement;
      var text = textNode.textContent;
      var matches = text.match(regex);

      if (matches) {
        var fragment = document.createDocumentFragment();
        var lastIndex = 0;

        text.replace(regex, function(match, captured, index) {
          if (index > lastIndex) {
            fragment.appendChild(document.createTextNode(text.substring(lastIndex, index)));
          }

          var span = document.createElement("span");
          span.className = "highlight-keyword";
          span.textContent = match;
          fragment.appendChild(span);

          lastIndex = index + match.length;
          return match;
        });

        if (lastIndex < text.length) {
          fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
        }

        parent.replaceChild(fragment, textNode);
      }
    }

    DOMTools._addHighlightStyle();
  },

  _escapeRegex: function(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  },

  _isExcludedElement: function(element) {
    var excludedTags = ["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "BUTTON", "SELECT"];
    return excludedTags.indexOf(element.tagName) !== -1;
  },

  _removeHighlights: function() {
    var highlights = document.querySelectorAll(".highlight-keyword");
    for (var i = 0; i < highlights.length; i++) {
      var span = highlights[i];
      var parent = span.parentElement;
      span.replaceWith(span.textContent);
      parent.normalize();
    }
  },

  _addHighlightStyle: function() {
    var styleSheet = document.getElementById("highlight-style");
    if (styleSheet) return;

    styleSheet = document.createElement("style");
    styleSheet.id = "highlight-style";
    styleSheet.textContent =
      ".highlight-keyword {" +
      "background-color: #ffff00;" +
      "padding: 1px 2px;" +
      "border-radius: 2px;" +
      "font-weight: bold;" +
      "}";
    document.head.appendChild(styleSheet);
  }
};

// ==========================================
//   BrowserActionHandlers Registry
//   Action Protocol 的 Content Script 端执行器
// ==========================================

var BrowserActionHandlers = {

  click: function(target, params) {
    var selector = target.selector;
    var text = target.text;
    var element = null;

    if (selector) {
      var loc = ElementLocator.findElement(selector);
      if (!loc.found) return { success: false, error: "元素不存在: " + selector };
      if (loc.disabled) return { success: false, error: "元素已禁用: " + selector };

      if (!loc.visible) {
        var elPrelim = document.querySelector(selector);
        if (elPrelim) {
          elPrelim.scrollIntoView({ behavior: "instant", block: "center" });
          var loc2 = ElementLocator.findElement(selector);
          if (!loc2.visible) {
            try { elPrelim.click(); return { success: true, data: { selector: selector, clicked: true } }; } catch (e) {}
            return { success: false, error: "元素不可见: " + selector };
          }
        } else {
          return { success: false, error: "元素不可见: " + selector };
        }
      }

      if (!loc.inViewport) {
        ElementLocator.scrollIntoViewIfNeeded(selector);
      }

      element = document.querySelector(selector);
    } else if (text) {
      element = BrowserActionHandlers._findElementByText(text);
      if (!element) return { success: false, error: "未找到文本匹配的元素: " + text };
    } else {
      return { success: false, error: "缺少 selector 或 text" };
    }

    try {
      element.click();
      return { success: true, data: { selector: selector || "text:" + text, clicked: true } };
    } catch (e) {
      return { success: false, error: "点击失败: " + e.message };
    }
  },

  input: async function(target, params) {
    var selector = target.selector;
    var value = (params.value !== undefined && params.value !== null) ? params.value : (params.text || null);

    if (!selector) return { success: false, error: "缺少 selector" };
    if (value === undefined || value === null) return { success: false, error: "缺少 params.value" };

    var loc = ElementLocator.findElement(selector);
    if (!loc.found) return { success: false, error: "元素不存在: " + selector };
    if (loc.disabled) return { success: false, error: "元素已禁用: " + selector };

    if (!loc.visible) {
      var elementPrelim = document.querySelector(selector);
      if (elementPrelim) {
        elementPrelim.scrollIntoView({ behavior: "instant", block: "center" });
        // 等待渲染帧完成后再检查
        await new Promise(function(r) { setTimeout(r, 200); });
        var loc2 = ElementLocator.findElement(selector);
        if (loc2.visible) {
          return BrowserActionHandlers._doInput(elementPrelim, selector, value);
        }
        // 元素存在但不可见（遮罩/动画等），强制尝试
        try {
          return BrowserActionHandlers._doInput(elementPrelim, selector, value);
        } catch (e) {
          return { success: false, error: "元素不可见: " + selector };
        }
      }
      return { success: false, error: "元素不可见: " + selector };
    }

    try {
      var element = document.querySelector(selector);
      return BrowserActionHandlers._doInput(element, selector, value);
    } catch (e) {
      return { success: false, error: "输入失败: " + e.message };
    }
  },

  _doInput: function(element, selector, value) {
    element.focus();
    element.value = "";
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return { success: true, data: { selector: selector, value: value } };
  },

  scroll: function(target, params) {
    var direction = params.direction || "down";
    var amount = params.amount || 500;

    try {
      var scrollY = direction === "up" ? -amount : amount;
      window.scrollBy({ top: scrollY, behavior: "smooth" });
      return { success: true, data: { direction: direction, amount: amount } };
    } catch (e) {
      return { success: false, error: "滚动失败: " + e.message };
    }
  },

  extract: function(target, params) {
    var selector = target.selector || (params && params.selector) || null;
    if (!selector) return { success: false, error: "缺少 selector" };

    try {
      var elements = document.querySelectorAll(selector);
      if (!elements || elements.length === 0) {
        return { success: false, error: "未找到匹配元素: " + selector };
      }

      var contents = [];
      for (var i = 0; i < elements.length; i++) {
        contents.push({
          text: (elements[i].innerText || "").substring(0, 2000),
          html: (elements[i].innerHTML || "").substring(0, 500),
          tagName: elements[i].tagName
        });
      }

      return {
        success: true,
        data: {
          selector: selector,
          count: contents.length,
          contents: contents
        }
      };
    } catch (e) {
      return { success: false, error: "提取失败: " + e.message };
    }
  },

  wait_element: function(target, params) {
    var selector = target.selector;
    var text = target.text;
    var timeout = params.timeout || 10000;

    if (!selector && !text) return { success: false, error: "缺少 selector 或 text" };

    var findElement = function() {
      if (selector) return document.querySelector(selector);
      if (text) return BrowserActionHandlers._findElementByText(text);
      return null;
    };

    return new Promise(function(resolve) {
      var element = findElement();
      if (element) {
        resolve({ success: true, data: { selector: selector || ("text:" + text), found: true } });
        return;
      }

      var observer = new MutationObserver(function() {
        var el = findElement();
        if (el) {
          observer.disconnect();
          resolve({ success: true, data: { selector: selector || ("text:" + text), found: true } });
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      setTimeout(function() {
        observer.disconnect();
        var el = findElement();
        if (el) {
          resolve({ success: true, data: { selector: selector || ("text:" + text), found: true } });
        } else {
          resolve({ success: false, error: "等待元素超时: " + (selector || ("text:" + text)) });
        }
      }, timeout);
    });
  },

  hover: function(target, params) {
    var selector = target.selector;
    var text = target.text;
    var element = null;

    if (selector) {
      element = document.querySelector(selector);
      if (!element) return { success: false, error: "元素不存在: " + selector };
    } else if (text) {
      element = BrowserActionHandlers._findElementByText(text);
      if (!element) return { success: false, error: "未找到文本匹配的元素: " + text };
    } else {
      return { success: false, error: "缺少 selector 或 text" };
    }

    try {
      element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true }));
      element.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false, cancelable: true }));
      return { success: true, data: { selector: selector || "text:" + text, hovered: true } };
    } catch (e) {
      return { success: false, error: "悬停失败: " + e.message };
    }
  },

  press_key: function(target, params) {
    var key = params.key;
    if (!key) return { success: false, error: "缺少 key" };

    var keyMap = {
      Enter: { key: "Enter", code: "Enter", keyCode: 13 },
      Tab: { key: "Tab", code: "Tab", keyCode: 9 },
      Escape: { key: "Escape", code: "Escape", keyCode: 27 },
      ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
      ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
      ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
      ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
      Backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
      Delete: { key: "Delete", code: "Delete", keyCode: 46 },
      PageDown: { key: "PageDown", code: "PageDown", keyCode: 34 },
      PageUp: { key: "PageUp", code: "PageUp", keyCode: 33 },
      Home: { key: "Home", code: "Home", keyCode: 36 },
      End: { key: "End", code: "End", keyCode: 35 }
    };

    var keyDef = keyMap[key] || { key: key, code: key, keyCode: 0 };

    var element = document.activeElement;
    if (target && target.selector) {
      var el = document.querySelector(target.selector);
      if (el) {
        el.focus();
        element = el;
      }
    }

    // 无 target 时，尝试找当前页面可见的 input/textarea 聚焦
    if (!element || element === document.body) {
      var inputs = document.querySelectorAll("input:not([type='hidden']), textarea, [contenteditable='true']");
      for (var fi = 0; fi < inputs.length; fi++) {
        if (inputs[fi].offsetParent !== null && !inputs[fi].disabled) {
          inputs[fi].focus();
          element = inputs[fi];
          break;
        }
      }
    }

    try {
      var targetEl = element || document.body;
      targetEl.dispatchEvent(new KeyboardEvent("keydown", {
        key: keyDef.key, code: keyDef.code, keyCode: keyDef.keyCode,
        bubbles: true, cancelable: true
      }));
      targetEl.dispatchEvent(new KeyboardEvent("keypress", {
        key: keyDef.key, code: keyDef.code, keyCode: keyDef.keyCode,
        bubbles: true, cancelable: true
      }));
      targetEl.dispatchEvent(new KeyboardEvent("keyup", {
        key: keyDef.key, code: keyDef.code, keyCode: keyDef.keyCode,
        bubbles: true, cancelable: true
      }));
      return { success: true, data: { key: key } };
    } catch (e) {
      return { success: false, error: "按键失败: " + e.message };
    }
  },

  scroll_to_element: function(target, params) {
    var selector = target.selector;
    if (!selector) return { success: false, error: "缺少 selector" };

    var element = document.querySelector(selector);
    if (!element) return { success: false, error: "元素不存在: " + selector };

    try {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      return { success: true, data: { selector: selector, scrolledTo: true } };
    } catch (e) {
      return { success: false, error: "滚动到元素失败: " + e.message };
    }
  },

  scroll_to_bottom: function(target, params) {
    try {
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
      return { success: true, data: { scrolledToBottom: true } };
    } catch (e) {
      return { success: false, error: "滚动到底部失败: " + e.message };
    }
  },

  select_option: function(target, params) {
    var selector = target.selector;
    var value = params.value;
    var label = params.label;

    if (!selector) return { success: false, error: "缺少 selector" };

    var selectEl = document.querySelector(selector);
    if (!selectEl) return { success: false, error: "元素不存在: " + selector };
    if (selectEl.tagName !== "SELECT") return { success: false, error: "元素不是 SELECT: " + selector };

    try {
      var options = selectEl.options;
      var matched = false;
      for (var i = 0; i < options.length; i++) {
        var opt = options[i];
        if ((value && opt.value === value) || (label && opt.text.trim().indexOf(label) !== -1)) {
          selectEl.value = opt.value;
          matched = true;
          break;
        }
      }
      if (!matched) return { success: false, error: "未找到匹配选项: " + (value || label) };

      selectEl.dispatchEvent(new Event("change", { bubbles: true }));
      selectEl.dispatchEvent(new Event("input", { bubbles: true }));
      return { success: true, data: { selector: selector, value: selectEl.value } };
    } catch (e) {
      return { success: false, error: "选择失败: " + e.message };
    }
  },

  extract_attribute: function(target, params) {
    var selector = target.selector;
    var attr = (params && params.attr) || "href";

    if (!selector) return { success: false, error: "缺少 selector" };

    try {
      var elements = document.querySelectorAll(selector);
      if (!elements || elements.length === 0) {
        return { success: false, error: "未找到匹配元素: " + selector };
      }

      var values = [];
      for (var i = 0; i < elements.length; i++) {
        var val = elements[i].getAttribute(attr) || elements[i][attr] || "";
        if (val) {
          values.push(val);
        }
      }

      return {
        success: true,
        data: {
          selector: selector,
          attr: attr,
          count: values.length,
          values: values
        }
      };
    } catch (e) {
      return { success: false, error: "属性提取失败: " + e.message };
    }
  },

  _findElementByText: function(text) {
    var interactiveTags = ["BUTTON", "A", "INPUT", "SELECT", "SUMMARY", "OPTION"];

    for (var i = 0; i < interactiveTags.length; i++) {
      var elements = document.getElementsByTagName(interactiveTags[i]);
      for (var j = 0; j < elements.length; j++) {
        var elText = (elements[j].textContent || "").trim();
        if (elText.indexOf(text) !== -1) {
          return elements[j];
        }
      }
    }

    var allElements = document.body.getElementsByTagName("*");
    for (var k = 0; k < allElements.length; k++) {
      if (allElements[k].childNodes.length <= 3 &&
          (allElements[k].textContent || "").trim() === text) {
        return allElements[k];
      }
    }

    return null;
  },

  selector_recovery: function(target, params) {
    var method = params.method;

    if (method === "text_match") {
      return BrowserActionHandlers._recoverByText(params.text);
    }
    if (method === "aria_label") {
      return BrowserActionHandlers._recoverByAriaLabel(params.ariaLabel);
    }
    if (method === "placeholder") {
      return BrowserActionHandlers._recoverByPlaceholder(params.placeholder);
    }
    if (method === "role") {
      return BrowserActionHandlers._recoverByRole(params.role);
    }
    if (method === "similar_selector") {
      return BrowserActionHandlers._recoverSimilarSelector(params.failedSelector);
    }
    if (method === "nearby_element") {
      return BrowserActionHandlers._recoverNearbyElement(params.failedSelector, params.text);
    }
    if (method === "button_text") {
      return BrowserActionHandlers._recoverByButtonText(params.text);
    }

    return { success: false, error: "未知恢复方法: " + method };
  },

  _recoverByText: function(text) {
    if (!text) return { success: false, error: "缺少 text" };

    var interactiveTags = ["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA", "SUMMARY"];
    for (var i = 0; i < interactiveTags.length; i++) {
      var elements = document.getElementsByTagName(interactiveTags[i]);
      for (var j = 0; j < elements.length; j++) {
        if ((elements[j].textContent || "").trim().indexOf(text) !== -1) {
          var sel = BrowserActionHandlers._buildSelector(elements[j]);
          return { success: true, data: { selector: sel } };
        }
      }
    }

    var allElements = document.body.getElementsByTagName("*");
    for (var k = 0; k < allElements.length; k++) {
      if (allElements[k].childNodes.length <= 3 &&
          (allElements[k].textContent || "").trim().indexOf(text) !== -1) {
        var sel2 = BrowserActionHandlers._buildSelector(allElements[k]);
        return { success: true, data: { selector: sel2 } };
      }
    }

    return { success: false, error: "未找到文本匹配元素: " + text };
  },

  _recoverByAriaLabel: function(ariaLabel) {
    if (!ariaLabel) return { success: false, error: "缺少 ariaLabel" };

    var elements = document.querySelectorAll("[aria-label]");
    for (var i = 0; i < elements.length; i++) {
      if ((elements[i].getAttribute("aria-label") || "").indexOf(ariaLabel) !== -1) {
        var sel = BrowserActionHandlers._buildSelector(elements[i]);
        return { success: true, data: { selector: sel } };
      }
    }

    return { success: false, error: "未找到 aria-label 匹配元素" };
  },

  _recoverByPlaceholder: function(placeholder) {
    if (!placeholder) return { success: false, error: "缺少 placeholder" };

    var elements = document.querySelectorAll("[placeholder]");
    for (var i = 0; i < elements.length; i++) {
      if ((elements[i].getAttribute("placeholder") || "").indexOf(placeholder) !== -1) {
        var sel = BrowserActionHandlers._buildSelector(elements[i]);
        return { success: true, data: { selector: sel } };
      }
    }

    return { success: false, error: "未找到 placeholder 匹配元素" };
  },

  _recoverByRole: function(role) {
    if (!role) return { success: false, error: "缺少 role" };

    var elements = document.querySelectorAll("[role]");
    for (var i = 0; i < elements.length; i++) {
      if ((elements[i].getAttribute("role") || "") === role) {
        var sel = BrowserActionHandlers._buildSelector(elements[i]);
        return { success: true, data: { selector: sel } };
      }
    }

    return { success: false, error: "未找到 role 匹配元素" };
  },

  _recoverSimilarSelector: function(failedSelector) {
    if (!failedSelector) return { success: false, error: "缺少 failedSelector" };

    var parts = failedSelector.split(/[\s>+~]/).filter(function(p) { return p.length > 0; });
    var tagPart = parts[parts.length - 1];

    var classMatch = tagPart.match(/^\.([\w-]+)/);
    if (classMatch) {
      var className = classMatch[1];
      var elements = document.getElementsByClassName(className);
      for (var ci = 0; ci < elements.length; ci++) {
        var el = elements[ci];
        if (el.offsetParent !== null && !BrowserActionHandlers._isInNavOrHeader(el)) {
          var sel = BrowserActionHandlers._buildSelector(el);
          return { success: true, data: { selector: sel } };
        }
      }
      if (elements.length > 0) {
        return { success: true, data: { selector: BrowserActionHandlers._buildSelector(elements[0]) } };
      }
    }

    var idMatch = tagPart.match(/^#([\w-]+)/);
    if (idMatch) {
      var byId = document.getElementById(idMatch[1]);
      if (byId) {
        var sel2 = BrowserActionHandlers._buildSelector(byId);
        return { success: true, data: { selector: sel2 } };
      }
    }

    var tagMatch = tagPart.match(/^(\w+)/);
    if (tagMatch) {
      var tagName = tagMatch[1];
      var parentPart = parts.length > 1 ? parts[parts.length - 2] : "";

      if (parentPart) {
        var parentTagMatch = parentPart.match(/^([\w-]+)/);
        if (parentTagMatch) {
          var parentElements = document.getElementsByTagName(parentTagMatch[1]);
          for (var pi = 0; pi < parentElements.length; pi++) {
            var child = parentElements[pi].querySelector(tagName);
            if (child && child.offsetParent !== null) {
              var sel3 = BrowserActionHandlers._buildSelector(child);
              return { success: true, data: { selector: sel3 } };
            }
          }
        }
      }

      var byTag = document.getElementsByTagName(tagName);
      for (var ti = 0; ti < byTag.length; ti++) {
        var tagEl = byTag[ti];
        if (tagEl.offsetParent !== null && !BrowserActionHandlers._isInNavOrHeader(tagEl)) {
          var sel4 = BrowserActionHandlers._buildSelector(tagEl);
          return { success: true, data: { selector: sel4 } };
        }
      }
      if (byTag.length > 0) {
        return { success: true, data: { selector: BrowserActionHandlers._buildSelector(byTag[0]) } };
      }
    }

    return { success: false, error: "无法找到相似 selector" };
  },

  _isInNavOrHeader: function(element) {
    var current = element;
    while (current && current !== document.body) {
      var tag = current.tagName.toLowerCase();
      if (tag === "header" || tag === "nav" || tag === "footer") return true;
      if (current.id === "logo" || current.id === "header" || current.id === "navbar") return true;
      current = current.parentElement;
    }
    return false;
  },

  _recoverNearbyElement: function(failedSelector, text) {
    if (text) {
      var byText = BrowserActionHandlers._recoverByText(text);
      if (byText.success) return byText;
    }

    if (failedSelector) {
      var parentParts = failedSelector.split(/[\s>+~]/);
      if (parentParts.length > 1) {
        var parentSel = parentParts.slice(0, -1).join(" ");
        try {
          var parent = document.querySelector(parentSel);
          if (parent) {
            var children = parent.querySelectorAll("*");
            for (var i = 0; i < children.length; i++) {
              if (children[i].offsetParent !== null) {
                var sel = BrowserActionHandlers._buildSelector(children[i]);
                return { success: true, data: { selector: sel } };
              }
            }
          }
        } catch (e) {
          // ignore
        }
      }
    }

    return { success: false, error: "无法找到邻近元素" };
  },

  _recoverByButtonText: function(text) {
    if (!text) return { success: false, error: "缺少 text" };

    var buttons = document.getElementsByTagName("BUTTON");
    for (var i = 0; i < buttons.length; i++) {
      if ((buttons[i].textContent || "").trim().indexOf(text) !== -1) {
        var sel = BrowserActionHandlers._buildSelector(buttons[i]);
        return { success: true, data: { selector: sel } };
      }
    }

    var links = document.getElementsByTagName("A");
    for (var j = 0; j < links.length; j++) {
      if ((links[j].textContent || "").trim().indexOf(text) !== -1) {
        var sel2 = BrowserActionHandlers._buildSelector(links[j]);
        return { success: true, data: { selector: sel2 } };
      }
    }

    return { success: false, error: "未找到按钮文本匹配: " + text };
  },

  _buildSelector: function(element) {
    if (element.id) return "#" + element.id;

    var path = [];
    var current = element;
    while (current && current !== document.body) {
      var selector = current.tagName.toLowerCase();
      if (current.id) {
        selector = "#" + current.id;
        path.unshift(selector);
        break;
      }
      if (current.className && typeof current.className === "string") {
        var classes = current.className.trim().split(/\s+/).slice(0, 2);
        if (classes.length > 0 && classes[0]) {
          selector += "." + classes.join(".");
        }
      }
      path.unshift(selector);
      current = current.parentElement;
    }

    return path.join(" > ");
  }
};

// ==========================================
//   ContentRuntime - 统一执行入口
// ==========================================

var ContentRuntime = {
  execute: function(toolName, params) {
    var startedAt = Date.now();
    var tool = DOMTools[toolName];
    if (!tool) {
      console.warn("ContentRuntime: 未知 DOM Tool", toolName);
      return {
        success: false,
        tool: toolName,
        data: null,
        error: "未知 tool: " + toolName,
        durationMs: Date.now() - startedAt
      };
    }

    try {
      tool(params);
      return {
        success: true,
        tool: toolName,
        data: params,
        error: null,
        durationMs: Date.now() - startedAt
      };
    } catch (err) {
      console.error("ContentRuntime: 执行失败", toolName, err);
      return {
        success: false,
        tool: toolName,
        data: null,
        error: err.message,
        durationMs: Date.now() - startedAt
      };
    }
  },

  handleBrowserAction: async function(action, target, params) {
    var startedAt = Date.now();
    var handler = BrowserActionHandlers[action];

    if (!handler) {
      return {
        success: false,
        error: "未知 browser action: " + action,
        data: {},
        observation: {}
      };
    }

    try {
      var result = await handler(target || {}, params || {});
      return {
        success: result.success,
        error: result.error || null,
        data: result.data || {},
        observation: result.observation || {},
        durationMs: Date.now() - startedAt
      };
    } catch (err) {
      return {
        success: false,
        error: "执行异常: " + err.message,
        data: {},
        observation: {},
        durationMs: Date.now() - startedAt
      };
    }
  },

  /**
   * registerHandler(name, fn) — Plugin 注册 Action handler
   * fn 签名: async function(target, params) → { success, error, data, observation }
   */
  registerHandler: function(name, fn) {
    BrowserActionHandlers[name] = fn;
    console.log("[ContentRuntime] 注册 handler:", name);
  },

  /**
   * unregisterHandler(name) — Plugin 注销 Action handler
   */
  unregisterHandler: function(name) {
    delete BrowserActionHandlers[name];
    console.log("[ContentRuntime] 注销 handler:", name);
  },

  getPageState: function() {
    return {
      url: window.location.href,
      title: document.title,
      domLength: document.body ? document.body.innerHTML.length : 0
    };
  }
};
