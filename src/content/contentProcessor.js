/**
 * ContentProcessor - Browser Agent 感知层
 *
 * 职责：
 *   1. 从网页 DOM 中智能提取内容
 *   2. 支持三种抓取模式（content / full / visual）
 *   3. 删除污染元素、清洗文本
 *
 * 运行环境：Content Script（可访问页面 DOM）
 */

var ContentProcessor = {
  MAX_LENGTH: 3000,
  MIN_LENGTH: 20,

  POLLUTED_TAGS: [
    "script", "style", "noscript",
    "nav", "footer", "aside",
    "img", "svg", "canvas", "iframe",
    "video", "audio", "object", "embed",
    "input", "button", "select", "textarea",
    "form", "fieldset"
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

    console.log("ContentProcessor: 当前模式 =", mode);

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
    var root =
      document.querySelector("article")
      || document.querySelector("main")
      || document.querySelector('[role="main"]')
      || document.body;

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
    this.MAX_LENGTH = 5000;
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
      if (!src || seen[src]) continue;

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
      if (!figcaption || figImgs.length > 0) continue;

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
        alt: "此页面无可提取的图片信息",
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
        "ContentProcessor: 页面正文过少 (",
        cleaned.length,
        "chars)，可能提取失败"
      );
    }

    return cleaned;
  }
};
