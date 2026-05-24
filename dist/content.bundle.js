(() => {
  var ContentProcessor = {
    MAX_LENGTH: 3e3,
    MIN_LENGTH: 20,
    POLLUTED_TAGS: [
      "script",
      "style",
      "noscript",
      "nav",
      "footer",
      "aside",
      "img",
      "svg",
      "canvas",
      "iframe",
      "video",
      "audio",
      "object",
      "embed",
      "input",
      "button",
      "select",
      "textarea",
      "form",
      "fieldset"
    ],
    /**
     * extract(mode)
     *
     * 根据感知模式调度不同的提取策略。
     *
     * mode 取值：
     *   "content"  — 文章正文提取（默认）
     *   "full"     — 全局页面提取
     *   "visual"   — 图片/视觉元素提取
     *
     * 返回：string
     */
    extract: function(mode) {
      mode = mode || "content";
      console.log("ContentProcessor: \u5F53\u524D\u6A21\u5F0F =", mode);
      switch (mode) {
        case "full":
          return this._extractFull();
        case "visual":
          return this._extractVisual();
        case "content":
        default:
          return this._extractContent();
      }
    },
    /**
     * extractMainContent()
     *
     * 向后兼容的别名，默认 content 模式。
     * 旧代码调用此方法仍然有效。
     */
    extractMainContent: function() {
      return this._extractContent();
    },
    // ==========================================
    //   content 模式：文章正文提取
    // ==========================================
    /**
     * _extractContent()
     *
     * 用于文章总结。
     *
     * 提取范围：
     *   article > main > [role="main"] > body
     *
     * 过滤：
     *   所有 POLLUTED_TAGS（nav/footer/aside/img/svg 等）
     *
     * 返回：纯文本正文（≤ MAX_LENGTH）
     */
    _extractContent: function() {
      var root = document.querySelector("article") || document.querySelector("main") || document.querySelector('[role="main"]') || document.body;
      var clone = root.cloneNode(true);
      this._removePollutedElements(clone);
      var text = clone.innerText || "";
      text = this.preprocess(text);
      return text;
    },
    // ==========================================
    //   full 模式：全局页面提取
    // ==========================================
    /**
     * _extractFull()
     *
     * 用于网页整体结构分析。
     *
     * 提取范围：
     *   document.body 全部文本
     *
     * 过滤：
     *   仅删除 script / style / noscript
     *   保留导航、页脚等（用于结构分析）
     *
     * 返回：纯文本（≤ MAX_LENGTH）
     */
    _extractFull: function() {
      var clone = document.body.cloneNode(true);
      var minimalPollutants = ["script", "style", "noscript"];
      for (var i = 0; i < minimalPollutants.length; i++) {
        var elements = clone.querySelectorAll(minimalPollutants[i]);
        for (var j = 0; j < elements.length; j++) {
          elements[j].remove();
        }
      }
      var text = clone.innerText || "";
      var savedMax = this.MAX_LENGTH;
      this.MAX_LENGTH = 5e3;
      text = this.preprocess(text);
      this.MAX_LENGTH = savedMax;
      return text;
    },
    // ==========================================
    //   visual 模式：图片/视觉元素提取
    // ==========================================
    /**
     * _extractVisual()
     *
     * 用于图片/商品/UI 分析。
     *
     * 提取范围：
     *   img 标签（src + alt + title）
     *   figure + figcaption 组合
     *   包含 background-image 的关键容器
     *
     * 不真正上传图片，只提取 URL 和描述信息。
     *
     * 返回：JSON 字符串（图片信息数组）
     */
    _extractVisual: function() {
      var images = [];
      var seen = {};
      var imgs = document.querySelectorAll("img");
      for (var i = 0; i < imgs.length; i++) {
        var img = imgs[i];
        var src = img.src || img.getAttribute("data-src") || "";
        if (!src || seen[src])
          continue;
        var entry = {
          src: src.substring(0, 200),
          alt: (img.alt || "").substring(0, 200),
          title: (img.title || "").substring(0, 200)
        };
        var figure = img.closest("figure");
        if (figure) {
          var figcaption = figure.querySelector("figcaption");
          if (figcaption) {
            entry.caption = (figcaption.innerText || "").substring(0, 200);
          }
        }
        if (entry.alt || entry.title || entry.caption) {
          images.push(entry);
          seen[src] = true;
        }
      }
      var figures = document.querySelectorAll("figure");
      for (var k = 0; k < figures.length; k++) {
        var fig = figures[k];
        var figcaption = fig.querySelector("figcaption");
        var figImgs = fig.querySelectorAll("img");
        if (!figcaption || figImgs.length > 0)
          continue;
        var captionText = (figcaption.innerText || "").substring(0, 200);
        if (captionText && !seen[captionText]) {
          images.push({
            src: "",
            alt: captionText,
            caption: captionText
          });
          seen[captionText] = true;
        }
      }
      if (images.length === 0) {
        images.push({
          src: "",
          alt: "\u6B64\u9875\u9762\u65E0\u53EF\u63D0\u53D6\u7684\u56FE\u7247\u4FE1\u606F",
          caption: ""
        });
      }
      if (images.length > 20) {
        images = images.slice(0, 20);
      }
      return JSON.stringify(images, null, 2);
    },
    // ==========================================
    //   共享工具方法
    // ==========================================
    /**
     * _removePollutedElements(container)
     *
     * 在克隆 DOM 树上删除所有污染元素。
     */
    _removePollutedElements: function(container) {
      for (var i = 0; i < this.POLLUTED_TAGS.length; i++) {
        var elements = container.querySelectorAll(this.POLLUTED_TAGS[i]);
        for (var j = 0; j < elements.length; j++) {
          elements[j].remove();
        }
      }
    },
    /**
     * preprocess(text)
     *
     * 通用文本清洗：
     *   1. 合并连续空白→单个空格
     *   2. 合并连续换行→最多两个换行
     *   3. trim 首尾空白
     *   4. 截断到 MAX_LENGTH
     */
    preprocess: function(text) {
      if (!text || typeof text !== "string") {
        return "";
      }
      var cleaned = text;
      cleaned = cleaned.replace(/[ \t]+/g, " ");
      cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
      cleaned = cleaned.trim();
      if (cleaned.length > this.MAX_LENGTH) {
        cleaned = cleaned.slice(0, this.MAX_LENGTH);
      }
      if (cleaned.length < this.MIN_LENGTH) {
        console.warn(
          "ContentProcessor: \u9875\u9762\u6B63\u6587\u8FC7\u5C11 (",
          cleaned.length,
          "chars)\uFF0C\u53EF\u80FD\u63D0\u53D6\u5931\u8D25"
        );
      }
      return cleaned;
    }
  };
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
          if (seen[selector])
            continue;
          seen[selector] = true;
          var entry = {
            tag: node.tagName.toLowerCase(),
            text: this._getElementText(node),
            id: node.id || "",
            className: this._truncateClassName(node.className),
            selector,
            visible: this._isVisible(node)
          };
          if (node.type)
            entry.type = node.type;
          if (node.href)
            entry.href = this._truncateText(node.href, 200);
          if (node.placeholder)
            entry.placeholder = node.placeholder;
          if (node.name)
            entry.name = node.name;
          if (node.disabled)
            entry.disabled = true;
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
          if (input.required)
            inputEntry.required = true;
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
        description,
        language
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
        if (el.tag === "button")
          buttons.push(el);
        else if (el.tag === "a")
          links.push(el);
        else if (el.tag === "input" || el.tag === "textarea" || el.tag === "select")
          inputs.push(el);
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
        textContent,
        interactiveElements,
        forms,
        buttons,
        links,
        inputs,
        images,
        pageMeta,
        pageType: this._detectPageType(interactiveElements, forms, buttons, links, inputs, textContent),
        layout
      };
    },
    _detectPageType: function(interactiveElements, forms, buttons, links, inputs, textContent) {
      var visibleInteractive = [];
      for (var i = 0; i < interactiveElements.length; i++) {
        if (interactiveElements[i].visible)
          visibleInteractive.push(interactiveElements[i]);
      }
      if (forms.length > 0 && inputs.length > 3)
        return "form";
      if (links.length > 15 && visibleInteractive.length < 10)
        return "list";
      var articleEl = document.querySelector("article");
      if (articleEl && visibleInteractive.length < 5)
        return "article";
      var chatSelectors = ['[role="log"]', ".chat-messages", ".message-list", "#chat"];
      for (var c = 0; c < chatSelectors.length; c++) {
        try {
          if (document.querySelector(chatSelectors[c]))
            return "chat";
        } catch (e) {
        }
      }
      if (visibleInteractive.length > 10 && forms.length === 0)
        return "dashboard";
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
      for (var p = 0; p < this.HEADLINE_CLASS_PATTERNS.length; p++) {
        var pattern = this.HEADLINE_CLASS_PATTERNS[p];
        try {
          var matched = document.querySelectorAll("[class*='" + pattern + "']");
          for (var m = 0; m < matched.length && headlines.length < 10; m++) {
            var el = matched[m];
            var tag = el.tagName.toLowerCase();
            if (this.HEADLINE_TAGS.indexOf(tag) === -1)
              continue;
            var sel = this._buildSelector(el);
            if (seen[sel])
              continue;
            seen[sel] = true;
            var text = (el.innerText || el.textContent || "").trim().substring(0, 150);
            if (!text)
              continue;
            headlines.push({
              tag,
              text,
              id: el.id || "",
              className: this._truncateClassName(el.className),
              selector: sel,
              visible: this._isVisible(el)
            });
          }
        } catch (e) {
        }
      }
      for (var t = 0; t < this.HEADLINE_TAGS.length; t++) {
        var tagName = this.HEADLINE_TAGS[t];
        var nodes = document.querySelectorAll(tagName);
        for (var i = 0; i < nodes.length && headlines.length < 10; i++) {
          var node = nodes[i];
          var sel = this._buildSelector(node);
          if (seen[sel])
            continue;
          seen[sel] = true;
          var text = (node.innerText || node.textContent || "").trim().substring(0, 150);
          if (!text)
            continue;
          headlines.push({
            tag: tagName,
            text,
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
      for (var b = 0; b < buttons.length; b++) {
        tagCounts.button = (tagCounts.button || 0) + 1;
      }
      for (var l = 0; l < links.length; l++) {
        tagCounts.a = (tagCounts.a || 0) + 1;
      }
      for (var inp2 = 0; inp2 < inputs.length; inp2++) {
        tagCounts.input = (tagCounts.input || 0) + 1;
      }
      var maxCount = 0;
      for (var tag in tagCounts) {
        if (tagCounts[tag] > maxCount) {
          maxCount = tagCounts[tag];
          result.dominantTag = tag;
        }
      }
      var columns = document.querySelectorAll("[class*='col'], [class*='grid']");
      if (columns.length > 2)
        result.mainColumnCount = 2;
      return result;
    },
    // ==========================================
    //   内部工具方法
    // ==========================================
    _buildSelector: function(node) {
      if (node.id)
        return "#" + CSS.escape(node.id);
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
      if (!text)
        return "";
      text = text.replace(/\s+/g, " ").trim();
      if (text.length > maxLen) {
        return text.substring(0, maxLen) + "...";
      }
      return text;
    },
    _truncateClassName: function(className) {
      if (!className)
        return "";
      if (typeof className !== "string")
        return "";
      var truncated = className.trim().substring(0, 80);
      return truncated;
    },
    _isVisible: function(node) {
      if (!node)
        return false;
      var rect = node.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0)
        return false;
      var style = window.getComputedStyle(node);
      if (style.display === "none")
        return false;
      if (style.visibility === "hidden")
        return false;
      if (style.opacity === "0")
        return false;
      return true;
    }
  };
  var ElementLocator = {
    /**
     * findElement(selector)
     *
     * 安全定位元素，返回完整的状态信息。
     *
     * 返回：
     *   {
     *     found: boolean,
     *     visible: boolean,
     *     clickable: boolean,
     *     inViewport: boolean,
     *     disabled: boolean,
     *     rect: { top, left, width, height } | null,
     *     tagName: string | null,
     *     text: string | null,
     *     error: string | null
     *   }
     */
    findElement: function(selector) {
      if (!selector || typeof selector !== "string") {
        return this._result(false, false, false, false, false, null, null, null, "selector \u4E3A\u7A7A");
      }
      var element;
      try {
        element = document.querySelector(selector);
      } catch (e) {
        return this._result(false, false, false, false, false, null, null, null, "selector \u8BED\u6CD5\u9519\u8BEF: " + e.message);
      }
      if (!element) {
        return this._result(false, false, false, false, false, null, null, null, "\u5143\u7D20\u4E0D\u5B58\u5728: " + selector);
      }
      var visible = this._isVisible(element);
      var inViewport = this._isInViewport(element);
      var disabled = !!element.disabled;
      var clickable = visible && !disabled && inViewport;
      var rect;
      try {
        var r = element.getBoundingClientRect();
        rect = { top: r.top, left: r.left, width: r.width, height: r.height };
      } catch (e) {
        rect = null;
      }
      var tagName = element.tagName ? element.tagName.toLowerCase() : null;
      var text = (element.innerText || element.textContent || "").trim().substring(0, 80);
      return {
        found: true,
        visible,
        clickable,
        inViewport,
        disabled,
        rect,
        tagName,
        text,
        error: null
      };
    },
    /**
     * scrollIntoViewIfNeeded(selector)
     *
     * 如果元素不在 viewport 内，滚动到可见区域。
     * 返回是否执行了滚动。
     */
    scrollIntoViewIfNeeded: function(selector) {
      var loc = this.findElement(selector);
      if (!loc.found)
        return false;
      if (loc.inViewport)
        return false;
      try {
        var element = document.querySelector(selector);
        element.scrollIntoView({ behavior: "smooth", block: "center" });
        return true;
      } catch (e) {
        return false;
      }
    },
    _isVisible: function(element) {
      if (!element)
        return false;
      var rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0)
        return false;
      var style = window.getComputedStyle(element);
      if (style.display === "none")
        return false;
      if (style.visibility === "hidden")
        return false;
      if (parseFloat(style.opacity) === 0)
        return false;
      return true;
    },
    _isInViewport: function(element) {
      if (!element)
        return false;
      var rect = element.getBoundingClientRect();
      var vw = window.innerWidth || document.documentElement.clientWidth;
      var vh = window.innerHeight || document.documentElement.clientHeight;
      return rect.top < vh && rect.bottom > 0 && rect.left < vw && rect.right > 0;
    },
    _result: function(found, visible, clickable, inViewport, disabled, rect, tagName, text, error) {
      return {
        found,
        visible,
        clickable,
        inViewport,
        disabled,
        rect,
        tagName,
        text,
        error
      };
    }
  };
  var FormAutofillPlugin = {
    execute: async function(action, context) {
      var params = action.params || {};
      var actionType = action.type;
      if (actionType === "fill_form") {
        return FormAutofillPlugin._fillForm(params);
      }
      if (actionType === "read_form") {
        return FormAutofillPlugin._readForm(params);
      }
      if (actionType === "submit_form") {
        return FormAutofillPlugin._submitForm(params);
      }
      return { success: false, error: "\u672A\u77E5\u64CD\u4F5C: " + actionType, data: {} };
    },
    _fillForm: function(params) {
      var fields = params.fields;
      if (!fields || typeof fields !== "object") {
        return { success: false, error: "\u7F3A\u5C11 fields \u53C2\u6570", data: {} };
      }
      var filled = [];
      var failed = [];
      var fieldNames = Object.keys(fields);
      for (var i = 0; i < fieldNames.length; i++) {
        var name = fieldNames[i];
        var value = fields[name];
        var el = document.querySelector('[name="' + name + '"]');
        if (!el) {
          el = document.getElementById(name);
        }
        if (!el) {
          el = document.querySelector('[placeholder*="' + name + '"]');
        }
        if (!el) {
          failed.push(name);
          continue;
        }
        var tag = el.tagName.toLowerCase();
        try {
          if (tag === "select") {
            el.value = String(value);
            el.dispatchEvent(new Event("change", { bubbles: true }));
          } else if (tag === "input" || tag === "textarea") {
            el.focus();
            el.value = "";
            el.value = String(value);
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
          }
          filled.push(name);
        } catch (e) {
          failed.push(name);
        }
      }
      return {
        success: failed.length === 0,
        data: { filled, failed, total: fieldNames.length },
        error: failed.length > 0 ? "\u672A\u627E\u5230\u5B57\u6BB5: " + failed.join(", ") : null
      };
    },
    _readForm: function(params) {
      var formSelector = params.formSelector || "form";
      var form;
      try {
        form = document.querySelector(formSelector);
      } catch (e) {
        form = document.querySelector("form");
      }
      if (!form) {
        return { success: false, error: "\u672A\u627E\u5230\u8868\u5355\u5143\u7D20", data: {} };
      }
      var inputs = form.querySelectorAll("input, textarea, select");
      var values = {};
      for (var i = 0; i < inputs.length; i++) {
        var el = inputs[i];
        var key = el.name || el.id || el.placeholder || "field_" + i;
        var elTag = el.tagName.toLowerCase();
        if (elTag === "input" && (el.type === "submit" || el.type === "button" || el.type === "hidden")) {
          continue;
        }
        values[key] = el.value || "";
      }
      return {
        success: true,
        data: { fields: values, count: Object.keys(values).length, formAction: form.action || "" }
      };
    },
    _submitForm: function(params) {
      var formSelector = params.formSelector || "form";
      var form;
      try {
        form = document.querySelector(formSelector);
      } catch (e) {
        form = document.querySelector("form");
      }
      if (!form) {
        return { success: false, error: "\u672A\u627E\u5230\u8868\u5355\u5143\u7D20", data: {} };
      }
      var submitBtn = form.querySelector('[type="submit"]') || form.querySelector('button[type="submit"]') || form.querySelector('input[type="submit"]');
      if (!submitBtn) {
        var btns = form.querySelectorAll("button, input[type='button']");
        for (var i = 0; i < btns.length; i++) {
          var text = (btns[i].textContent || btns[i].value || "").toLowerCase();
          if (text.indexOf("submit") !== -1 || text.indexOf("\u63D0\u4EA4") !== -1 || text.indexOf("\u767B\u5F55") !== -1) {
            submitBtn = btns[i];
            break;
          }
        }
      }
      if (submitBtn) {
        try {
          submitBtn.click();
          return { success: true, data: { submitted: true, formAction: form.action || "" } };
        } catch (e) {
          return { success: false, error: "\u70B9\u51FB\u63D0\u4EA4\u6309\u94AE\u5931\u8D25: " + e.message, data: {} };
        }
      }
      try {
        form.submit();
        return { success: true, data: { submitted: true, formAction: form.action || "", method: "form.submit()" } };
      } catch (e) {
        return { success: false, error: "\u8868\u5355\u63D0\u4EA4\u5931\u8D25: " + e.message, data: {} };
      }
    }
  };
  var DOMTools = {
    highlight_keywords: function(params) {
      var keywords = params.keywords || [];
      if (!keywords || keywords.length === 0)
        return;
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
      while (node = walker.nextNode()) {
        if (node.parentElement && !node.parentElement.classList.contains("highlight-keyword") && !DOMTools._isExcludedElement(node.parentElement)) {
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
      if (styleSheet)
        return;
      styleSheet = document.createElement("style");
      styleSheet.id = "highlight-style";
      styleSheet.textContent = ".highlight-keyword {background-color: #ffff00;padding: 1px 2px;border-radius: 2px;font-weight: bold;}";
      document.head.appendChild(styleSheet);
    }
  };
  var BrowserActionHandlers = {
    click: function(target, params) {
      var selector = target.selector;
      var text = target.text;
      var element = null;
      if (selector) {
        var loc = ElementLocator.findElement(selector);
        if (!loc.found)
          return { success: false, error: "\u5143\u7D20\u4E0D\u5B58\u5728: " + selector };
        if (loc.disabled)
          return { success: false, error: "\u5143\u7D20\u5DF2\u7981\u7528: " + selector };
        if (!loc.visible) {
          var elPrelim = document.querySelector(selector);
          if (elPrelim) {
            elPrelim.scrollIntoView({ behavior: "instant", block: "center" });
            var loc2 = ElementLocator.findElement(selector);
            if (!loc2.visible) {
              try {
                elPrelim.click();
                return { success: true, data: { selector, clicked: true } };
              } catch (e) {
              }
              return { success: false, error: "\u5143\u7D20\u4E0D\u53EF\u89C1: " + selector };
            }
          } else {
            return { success: false, error: "\u5143\u7D20\u4E0D\u53EF\u89C1: " + selector };
          }
        }
        if (!loc.inViewport) {
          ElementLocator.scrollIntoViewIfNeeded(selector);
        }
        element = document.querySelector(selector);
      } else if (text) {
        element = BrowserActionHandlers._findElementByText(text);
        if (!element)
          return { success: false, error: "\u672A\u627E\u5230\u6587\u672C\u5339\u914D\u7684\u5143\u7D20: " + text };
      } else {
        return { success: false, error: "\u7F3A\u5C11 selector \u6216 text" };
      }
      try {
        element.click();
        return { success: true, data: { selector: selector || "text:" + text, clicked: true } };
      } catch (e) {
        return { success: false, error: "\u70B9\u51FB\u5931\u8D25: " + e.message };
      }
    },
    input: async function(target, params) {
      var selector = target.selector;
      var value = params.value !== void 0 && params.value !== null ? params.value : params.text || null;
      if (!selector)
        return { success: false, error: "\u7F3A\u5C11 selector" };
      if (value === void 0 || value === null)
        return { success: false, error: "\u7F3A\u5C11 params.value" };
      var loc = ElementLocator.findElement(selector);
      if (!loc.found)
        return { success: false, error: "\u5143\u7D20\u4E0D\u5B58\u5728: " + selector };
      if (loc.disabled)
        return { success: false, error: "\u5143\u7D20\u5DF2\u7981\u7528: " + selector };
      if (!loc.visible) {
        var elementPrelim = document.querySelector(selector);
        if (elementPrelim) {
          elementPrelim.scrollIntoView({ behavior: "instant", block: "center" });
          await new Promise(function(r) {
            setTimeout(r, 200);
          });
          var loc2 = ElementLocator.findElement(selector);
          if (loc2.visible) {
            return BrowserActionHandlers._doInput(elementPrelim, selector, value);
          }
          try {
            return BrowserActionHandlers._doInput(elementPrelim, selector, value);
          } catch (e) {
            return { success: false, error: "\u5143\u7D20\u4E0D\u53EF\u89C1: " + selector };
          }
        }
        return { success: false, error: "\u5143\u7D20\u4E0D\u53EF\u89C1: " + selector };
      }
      try {
        var element = document.querySelector(selector);
        return BrowserActionHandlers._doInput(element, selector, value);
      } catch (e) {
        return { success: false, error: "\u8F93\u5165\u5931\u8D25: " + e.message };
      }
    },
    _doInput: function(element, selector, value) {
      element.focus();
      element.value = "";
      element.value = value;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return { success: true, data: { selector, value } };
    },
    scroll: function(target, params) {
      var direction = params.direction || "down";
      var amount = params.amount || 500;
      try {
        var scrollY = direction === "up" ? -amount : amount;
        window.scrollBy({ top: scrollY, behavior: "smooth" });
        return { success: true, data: { direction, amount } };
      } catch (e) {
        return { success: false, error: "\u6EDA\u52A8\u5931\u8D25: " + e.message };
      }
    },
    extract: function(target, params) {
      var selector = target.selector || params && params.selector || null;
      if (!selector)
        return { success: false, error: "\u7F3A\u5C11 selector" };
      try {
        var elements = document.querySelectorAll(selector);
        if (!elements || elements.length === 0) {
          return { success: false, error: "\u672A\u627E\u5230\u5339\u914D\u5143\u7D20: " + selector };
        }
        var contents = [];
        for (var i = 0; i < elements.length; i++) {
          contents.push({
            text: (elements[i].innerText || "").substring(0, 2e3),
            html: (elements[i].innerHTML || "").substring(0, 500),
            tagName: elements[i].tagName
          });
        }
        return {
          success: true,
          data: {
            selector,
            count: contents.length,
            contents
          }
        };
      } catch (e) {
        return { success: false, error: "\u63D0\u53D6\u5931\u8D25: " + e.message };
      }
    },
    wait_element: function(target, params) {
      var selector = target.selector;
      var text = target.text;
      var timeout = params.timeout || 1e4;
      if (!selector && !text)
        return { success: false, error: "\u7F3A\u5C11 selector \u6216 text" };
      var findElement = function() {
        if (selector)
          return document.querySelector(selector);
        if (text)
          return BrowserActionHandlers._findElementByText(text);
        return null;
      };
      return new Promise(function(resolve) {
        var element = findElement();
        if (element) {
          resolve({ success: true, data: { selector: selector || "text:" + text, found: true } });
          return;
        }
        var observer = new MutationObserver(function() {
          var el = findElement();
          if (el) {
            observer.disconnect();
            resolve({ success: true, data: { selector: selector || "text:" + text, found: true } });
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
            resolve({ success: true, data: { selector: selector || "text:" + text, found: true } });
          } else {
            resolve({ success: false, error: "\u7B49\u5F85\u5143\u7D20\u8D85\u65F6: " + (selector || "text:" + text) });
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
        if (!element)
          return { success: false, error: "\u5143\u7D20\u4E0D\u5B58\u5728: " + selector };
      } else if (text) {
        element = BrowserActionHandlers._findElementByText(text);
        if (!element)
          return { success: false, error: "\u672A\u627E\u5230\u6587\u672C\u5339\u914D\u7684\u5143\u7D20: " + text };
      } else {
        return { success: false, error: "\u7F3A\u5C11 selector \u6216 text" };
      }
      try {
        element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true }));
        element.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false, cancelable: true }));
        return { success: true, data: { selector: selector || "text:" + text, hovered: true } };
      } catch (e) {
        return { success: false, error: "\u60AC\u505C\u5931\u8D25: " + e.message };
      }
    },
    press_key: function(target, params) {
      var key = params.key;
      if (!key)
        return { success: false, error: "\u7F3A\u5C11 key" };
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
      var keyDef = keyMap[key] || { key, code: key, keyCode: 0 };
      var element = document.activeElement;
      if (target && target.selector) {
        var el = document.querySelector(target.selector);
        if (el) {
          el.focus();
          element = el;
        }
      }
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
          key: keyDef.key,
          code: keyDef.code,
          keyCode: keyDef.keyCode,
          bubbles: true,
          cancelable: true
        }));
        targetEl.dispatchEvent(new KeyboardEvent("keypress", {
          key: keyDef.key,
          code: keyDef.code,
          keyCode: keyDef.keyCode,
          bubbles: true,
          cancelable: true
        }));
        targetEl.dispatchEvent(new KeyboardEvent("keyup", {
          key: keyDef.key,
          code: keyDef.code,
          keyCode: keyDef.keyCode,
          bubbles: true,
          cancelable: true
        }));
        return { success: true, data: { key } };
      } catch (e) {
        return { success: false, error: "\u6309\u952E\u5931\u8D25: " + e.message };
      }
    },
    scroll_to_element: function(target, params) {
      var selector = target.selector;
      if (!selector)
        return { success: false, error: "\u7F3A\u5C11 selector" };
      var element = document.querySelector(selector);
      if (!element)
        return { success: false, error: "\u5143\u7D20\u4E0D\u5B58\u5728: " + selector };
      try {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
        return { success: true, data: { selector, scrolledTo: true } };
      } catch (e) {
        return { success: false, error: "\u6EDA\u52A8\u5230\u5143\u7D20\u5931\u8D25: " + e.message };
      }
    },
    scroll_to_bottom: function(target, params) {
      try {
        window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
        return { success: true, data: { scrolledToBottom: true } };
      } catch (e) {
        return { success: false, error: "\u6EDA\u52A8\u5230\u5E95\u90E8\u5931\u8D25: " + e.message };
      }
    },
    select_option: function(target, params) {
      var selector = target.selector;
      var value = params.value;
      var label = params.label;
      if (!selector)
        return { success: false, error: "\u7F3A\u5C11 selector" };
      var selectEl = document.querySelector(selector);
      if (!selectEl)
        return { success: false, error: "\u5143\u7D20\u4E0D\u5B58\u5728: " + selector };
      if (selectEl.tagName !== "SELECT")
        return { success: false, error: "\u5143\u7D20\u4E0D\u662F SELECT: " + selector };
      try {
        var options = selectEl.options;
        var matched = false;
        for (var i = 0; i < options.length; i++) {
          var opt = options[i];
          if (value && opt.value === value || label && opt.text.trim().indexOf(label) !== -1) {
            selectEl.value = opt.value;
            matched = true;
            break;
          }
        }
        if (!matched)
          return { success: false, error: "\u672A\u627E\u5230\u5339\u914D\u9009\u9879: " + (value || label) };
        selectEl.dispatchEvent(new Event("change", { bubbles: true }));
        selectEl.dispatchEvent(new Event("input", { bubbles: true }));
        return { success: true, data: { selector, value: selectEl.value } };
      } catch (e) {
        return { success: false, error: "\u9009\u62E9\u5931\u8D25: " + e.message };
      }
    },
    extract_attribute: function(target, params) {
      var selector = target.selector;
      var attr = params && params.attr || "href";
      if (!selector)
        return { success: false, error: "\u7F3A\u5C11 selector" };
      try {
        var elements = document.querySelectorAll(selector);
        if (!elements || elements.length === 0) {
          return { success: false, error: "\u672A\u627E\u5230\u5339\u914D\u5143\u7D20: " + selector };
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
            selector,
            attr,
            count: values.length,
            values
          }
        };
      } catch (e) {
        return { success: false, error: "\u5C5E\u6027\u63D0\u53D6\u5931\u8D25: " + e.message };
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
        if (allElements[k].childNodes.length <= 3 && (allElements[k].textContent || "").trim() === text) {
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
      return { success: false, error: "\u672A\u77E5\u6062\u590D\u65B9\u6CD5: " + method };
    },
    _recoverByText: function(text) {
      if (!text)
        return { success: false, error: "\u7F3A\u5C11 text" };
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
        if (allElements[k].childNodes.length <= 3 && (allElements[k].textContent || "").trim().indexOf(text) !== -1) {
          var sel2 = BrowserActionHandlers._buildSelector(allElements[k]);
          return { success: true, data: { selector: sel2 } };
        }
      }
      return { success: false, error: "\u672A\u627E\u5230\u6587\u672C\u5339\u914D\u5143\u7D20: " + text };
    },
    _recoverByAriaLabel: function(ariaLabel) {
      if (!ariaLabel)
        return { success: false, error: "\u7F3A\u5C11 ariaLabel" };
      var elements = document.querySelectorAll("[aria-label]");
      for (var i = 0; i < elements.length; i++) {
        if ((elements[i].getAttribute("aria-label") || "").indexOf(ariaLabel) !== -1) {
          var sel = BrowserActionHandlers._buildSelector(elements[i]);
          return { success: true, data: { selector: sel } };
        }
      }
      return { success: false, error: "\u672A\u627E\u5230 aria-label \u5339\u914D\u5143\u7D20" };
    },
    _recoverByPlaceholder: function(placeholder) {
      if (!placeholder)
        return { success: false, error: "\u7F3A\u5C11 placeholder" };
      var elements = document.querySelectorAll("[placeholder]");
      for (var i = 0; i < elements.length; i++) {
        if ((elements[i].getAttribute("placeholder") || "").indexOf(placeholder) !== -1) {
          var sel = BrowserActionHandlers._buildSelector(elements[i]);
          return { success: true, data: { selector: sel } };
        }
      }
      return { success: false, error: "\u672A\u627E\u5230 placeholder \u5339\u914D\u5143\u7D20" };
    },
    _recoverByRole: function(role) {
      if (!role)
        return { success: false, error: "\u7F3A\u5C11 role" };
      var elements = document.querySelectorAll("[role]");
      for (var i = 0; i < elements.length; i++) {
        if ((elements[i].getAttribute("role") || "") === role) {
          var sel = BrowserActionHandlers._buildSelector(elements[i]);
          return { success: true, data: { selector: sel } };
        }
      }
      return { success: false, error: "\u672A\u627E\u5230 role \u5339\u914D\u5143\u7D20" };
    },
    _recoverSimilarSelector: function(failedSelector) {
      if (!failedSelector)
        return { success: false, error: "\u7F3A\u5C11 failedSelector" };
      var parts = failedSelector.split(/[\s>+~]/).filter(function(p) {
        return p.length > 0;
      });
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
      return { success: false, error: "\u65E0\u6CD5\u627E\u5230\u76F8\u4F3C selector" };
    },
    _isInNavOrHeader: function(element) {
      var current = element;
      while (current && current !== document.body) {
        var tag = current.tagName.toLowerCase();
        if (tag === "header" || tag === "nav" || tag === "footer")
          return true;
        if (current.id === "logo" || current.id === "header" || current.id === "navbar")
          return true;
        current = current.parentElement;
      }
      return false;
    },
    _recoverNearbyElement: function(failedSelector, text) {
      if (text) {
        var byText = BrowserActionHandlers._recoverByText(text);
        if (byText.success)
          return byText;
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
          }
        }
      }
      return { success: false, error: "\u65E0\u6CD5\u627E\u5230\u90BB\u8FD1\u5143\u7D20" };
    },
    _recoverByButtonText: function(text) {
      if (!text)
        return { success: false, error: "\u7F3A\u5C11 text" };
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
      return { success: false, error: "\u672A\u627E\u5230\u6309\u94AE\u6587\u672C\u5339\u914D: " + text };
    },
    _buildSelector: function(element) {
      if (element.id)
        return "#" + element.id;
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
  var ContentRuntime = {
    execute: function(toolName, params) {
      var startedAt = Date.now();
      var tool = DOMTools[toolName];
      if (!tool) {
        console.warn("ContentRuntime: \u672A\u77E5 DOM Tool", toolName);
        return {
          success: false,
          tool: toolName,
          data: null,
          error: "\u672A\u77E5 tool: " + toolName,
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
        console.error("ContentRuntime: \u6267\u884C\u5931\u8D25", toolName, err);
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
          error: "\u672A\u77E5 browser action: " + action,
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
          error: "\u6267\u884C\u5F02\u5E38: " + err.message,
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
      console.log("[ContentRuntime] \u6CE8\u518C handler:", name);
    },
    /**
     * unregisterHandler(name) — Plugin 注销 Action handler
     */
    unregisterHandler: function(name) {
      delete BrowserActionHandlers[name];
      console.log("[ContentRuntime] \u6CE8\u9500 handler:", name);
    },
    getPageState: function() {
      return {
        url: window.location.href,
        title: document.title,
        domLength: document.body ? document.body.innerHTML.length : 0
      };
    }
  };
  (function registerPluginHandlers() {
    if (typeof FormAutofillPlugin !== "undefined") {
      ContentRuntime.registerHandler("fill_form", function(target, params) {
        return FormAutofillPlugin.execute({ type: "fill_form", params });
      });
      ContentRuntime.registerHandler("read_form", function(target, params) {
        return FormAutofillPlugin.execute({ type: "read_form", params });
      });
      ContentRuntime.registerHandler("submit_form", function(target, params) {
        return FormAutofillPlugin.execute({ type: "submit_form", params });
      });
      console.log("[Plugins] Content Script: form-autofill \u5DF2\u6CE8\u518C (3 handlers)");
    }
  })();
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getPageContent") {
      var pageTitle = document.title;
      var mode = request.mode || "content";
      var rawText = document.body.innerText || "";
      var rawLength = rawText.length;
      var cleanText = ContentProcessor.extract(mode);
      var cleanLength = cleanText.length;
      var preview;
      if (mode === "visual") {
        try {
          var parsed = JSON.parse(cleanText);
          preview = "\u56FE\u7247\u6570\u91CF: " + parsed.length;
        } catch (e) {
          preview = cleanText.substring(0, 600);
        }
      } else {
        preview = cleanText.substring(0, 600);
      }
      console.log("===== ContentProcessor \u8C03\u8BD5\u4FE1\u606F =====");
      console.log("\u5F53\u524D\u6A21\u5F0F:", mode);
      console.log("\u539F\u59CB\u957F\u5EA6:", rawLength);
      console.log("\u6E05\u6D17\u540E\u957F\u5EA6:", cleanLength);
      console.log("\u7F29\u51CF\u6BD4\u4F8B:", rawLength > 0 ? 100 - Math.round(cleanLength / rawLength * 100) + "%" : "N/A");
      console.log("\u6700\u7EC8\u53D1\u9001\u5185\u5BB9(\u524D200\u5B57):", cleanText.slice(0, 200));
      sendResponse({
        title: pageTitle,
        preview,
        fullText: cleanText,
        totalLength: cleanLength,
        rawLength,
        mode
      });
      return true;
    }
    if (request.action === "getObservation") {
      var snapshot = ContentObserver.buildObservation();
      sendResponse({
        snapshot
      });
      return true;
    }
    if (request.type === "execute_action") {
      var result = ContentRuntime.execute(request.action, request.data);
      sendResponse(result);
      return true;
    }
    if (request.type === "browser_action") {
      ContentRuntime.handleBrowserAction(request.action, request.target, request.params).then(function(result2) {
        sendResponse(result2);
      }).catch(function(err) {
        sendResponse({
          success: false,
          error: "\u6267\u884C\u5F02\u5E38: " + err.message,
          data: {},
          observation: {},
          durationMs: 0
        });
      });
      return true;
    }
    if (request.action === "getPageState") {
      var state = ContentRuntime.getPageState();
      sendResponse(state);
      return true;
    }
  });
})();
