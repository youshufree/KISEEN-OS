/**
 * ContentObserver - Browser Agent 结构化观察层
 *
 * 职责：
 *   1. 从网页 DOM 中提取结构化信息（可交互元素、表单、页面元数据）
 *   2. 返回 Observation Snapshot，供 ObservationBuilder 组合
 *   3. 不做序列化/截断（由 observationSerializer.js 负责）
 *
 * 运行环境：Content Script（可访问页面 DOM）
 */

var ContentObserver = {

  INTERACTIVE_TAGS: ["button", "a", "input", "textarea", "select"],
  HEADLINE_TAGS: ["h1", "h2", "h3"],
  HEADLINE_CLASS_PATTERNS: ["headline", "title", "heading", "article-title", "post-title"],

  MAX_INTERACTIVE_ELEMENTS: 60,

  // ==========================================
  //   extractInteractiveElements()
  // ==========================================

  /**
   * extractInteractiveElements()
   *
   * 提取页面中所有可交互元素（button / a / input / textarea / select）。
   *
   * 返回：
   *   [
   *     {
   *       tag: "button",
   *       text: "登录",
   *       id: "login-btn",
   *       className: "btn primary",
   *       selector: "#login-btn",
   *       visible: true,
   *       type: "submit"
   *     },
   *     ...
   *   ]
   */
  extractInteractiveElements: function() {
    var elements = [];
    var seen = {};

    for (var t = 0; t < this.INTERACTIVE_TAGS.length; t++) {
      var tagName = this.INTERACTIVE_TAGS[t];
      var nodes = document.querySelectorAll(tagName);

      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];

        var selector = this._buildSelector(node);
        if (seen[selector]) continue;
        seen[selector] = true;

        var entry = {
          tag: node.tagName.toLowerCase(),
          text: this._getElementText(node),
          id: node.id || "",
          className: this._truncateClassName(node.className),
          selector: selector,
          visible: this._isVisible(node)
        };

        if (node.type) entry.type = node.type;
        if (node.href) entry.href = this._truncateText(node.href, 200);
        if (node.placeholder) entry.placeholder = node.placeholder;
        if (node.name) entry.name = node.name;
        if (node.disabled) entry.disabled = true;

        elements.push(entry);

        if (elements.length >= this.MAX_INTERACTIVE_ELEMENTS) {
          return elements;
        }
      }
    }

    return elements;
  },

  // ==========================================
  //   extractForms()
  // ==========================================

  /**
   * extractForms()
   *
   * 提取页面中所有表单及其内部 input 结构。
   *
   * 返回：
   *   [
   *     {
   *       id: "search-form",
   *       action: "/search",
   *       method: "get",
   *       inputs: [
   *         { tag: "input", type: "text", name: "q", placeholder: "搜索..." }
   *       ]
   *     }
   *   ]
   */
  extractForms: function() {
    var forms = [];
    var formNodes = document.querySelectorAll("form");

    for (var i = 0; i < formNodes.length; i++) {
      var form = formNodes[i];

      var formEntry = {
        id: form.id || "",
        action: form.action || "",
        method: (form.method || "get").toLowerCase(),
        inputs: []
      };

      var inputs = form.querySelectorAll("input, textarea, select");
      for (var j = 0; j < inputs.length; j++) {
        var input = inputs[j];
        var inputEntry = {
          tag: input.tagName.toLowerCase(),
          type: input.type || "text",
          name: input.name || "",
          placeholder: input.placeholder || ""
        };
        if (input.required) inputEntry.required = true;
        formEntry.inputs.push(inputEntry);
      }

      forms.push(formEntry);
    }

    return forms;
  },

  // ==========================================
  //   extractPageMeta()
  // ==========================================

  /**
   * extractPageMeta()
   *
   * 提取页面元数据：title / url / description / language。
   *
   * 返回：
   *   {
   *     title: "...",
   *     url: "...",
   *     description: "...",
   *     language: "zh-CN"
   *   }
   */
  extractPageMeta: function() {
    var description = "";
    var metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) {
      description = metaDesc.getAttribute("content") || "";
    }

    var language = document.documentElement.lang || "";

    return {
      title: document.title || "",
      url: window.location.href || "",
      description: description,
      language: language
    };
  },

  // ==========================================
  //   buildObservation()
  // ==========================================

  /**
   * buildObservation()
   *
   * 返回完整的 Observation Snapshot。
   * 这是 ContentObserver 的主入口。
   *
   * 返回：
   *   {
   *     title: "...",
   *     url: "...",
   *     textContent: "...",
   *     interactiveElements: [...],
   *     forms: [...],
   *     buttons: [...],
   *     links: [...],
   *     inputs: [...],
   *     images: [...],
   *     pageMeta: {...}
   *   }
   */
  buildObservation: function() {
    var interactiveElements = this.extractInteractiveElements();
    var forms = this.extractForms();
    var pageMeta = this.extractPageMeta();

    var textContent = ContentProcessor.extract("content");

    var buttons = [];
    var links = [];
    var inputs = [];

    for (var i = 0; i < interactiveElements.length; i++) {
      var el = interactiveElements[i];
      if (el.tag === "button") buttons.push(el);
      else if (el.tag === "a") links.push(el);
      else if (el.tag === "input" || el.tag === "textarea" || el.tag === "select") inputs.push(el);
    }

    var images = [];
    var imgNodes = document.querySelectorAll("img");
    for (var j = 0; j < imgNodes.length && j < 20; j++) {
      var img = imgNodes[j];
      images.push({
        src: this._truncateText(img.src || img.getAttribute("data-src") || "", 200),
        alt: (img.alt || "").substring(0, 100)
      });
    }

    // 提取标题元素（h1-h3），追加到 interactiveElements 末尾
    var headlineElements = this.extractHeadlines();
    for (var hi = 0; hi < headlineElements.length; hi++) {
      if (interactiveElements.length < this.MAX_INTERACTIVE_ELEMENTS) {
        interactiveElements.push(headlineElements[hi]);
      }
    }

    var layout = this.detectLayout(buttons, links, inputs);

    return {
      title: pageMeta.title,
      url: pageMeta.url,
      textContent: textContent,
      interactiveElements: interactiveElements,
      forms: forms,
      buttons: buttons,
      links: links,
      inputs: inputs,
      images: images,
      pageMeta: pageMeta,
      pageType: this._detectPageType(interactiveElements, forms, buttons, links, inputs, textContent),
      layout: layout
    };
  },

  _detectPageType: function(interactiveElements, forms, buttons, links, inputs, textContent) {
    var visibleInteractive = [];
    for (var i = 0; i < interactiveElements.length; i++) {
      if (interactiveElements[i].visible) visibleInteractive.push(interactiveElements[i]);
    }

    if (forms.length > 0 && inputs.length > 3) return "form";
    if (links.length > 15 && visibleInteractive.length < 10) return "list";

    var articleEl = document.querySelector("article");
    if (articleEl && visibleInteractive.length < 5) return "article";

    var chatSelectors = ['[role="log"]', '.chat-messages', '.message-list', '#chat'];
    for (var c = 0; c < chatSelectors.length; c++) {
      try {
        if (document.querySelector(chatSelectors[c])) return "chat";
      } catch (e) {}
    }

    if (visibleInteractive.length > 10 && forms.length === 0) return "dashboard";
    return "other";
  },

  // ==========================================
  //   extractHeadlines()
  // ==========================================

  /**
   * extractHeadlines()
   *
   * 提取页面中的标题元素（h1-h3），优先选择可见且有内容的。
   * 这些元素不一定是"可交互"的（不能点击/输入），但对 extract 操作非常重要。
   *
   * 返回格式与 extractInteractiveElements 一致。
   */
  extractHeadlines: function() {
    var headlines = [];
    var seen = {};

    // 优先按 class 模式匹配（新闻站点常用类名）
    for (var p = 0; p < this.HEADLINE_CLASS_PATTERNS.length; p++) {
      var pattern = this.HEADLINE_CLASS_PATTERNS[p];
      try {
        var matched = document.querySelectorAll("[class*='" + pattern + "']");
        for (var m = 0; m < matched.length && headlines.length < 10; m++) {
          var el = matched[m];
          var tag = el.tagName.toLowerCase();
          if (this.HEADLINE_TAGS.indexOf(tag) === -1) continue;
          var sel = this._buildSelector(el);
          if (seen[sel]) continue;
          seen[sel] = true;
          var text = (el.innerText || el.textContent || "").trim().substring(0, 150);
          if (!text) continue;
          headlines.push({
            tag: tag,
            text: text,
            id: el.id || "",
            className: this._truncateClassName(el.className),
            selector: sel,
            visible: this._isVisible(el)
          });
        }
      } catch (e) {}
    }

    // 补充：按 h1/h2/h3 标签遍历
    for (var t = 0; t < this.HEADLINE_TAGS.length; t++) {
      var tagName = this.HEADLINE_TAGS[t];
      var nodes = document.querySelectorAll(tagName);
      for (var i = 0; i < nodes.length && headlines.length < 10; i++) {
        var node = nodes[i];
        var sel = this._buildSelector(node);
        if (seen[sel]) continue;
        seen[sel] = true;
        var text = (node.innerText || node.textContent || "").trim().substring(0, 150);
        if (!text) continue;
        headlines.push({
          tag: tagName,
          text: text,
          id: node.id || "",
          className: this._truncateClassName(node.className),
          selector: sel,
          visible: this._isVisible(node)
        });
      }
    }

    return headlines;
  },

  // ==========================================
  //   detectLayout(buttons, links, inputs)
  // ==========================================

  detectLayout: function(buttons, links, inputs) {
    var result = {
      hasHeader: false,
      hasNav: false,
      hasMainContent: false,
      hasSidebar: false,
      hasFooter: false,
      hasSearchInput: false,
      dominantTag: null,
      mainColumnCount: 1
    };

    var headerTags = document.querySelectorAll("header, [role='banner'], .header, .navbar");
    result.hasHeader = headerTags.length > 0;

    var navTags = document.querySelectorAll("nav, [role='navigation'], .nav");
    result.hasNav = navTags.length > 0;

    var sidebarTags = document.querySelectorAll("aside, [role='complementary'], .sidebar, .side");
    result.hasSidebar = sidebarTags.length > 0;

    var footerTags = document.querySelectorAll("footer, [role='contentinfo'], .footer");
    result.hasFooter = footerTags.length > 0;

    var mainTags = document.querySelectorAll("main, [role='main'], article, .content, .main");
    result.hasMainContent = mainTags.length > 0 || document.body.innerText.length > 100;

    for (var i = 0; i < inputs.length; i++) {
      var inp = inputs[i];
      if (inp.tag === "input" && (inp.type === "text" || inp.type === "search" || !inp.type)) {
        result.hasSearchInput = true;
        break;
      } else if (inp.tag === "textarea" && !inp.type) {
        result.hasSearchInput = true;
        break;
      }
    }

    var tagCounts = {};
    for (var b = 0; b < buttons.length; b++) { tagCounts.button = (tagCounts.button || 0) + 1; }
    for (var l = 0; l < links.length; l++) { tagCounts.a = (tagCounts.a || 0) + 1; }
    for (var inp2 = 0; inp2 < inputs.length; inp2++) { tagCounts.input = (tagCounts.input || 0) + 1; }

    var maxCount = 0;
    for (var tag in tagCounts) {
      if (tagCounts[tag] > maxCount) {
        maxCount = tagCounts[tag];
        result.dominantTag = tag;
      }
    }

    var columns = document.querySelectorAll("[class*='col'], [class*='grid']");
    if (columns.length > 2) result.mainColumnCount = 2;

    return result;
  },

  // ==========================================
  //   内部工具方法
  // ==========================================

  _buildSelector: function(node) {
    if (node.id) return "#" + CSS.escape(node.id);

    var parts = [];
    var current = node;
    var depth = 0;

    while (current && current !== document.body && depth < 4) {
      var part = current.tagName.toLowerCase();
      if (current.id) {
        part += "#" + CSS.escape(current.id);
        parts.unshift(part);
        break;
      }

      var parent = current.parentElement;
      if (parent) {
        var siblings = parent.querySelectorAll(":scope > " + current.tagName.toLowerCase());
        if (siblings.length > 1) {
          var index = Array.prototype.indexOf.call(siblings, current);
          part += ":nth-of-type(" + (index + 1) + ")";
        }
      }

      parts.unshift(part);
      current = parent;
      depth++;
    }

    return parts.join(" > ");
  },

  _getElementText: function(node) {
    if (node.tagName.toLowerCase() === "input" || node.tagName.toLowerCase() === "textarea") {
      return node.value || node.placeholder || "";
    }
    return this._truncateText((node.innerText || node.textContent || "").trim(), 80);
  },

  _truncateText: function(text, maxLen) {
    if (!text) return "";
    text = text.replace(/\s+/g, " ").trim();
    if (text.length > maxLen) {
      return text.substring(0, maxLen) + "...";
    }
    return text;
  },

  _truncateClassName: function(className) {
    if (!className) return "";
    if (typeof className !== "string") return "";
    var truncated = className.trim().substring(0, 80);
    return truncated;
  },

  _isVisible: function(node) {
    if (!node) return false;

    var rect = node.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;

    var style = window.getComputedStyle(node);
    if (style.display === "none") return false;
    if (style.visibility === "hidden") return false;
    if (style.opacity === "0") return false;

    return true;
  }
};
