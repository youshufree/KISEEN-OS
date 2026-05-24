/**
 * siteSelectorMap.js — 站点 Selector 映射表
 *
 * 为常用站点记录经过验证的 CSS Selector，
 * 供 ObservationBuilder 注入到页面观察中，
 * 帮助 LLM 使用真实 selector 而非凭空猜测。
 *
 * 数据来源：手动验证各大站点的实际 DOM 结构。
 * 优先级：id > name > placeholder > aria-label > 通用 class
 */

var SiteSelectorMap = {

  /**
   * getSelectorHints(hostname)
   *
   * 根据当前站点 hostname 返回 selector 提示。
   * 返回 null 表示无已知映射。
   *
   * 返回格式：
   * {
   *   searchInput: "selector",
   *   searchResults: [{ selector, description }],
   *   headline: "selector",
   *   content: "selector",
   *   notes: ["提示1", "提示2"]
   * }
   */
  getSelectorHints: function(hostname) {
    if (!hostname) return null;

    hostname = hostname.toLowerCase().replace(/^www\./, "");

    // 精确匹配
    if (this._MAP[hostname]) {
      return this._MAP[hostname];
    }

    // 模糊匹配（子域名）
    var keys = Object.keys(this._MAP);
    for (var i = 0; i < keys.length; i++) {
      if (hostname.indexOf(keys[i]) !== -1 || keys[i].indexOf(hostname) !== -1) {
        return this._MAP[keys[i]];
      }
    }

    return null;
  },

  /**
   * buildObservationHints(hostname, pageType)
   *
   * 生成可直接注入到 Observation 文本中的 selector 提示。
   */
  buildObservationHints: function(hostname, pageType) {
    var hints = this.getSelectorHints(hostname);
    if (!hints) return "";

    var lines = [];
    lines.push("");
    lines.push("=== 站点 Selector 参考 (" + hostname + ") ===");

    if (hints.searchInput && pageType === "other") {
      lines.push("搜索框: " + hints.searchInput);
    }
    if (hints.headline) {
      lines.push("标题元素: " + hints.headline);
    }
    if (hints.content) {
      lines.push("内容区: " + hints.content);
    }
    if (hints.searchResults && hints.searchResults.length > 0) {
      for (var i = 0; i < hints.searchResults.length; i++) {
        lines.push(hints.searchResults[i].description + ": " + hints.searchResults[i].selector);
      }
    }
    if (hints.notes && hints.notes.length > 0) {
      for (var n = 0; n < hints.notes.length; n++) {
        lines.push("提示: " + hints.notes[n]);
      }
    }

    lines.push("");
    return lines.join("\n");
  },

  /**
   * getSearchInputSelector(hostname)
   *
   * 快捷方法：返回搜索框 selector。
   */
  getSearchInputSelector: function(hostname) {
    var hints = this.getSelectorHints(hostname);
    return hints ? hints.searchInput : null;
  },

  // ==========================================
  //   映射表
  // ==========================================

  _MAP: {
    // ─── Bing ───
    "bing.com": {
      searchInput: "#sb_form_q",
      searchResults: [
        { selector: "#b_results .b_algo h2 a", description: "搜索结果标题链接" },
        { selector: "#b_results .b_caption p", description: "搜索结果摘要" }
      ],
      headline: "#b_results .b_algo h2",
      notes: ["搜索后需等待 #b_results 出现"]
    },

    // ─── 百度 ───
    "baidu.com": {
      searchInput: "#kw",
      searchResults: [
        { selector: "#content_left .result h3 a", description: "搜索结果标题" },
        { selector: ".result h3 a, .c-container h3 a", description: "搜索结果标题(备选)" },
        { selector: "#wrapper_wrapper .c-container h3 a", description: "搜索结果标题(备选2)" }
      ],
      headline: "#content_left .result h3, .c-container h3",
      notes: [
        "百度首页可能有多层元素遮挡搜索框，input 后可能需要 scrollIntoView + 延迟",
        "百度搜索后页面异步加载结果，需等待 #content_left 或 .c-container 出现",
        "如果 #content_left 不存在（页面改版），尝试 #wrapper_wrapper 或 #container",
        "建议在点击搜索按钮后等待 2-3 秒再提取结果"
      ]
    },

    // ─── GitHub ───
    "github.com": {
      searchInput: 'input[name="q"]',
      searchResults: [
        { selector: '[data-testid="results-list"] h3 a', description: "搜索结果标题" },
        { selector: '[data-testid="results-list"] .search-match', description: "搜索结果匹配片段" }
      ],
      headline: "article h1, [itemprop='name']",
      content: "article.markdown-body, [data-hpc] .markdown-body",
      notes: ["GitHub 搜索结果页面结构较复杂，推荐使用 data-testid 属性定位"]
    },

    // ─── Amazon ───
    "amazon.com": {
      searchInput: "#twotabsearchtextbox",
      searchResults: [
        { selector: '[data-component-type="s-search-result"] h2 span', description: "产品标题" },
        { selector: '[data-component-type="s-search-result"] .a-price-whole', description: "产品价格（整数部分）" }
      ],
      headline: '[data-component-type="s-search-result"] h2',
      notes: ["Amazon 页面在不同地区可能有不同的 DOM 结构，此映射基于 amazon.com"]
    },

    // ─── Wikipedia ───
    "wikipedia.org": {
      searchInput: "#searchInput",
      searchResults: [
        { selector: ".mw-search-results .mw-search-result-heading a", description: "搜索结果标题" },
        { selector: ".mw-search-result-heading a", description: "搜索结果标题（备选）" }
      ],
      headline: "#firstHeading",
      content: "#mw-content-text .mw-parser-output",
      notes: [
        "Wikipedia 搜索推荐使用 URL: https://en.wikipedia.org/w/index.php?search=关键词",
        "也可以直接导航到 https://en.wikipedia.org/wiki/China",
        "如果搜索后页面类型仍为 'other'（非 article），说明未进入词条页，需点击搜索结果链接",
        "Wikipedia infobox 的信息提取：页面进入后直接提取 #mw-content-text 然后从文本中搜索关键词"
      ]
    },

    // ─── CNN ───
    "cnn.com": {
      searchInput: null,
      headline: 'h2.container__headline-text, .container_lead-plus-headlines__title',
      content: 'article, .article__content, [data-section="top-stories"]',
      notes: [
        "CNN 不使用标准 h1 作为头条标题",
        "头条标题通常使用 h2 或 h3 配合特定 class",
        "提取内容时优先使用带有 container__headline 等 class 的选择器"
      ]
    },

    // ─── Google Translate ───
    "translate.google.com": {
      searchInput: null,
      headline: null,
      content: null,
      notes: [
        "Google Translate 的输入区域使用 contenteditable 或 textarea",
        "尝试选择器: textarea, [contenteditable='true'], [aria-label*='Source']",
        "翻译输出区域: [data-language] span, [lang] span",
        "如果 aria-label 方式不可用，使用标签选择器 textarea 或 div[contenteditable]",
        "不要使用 id 选择器，因为 Google 使用动态 id"
      ]
    },

    // ─── Reddit ───
    "reddit.com": {
      searchInput: "#search",
      searchResults: [
        { selector: "shreddit-post h2, [data-testid='post-title']", description: "帖子标题" },
        { selector: "shreddit-post faceplate-number", description: "帖子点赞数" }
      ],
      headline: "shreddit-post h2, [slot='title']",
      notes: [
        "Reddit 搜索需要先导航到 https://www.reddit.com",
        "必须使用完整 URL，不能只写 'reddit'",
        "Reddit 使用自定义 web component 标签如 <shreddit-post>"
      ]
    }
  }
};
