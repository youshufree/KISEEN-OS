var GoalDecomposer = {

  decompose: async function(goal, observation, context, structuredObservation) {
    var availableActions = BrowserActionDispatcher.getRegisteredTypes();

    var systemLines = [
      "你是一个任务分解专家。你的职责是将用户目标拆解为可执行的浏览器操作步骤。",
      "",
      "可用操作类型："
    ];

    for (var i = 0; i < availableActions.length; i++) {
      systemLines.push("  - " + availableActions[i]);
    }

    systemLines.push("");
    systemLines.push("操作格式：");
    for (var k = 0; k < availableActions.length; k++) {
      var actName = availableActions[k];
      var actDef = ActionRegistry.get(actName);
      var desc = actDef ? actDef.description : "";
      systemLines.push("  " + actName + ": " + desc);
    }

    var bm = context && context.browserMemory;

    if (bm && bm.hasExperience) {
      systemLines.push("");
      systemLines.push("=== 历史经验（该网站）===");

      var selectors = bm.knownSelectors;
      if (selectors && Object.keys(selectors).length > 0) {
        systemLines.push("已知稳定 selector（优先使用）：");
        for (var sk in selectors) {
          if (selectors.hasOwnProperty(sk)) {
            systemLines.push("  " + sk + ": \"" + selectors[sk] + "\"");
          }
        }
      }

      var failed = bm.failedSelectors;
      if (failed && Object.keys(failed).length > 0) {
        systemLines.push("已知不可靠 selector（避免使用）：");
        for (var fk in failed) {
          if (failed.hasOwnProperty(fk)) {
            systemLines.push("  ❌ " + fk);
          }
        }
      }

      var patterns = bm.patterns;
      if (patterns && patterns.length > 0) {
        systemLines.push("行为模式：");
        for (var pi = 0; pi < patterns.length; pi++) {
          systemLines.push("  - " + patterns[pi]);
        }
      }

      var failures = bm.recentFailures;
      if (failures && failures.length > 0) {
        systemLines.push("最近失败记录（避开这些）：");
        for (var fi = 0; fi < Math.min(failures.length, 3); fi++) {
          systemLines.push("  - " + failures[fi].action + " " + failures[fi].selector + ": " + (failures[fi].reason || ""));
        }
      }
    }

    systemLines.push("");
    systemLines.push("核心原则：");
    systemLines.push("  ⛔ 第1原则：selector 必须从下面「可交互元素」列表中原样复制，严禁自己编造！");
    systemLines.push("  1. 观察语义摘要（页面理解）优先于原始 DOM 数据");
    systemLines.push("  2. 优先用 text 属性点击，而非 CSS selector（更稳定）");
    systemLines.push("  3. 从「推荐方式」「建议操作」中选取动作");
    systemLines.push("");
    systemLines.push("常见网站 Selector 参考（仅在没有观察数据时使用）：");
    systemLines.push("  - Bing 搜索框: #sb_form_q   Bing 搜索结果: #b_results  li.b_algo h2 a");
    systemLines.push("  - 百度搜索框: input#kw   百度搜索按钮: text=百度一下   百度搜索结果: #content_left  .result");
    systemLines.push("  - Wikipedia 搜索框: input[name='search']");
    systemLines.push("  - Amazon 搜索框: input[name='field-keywords']  Amazon 搜索按钮: input[type='submit']");
    systemLines.push("");
    // 列出已安装的插件 action（供 Planner 参考）
    var plugins = PluginManager.list();
    if (plugins.length > 0) {
      systemLines.push("");
      systemLines.push("=== 可用插件 Action（新增能力）===");
      for (var pi = 0; pi < plugins.length; pi++) {
        var p = plugins[pi];
        if (!p.enabled) continue;
        for (var ai = 0; ai < p.actions.length; ai++) {
          var actName = p.actions[ai];
          var def = ActionRegistry.get(actName);
          systemLines.push("  - " + actName + ": " + (def ? def.description : ""));
        }
      }
    }

    systemLines.push("要求：");
    systemLines.push("1. 每个步骤必须包含 action、description、target、params");
    systemLines.push("2. 步骤顺序必须合理，先定位再操作");
    systemLines.push("3. 最多 10 个步骤");
    systemLines.push("4. 如果页面已经有搜索框，不需要打开搜索页");
    systemLines.push("5. 优先使用历史经验里的已知稳定 selector");
    systemLines.push("6. click 优先用 { text: \"按钮文字\" } 而非 { selector: \"...\" }");
    systemLines.push("7. 最后一个步骤必须是 extract");
    systemLines.push("8. navigate_url/open_tab 的 URL 放在 params.url 中");
    systemLines.push("");
    systemLines.push("=== 严格格式要求（违反将导致解析失败）===");
    systemLines.push("9.  只返回 JSON 数组：以 [ 开头，以 ] 结束");
    systemLines.push("10. 不要输出 JSON 之外的任何文字、解释或 markdown");
    systemLines.push("11. description 必须 ≤ 20 个字符，只做简短说明");
    systemLines.push("12. 所有字符串用英文双引号 \"，禁止中文引号 \"\"");
    systemLines.push("13. 字符串内禁止换行符、禁止包含裸双引号");
    systemLines.push("14. selector 只包含 CSS 合法字符（# . > [ ] = 空格 - _ 字母数字）");
    systemLines.push("15. 数组最后一个元素后面不要加逗号");
    systemLines.push("");
    systemLines.push("输出示例：");
    systemLines.push("[");
    systemLines.push("  {\"action\":\"input\",\"description\":\"输入搜索词\",\"target\":{\"selector\":\"#q\"},\"params\":{\"value\":\"test\"}},");
    systemLines.push("  {\"action\":\"press_key\",\"description\":\"提交搜索\",\"target\":{\"selector\":\"#q\"},\"params\":{\"key\":\"Enter\"}},");
    systemLines.push("  {\"action\":\"extract\",\"description\":\"提取结果\",\"target\":{\"selector\":\"#results a\"},\"params\":{}}");
    systemLines.push("]");

    var urlInfo = "";
    if (context && context.activeTab && context.activeTab.url) {
      try {
        var parsed = new URL(context.activeTab.url);
        urlInfo = parsed.hostname.replace(/^www\./, "");
      } catch(e) {}
    }

    var userLines = [
      "用户目标：" + goal,
      "",
      "用户当前正在浏览的网站：" + (urlInfo || "未知网站"),
      "",
      "当前页面观察：",
      observation || "无观察数据"
    ];

    // ─── 注入真实 DOM Selector 列表 ───
    var interactiveEls = null;
    if (structuredObservation && structuredObservation.interactiveElements) {
      interactiveEls = structuredObservation.interactiveElements;
    }
    if (interactiveEls && interactiveEls.length > 0) {
      userLines.push("");
      userLines.push("=== 页面可交互元素（只使用以下 selector/text，不要编造）===");
      var shown = 0;
      for (var e = 0; e < interactiveEls.length && shown < 20; e++) {
        var el = interactiveEls[e];
        if (!el.visible && !el.selector) continue;
        if (el.selector || el.text) {
          var line = "";
          if (el.selector) line += "  selector: " + JSON.stringify(el.selector);
          if (el.text) line += "  text: " + JSON.stringify(el.text.substring(0, 40));
          if (el.tag) line += " [" + el.tag + "]";
          if (!el.visible) line += " (不可见)";
          userLines.push(line);
          shown++;
        }
      }
      if (shown === 0) {
        userLines.push("  （无可交互元素）");
      }
    }

    userLines.push("");
    userLines.push("⛔ 核心规则：");
    userLines.push("1. 所有 selector 必须从上方的「可交互元素」列表中直接复制，一个字符都不要改");
    userLines.push("2. 如果列表中没有需要的元素，用 text 属性替代 selector");
    userLines.push("3. 如果连 text 也没有，使用 navigate_url 导航到目标网站");
    userLines.push("4. 禁止使用任何不在「可交互元素」列表中的 selector");
    userLines.push("5. 禁止使用 input[name='q'] 这种属性选择器，除非列表里恰好有这个 selector");
    userLines.push("6. 最后一步 extract 的 selector 也要从列表中选取，不要用 body 或 h1 等通用标签");

    var messages = [
      { role: "system", content: systemLines.join("\n") },
      { role: "user", content: userLines.join("\n") }
    ];

    try {
      var apiKey = context && context.apiKey ? context.apiKey : null;
      var providerType = context && context.providerType ? context.providerType : "deepseek";
      if (!apiKey && providerType !== "openclaw") {
        console.warn("[Planner] GoalDecomposer 无 apiKey，使用 fallback 计划");
        return this._fallbackDecompose(goal);
      }

      var llmOptions = {
        messages: messages,
        timeout: 30000
      };
      if (apiKey) {
        llmOptions.apiKey = apiKey;
      }

      var result = await LLMProvider.call(llmOptions);

      var rawContent = result.content;

      // ─── 第一次尝试：标准清洗 ───
      var steps = null;
      try {
        var sanitized = sanitizeLLMOutput(rawContent);
        var cleaned = this._cleanDecomposerJSON(sanitized);
        var parsed = JSON.parse(cleaned);
        steps = parsed.steps || (Array.isArray(parsed) ? parsed : null);
        if (Array.isArray(steps) && steps.length > 0) {
          var valid = this._validateSteps(steps, interactiveEls);
          if (valid.length > 0) return valid;
        }
      } catch (e1) {
        console.warn("[Planner] 第一次 JSON 解析失败:", e1.message);
      }

      // ─── 第二次尝试：调用 LLM 修正 ───
      try {
        if (apiKey || providerType === "openclaw") {
          var fixResult = await LLMProvider.call({
            apiKey: apiKey,
            messages: [
              { role: "user", content: goal },
              { role: "assistant", content: rawContent.substring(0, 3000) },
              {
                role: "user",
                content: [
                  "你的输出 JSON 格式有错误，请修正后重新输出。",
                  "每条步骤格式：",
                  '{"action":"动作","description":"简短说明","target":{"selector":"xxx"},"params":{}}',
                  "要求：",
                  "1. 只返回 JSON 数组，不要其他文字",
                  "2. description 不超过 20 个字",
                  "3. 字符串内不能有换行",
                  "4. 不要 markdown 代码块"
                ].join("\n")
              }
            ],
            timeout: 10000
          });

          var fixCleaned = this._cleanDecomposerJSON(fixResult.content);
          var fixParsed = JSON.parse(fixCleaned);
          var fixSteps = fixParsed.steps || (Array.isArray(fixParsed) ? fixParsed : null);
          if (Array.isArray(fixSteps) && fixSteps.length > 0) {
            console.log("[Planner] 第二次 JSON 解析成功（LLM 修正）");
            var fixValid = this._validateSteps(fixSteps, interactiveEls);
            if (fixValid.length > 0) return fixValid;
          }
        }
      } catch (e2) {
        console.warn("[Planner] 第二次 JSON 解析也失败:", e2.message);
      }

      console.warn("[Planner] 使用 fallback:", goal);
      console.warn("[Planner] LLM 原始输出前 300 字:", (rawContent || "").substring(0, 300));
      return this._fallbackDecompose(goal);
    } catch (err) {
      console.error("[Planner] GoalDecomposer LLM 调用失败:", err.message);
      return this._fallbackDecompose(goal);
    }
  },

  _validateSteps: function(steps, interactiveElements) {
    var validSteps = [];
    for (var i = 0; i < steps.length; i++) {
      var s = steps[i];
      if (!s.action && !s.type) continue;

      var actionName = s.action || s.type;
      var normalizedTarget = s.target || null;
      var normalizedParams = s.params || null;

      if (typeof normalizedTarget === "string" && normalizedTarget.length > 0) {
        if (actionName === "navigate_url" || actionName === "open_tab") {
          normalizedParams = normalizedParams || {};
          normalizedParams.url = normalizedTarget.replace(/^`|`$/g, "");
          normalizedTarget = null;
        } else {
          normalizedTarget = { text: normalizedTarget };
        }
      }

      if (normalizedTarget && typeof normalizedTarget === "object" && normalizedTarget.url) {
        if (actionName === "navigate_url" || actionName === "open_tab") {
          normalizedParams = normalizedParams || {};
          normalizedParams.url = normalizedTarget.url.replace(/^`|`$/g, "").trim();
          normalizedTarget = null;
        }
      }

      if (normalizedTarget && typeof normalizedTarget === "object" && !normalizedTarget.selector && !normalizedTarget.text && !normalizedTarget.url) {
        normalizedTarget = null;
      }

      // 归一化 input 参数: text → value
      if (actionName === "input" && normalizedParams) {
        if (!normalizedParams.value && normalizedParams.text) {
          normalizedParams = Object.assign({}, normalizedParams, { value: normalizedParams.text });
          delete normalizedParams.text;
        }
      }

      // ─── Selector 追加：从 params.selector 迁移到 target.selector ───
      if (!normalizedTarget || (!normalizedTarget.selector && !normalizedTarget.text)) {
        if (normalizedParams && normalizedParams.selector) {
          normalizedTarget = normalizedTarget || {};
          normalizedTarget.selector = normalizedParams.selector;
          console.log("[Planner] selector 迁移: params.selector → target.selector:", normalizedParams.selector);
        }
      }

      validSteps.push({
        type: "action",
        action: actionName,
        description: s.description || actionName + " 操作",
        target: normalizedTarget,
        params: normalizedParams,
        maxRetries: 2
      });
    }

    if (validSteps.length === 0) {
      return this._fallbackDecompose("");
    }

    return validSteps;
  },

  /**
   * _findSelectorInElements — 在 interactiveElements 中查找匹配的 selector
   */
  _findSelectorInElements: function(originalSel, text, actionType, description, elements) {
    var desc = (description || "").toLowerCase();
    var selLower = (originalSel || "").toLowerCase();

    // 策略1: 关键词匹配（从描述中提取关键词，在元素 text 中查找）
    var keywords = this._extractMeaningfulWords(desc);
    for (var wi = 0; wi < keywords.length; wi++) {
      var kw = keywords[wi];
      for (var ei = 0; ei < elements.length; ei++) {
        var elText = ((elements[ei].text || "") + " " + (elements[ei].tag || "") + " " + (elements[ei].selector || "")).toLowerCase();
        if (elText.indexOf(kw) !== -1) {
          if (elements[ei].selector) return { selector: elements[ei].selector };
          if (elements[ei].text) return { text: elements[ei].text };
        }
      }
    }

    // 策略2: 根据 action 类型推断目标元素
    var targetTags = [];
    if (actionType === "input" || actionType === "click") {
      targetTags = ["input", "textarea", "button", "search"];
    } else if (actionType === "extract") {
      targetTags = ["a", "h2", "h3", "p", "div", "span", "li"];
    }

    for (var ti = 0; ti < targetTags.length; ti++) {
      var tag = targetTags[ti];
      for (var ej = 0; ej < elements.length; ej++) {
        if (elements[ej].tag && elements[ej].tag.toLowerCase() === tag && elements[ej].visible !== false) {
          if (elements[ej].selector) return { selector: elements[ej].selector };
          if (elements[ej].text) return { text: elements[ej].text };
        }
      }
    }

    // 策略3: ID 部分匹配
    var idMatch = selLower.match(/#([\w-]+)/);
    if (idMatch) {
      var idFragment = idMatch[1];
      for (var ek = 0; ek < elements.length; ek++) {
        if (elements[ek].selector && elements[ek].selector.indexOf(idFragment) !== -1) {
          return { selector: elements[ek].selector };
        }
      }
    }

    return null;
  },

  /**
   * _findByActionType — 根据 action 类型从元素列表中找到第一个匹配元素作为回退
   */
  _findByActionType: function(actionType, description, elements) {
    var desc = (description || "").toLowerCase();

    // input/click: 优先找搜索框
    if (actionType === "input" || actionType === "click") {
      var searchTerms = ["search", "q", "query", "keyword", "搜索", "查找", "kw", "sb_form"];
      for (var st = 0; st < searchTerms.length; st++) {
        for (var ei = 0; ei < elements.length; ei++) {
          var elId = ((elements[ei].selector || "") + " " + (elements[ei].text || "")).toLowerCase();
          if (elId.indexOf(searchTerms[st]) !== -1 && elements[ei].visible !== false) {
            if (elements[ei].selector) return { selector: elements[ei].selector };
            if (elements[ei].text) return { text: elements[ei].text };
          }
        }
      }
      // 回退: 第一个可见的 input 或 textarea
      for (var ej = 0; ej < elements.length; ej++) {
        var tagLower = (elements[ej].tag || "").toLowerCase();
        if ((tagLower === "input" || tagLower === "textarea") && elements[ej].visible !== false && elements[ej].selector) {
          return { selector: elements[ej].selector };
        }
      }
    }

    // extract: 优先找 h2/a 和搜索结果区域
    if (actionType === "extract") {
      var extractTerms = ["result", "b_algo", "content", "main", "article", "search", "repo", "post"];
      for (var xt = 0; xt < extractTerms.length; xt++) {
        for (var ek = 0; ek < elements.length; ek++) {
          var elSel = ((elements[ek].selector || "") + " " + (elements[ek].text || "")).toLowerCase();
          if (elSel.indexOf(extractTerms[xt]) !== -1) {
            if (elements[ek].selector) return { selector: elements[ek].selector };
          }
        }
      }
      // 回退: 第一个 h2 或 a 元素
      for (var el = 0; el < elements.length; el++) {
        var antTag = (elements[el].tag || "").toLowerCase();
        if ((antTag === "h2" || antTag === "h3" || antTag === "a") && elements[el].selector) {
          return { selector: elements[el].selector };
        }
      }
    }

    return null;
  },

  /**
   * _extractMeaningfulWords — 从文本中提取有意义的词（过滤停用词）
   */
  _extractMeaningfulWords: function(text) {
    var stopWords = ["的", "在", "是", "了", "和", "或", "与", "the", "a", "an", "is", "are", "was", "were", "be", "to", "of", "in", "for", "on", "and", "or", "with", "then", "that", "请", "然后", "并", "点击", "搜索", "输入", "提取", "等待", "导航", "打开", "页面", "元素"];
    var words = text.replace(/[，,。.！!？?、；;：:（）()【】\[\]""''""\s\-]+/g, " ").split(" ");
    var meaningful = [];
    for (var i = 0; i < words.length; i++) {
      var w = words[i].toLowerCase().trim();
      if (w.length >= 2 && stopWords.indexOf(w) === -1) {
        meaningful.push(w);
      }
    }
    return meaningful.slice(0, 5);
  },

  /**
   * _cleanDecomposerJSON(raw)
   * 针对 GoalDecomposer LLM 输出做激进 JSON 清洗
   */
  _cleanDecomposerJSON: function(raw) {
    if (!raw || typeof raw !== "string") return "[]";

    var cleaned = raw.trim();

    // 1. 提取 JSON 数组块（从第一个 [ 到最后一个 ]）
    var arrStart = cleaned.indexOf("[");
    var arrEnd = cleaned.lastIndexOf("]");
    if (arrStart !== -1 && arrEnd !== -1 && arrEnd > arrStart) {
      cleaned = cleaned.substring(arrStart, arrEnd + 1);
    }

    // 2. 替换中文引号为英文引号
    cleaned = cleaned
      .replace(/\u201c/g, '"')   // " → "
      .replace(/\u201d/g, '"')   // " → "
      .replace(/\u2018/g, "'")   // ' → '
      .replace(/\u2019/g, "'");  // ' → '

    // 3. 移除控制字符（0x00-0x1f 除了 \t \n \r）
    cleaned = cleaned.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");

    // 4. JSON 字符串值内部的换行替换为空格
    cleaned = cleaned.replace(/"([^"]*?)"/g, function(match, inner) {
      return '"' + inner.replace(/[\n\r]+/g, " ").trim() + '"';
    });

    // 5. 移除尾部逗号
    cleaned = cleaned.replace(/,\s*]/g, "]");
    cleaned = cleaned.replace(/,\s*}/g, "}");

    return cleaned;
  },

  _fallbackDecompose: function(goal) {
    console.log("[Planner] 使用 fallback 计划:", goal);
    var goalLower = (goal || "").toLowerCase();

    // Wikipedia 特殊处理：直接导航到词条页
    if (goalLower.indexOf("wikipedia") !== -1 || goalLower.indexOf("维基") !== -1) {
      var wikiMatch = goal.match(/[搜索]['\u201c\u2018]([^'\u201d\u2019]*)['\u201d\u2019]/);
      var wikiTerm = wikiMatch ? wikiMatch[1] : "China";
      // 尝试匹配英文词：Wikipedia 搜索 'China' 或 Wikipedia 搜索 China
      if (!wikiMatch) {
        var enMatch = goal.match(/wikipedia[^a-z]*search[^a-z]*['\u201c]?(\w+)['\u201d]?/i);
        if (enMatch) wikiTerm = enMatch[1];
      }
      var wikiUrl = "https://en.wikipedia.org/wiki/" + encodeURIComponent(wikiTerm);
      console.log("[Planner] Wikipedia fallback 直接导航:", wikiUrl);
      return [
        { type: "action", action: "navigate_url",
          description: "导航到 Wikipedia 词条", target: {}, params: { url: wikiUrl }, maxRetries: 1 },
        { type: "action", action: "wait_element",
          description: "等待页面加载", target: { selector: "#mw-content-text" }, params: { timeout: 5000 }, maxRetries: 1 },
        { type: "action", action: "extract",
          description: "提取词条内容", target: { selector: "#mw-content-text" }, params: null, maxRetries: 1 }
      ];
    }

    // 如果目标中提到搜索/输入，添加更智能的步骤
    if (goalLower.indexOf("搜索") !== -1 || goalLower.indexOf("search") !== -1 ||
        goalLower.indexOf("查找") !== -1 || goalLower.indexOf("输入") !== -1) {
      var searchMatch = goal.match(/[搜索输入]['\u201c\u2018]([^'\u201d\u2019]*)['\u201d\u2019]/);
      var searchValue = searchMatch ? searchMatch[1] : "";
      var s = [
        { type: "action", action: "wait_element",
          description: "[Fallback] 等待页面", target: { selector: "body" }, params: { timeout: 3000 }, maxRetries: 1 },
        { type: "action", action: "extract",
          description: "[Fallback] 提取内容", target: { selector: "body" }, params: null, maxRetries: 1 }
      ];
      if (searchValue) {
        s.splice(1, 0, {
          type: "action", action: "input",
          description: "输入 " + searchValue,
          target: { selector: "input" }, params: { value: searchValue }, maxRetries: 2
        });
      }
      return s;
    }

    return [
      { type: "action", action: "wait_element",
        description: "[Fallback] 等待页面", target: { selector: "body" }, params: { timeout: 3000 }, maxRetries: 1 },
      { type: "action", action: "extract",
        description: "[Fallback] 提取内容", target: { selector: "body" }, params: null, maxRetries: 1 }
    ];
  }
};
