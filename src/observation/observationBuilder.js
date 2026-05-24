var ObservationBuilder = {

  build: function(snapshot, context) {
    if (!snapshot) {
      return this._emptyObservation();
    }

    context = context || {};

    var pageType = snapshot.pageType || this._inferPageType(snapshot);
    var availableActions = this._inferAvailableActions(snapshot, pageType);
    var summary = this._buildSummary(snapshot, pageType);
    var semanticSummary = this._buildSemanticSummary(snapshot, pageType, availableActions);
    var observationText = this._buildObservationText(snapshot, pageType, availableActions, semanticSummary);

    var observation = {
      summary: summary,
      pageType: pageType,
      semanticSummary: semanticSummary,
      interactiveElements: snapshot.interactiveElements || [],
      availableActions: availableActions,
      forms: snapshot.forms || [],
      pageMeta: snapshot.pageMeta || {},
      observationText: observationText
    };

    RuntimeEvents.emit("observation_built", {
      type: "observation_built",
      timestamp: Date.now(),
      payload: {
        pageType: pageType,
        interactiveCount: (snapshot.interactiveElements || []).length,
        formCount: (snapshot.forms || []).length,
        actionCount: availableActions.length
      }
    });

    return observation;
  },

  _inferPageType: function(snapshot) {
    var forms = snapshot.forms || [];
    var interactiveElements = snapshot.interactiveElements || [];
    var links = snapshot.links || [];
    var inputs = snapshot.inputs || [];

    var visibleInteractive = [];
    for (var i = 0; i < interactiveElements.length; i++) {
      if (interactiveElements[i].visible) {
        visibleInteractive.push(interactiveElements[i]);
      }
    }

    if (forms.length > 0 && inputs.length > 3) return "form";

    if (links.length > 15 && visibleInteractive.length < 10) return "list";

    if (snapshot.textContent && snapshot.textContent.length > 500 && visibleInteractive.length < 5) {
      return "article";
    }

    if (snapshot.buttons && snapshot.buttons.length > 5 && forms.length === 0) {
      return "dashboard";
    }

    if (snapshot.pageMeta && snapshot.pageMeta.url) {
      var url = snapshot.pageMeta.url;
      if (url.indexOf("chat") !== -1 || url.indexOf("message") !== -1) {
        return "chat";
      }
    }

    if (visibleInteractive.length > 10 && forms.length === 0) {
      return "dashboard";
    }

    return "other";
  },

  _inferAvailableActions: function(snapshot, pageType) {
    var actions = [];
    var interactiveElements = snapshot.interactiveElements || [];
    var forms = snapshot.forms || [];

    for (var i = 0; i < interactiveElements.length; i++) {
      var el = interactiveElements[i];
      if (!el.visible) continue;

      if (el.tag === "button" && el.text) {
        actions.push("点击「" + el.text + "」按钮");
      } else if (el.tag === "a" && el.text) {
        actions.push("点击「" + el.text + "」链接");
      }

      if (actions.length >= 10) break;
    }

    for (var f = 0; f < forms.length; f++) {
      var form = forms[f];
      if (form.inputs && form.inputs.length > 0) {
        var inputNames = [];
        for (var j = 0; j < form.inputs.length; j++) {
          var input = form.inputs[j];
          if (input.name) inputNames.push(input.name);
          else if (input.placeholder) inputNames.push(input.placeholder);
        }
        if (inputNames.length > 0) {
          actions.push("填写表单（" + inputNames.slice(0, 3).join("、") + "）");
        }
      }
    }

    return actions;
  },

  _buildSummary: function(snapshot, pageType) {
    var meta = snapshot.pageMeta || {};
    var parts = [];

    if (meta.title) parts.push("标题：" + meta.title);
    parts.push("类型：" + this._pageTypeLabel(pageType));

    var interactiveCount = (snapshot.interactiveElements || []).length;
    var visibleCount = 0;
    for (var i = 0; i < (snapshot.interactiveElements || []).length; i++) {
      if (snapshot.interactiveElements[i].visible) visibleCount++;
    }
    parts.push("可交互元素：" + interactiveCount + " 个（可见 " + visibleCount + " 个）");

    if (snapshot.forms && snapshot.forms.length > 0) {
      parts.push("表单：" + snapshot.forms.length + " 个");
    }

    return parts.join(" | ");
  },

  // ==========================================
  //   语义摘要（启发式，不调 LLM）
  // ==========================================

  _buildSemanticSummary: function(snapshot, pageType, availableActions) {
    var layout = snapshot.layout || {};
    var meta = snapshot.pageMeta || {};
    var buttons = snapshot.buttons || [];
    var links = snapshot.links || [];
    var inputs = snapshot.inputs || [];
    var forms = snapshot.forms || [];

    var pagePurpose = this._describePurpose(pageType, meta, buttons, links, inputs);
    var functionalAreas = this._describeAreas(layout, buttons, links, inputs, forms);
    var recommendedApproach = this._suggestApproach(pageType, layout, buttons, inputs, forms);
    var primaryActions = this._pickPrimaryActions(availableActions, pageType, layout);
    var layoutHints = this._describeLayout(layout);

    return {
      pagePurpose: pagePurpose,
      functionalAreas: functionalAreas,
      recommendedApproach: recommendedApproach,
      primaryActions: primaryActions,
      layoutHints: layoutHints
    };
  },

  _describePurpose: function(pageType, meta, buttons, links, inputs) {
    var purposes = {
      article: "文章/阅读页面，主要内容为文字信息",
      form: "表单页面，用于填写和提交数据",
      list: "列表/导航页面，包含大量链接",
      dashboard: "仪表盘/应用页面，包含多个功能按钮",
      chat: "对话/聊天页面",
      other: "通用网页"
    };

    var purpose = purposes[pageType] || purposes.other;

    if (links.length > 20 && inputs.length < 2) {
      purpose += "，以链接导航为主";
    }
    if (buttons.length > 10) {
      purpose += "，包含大量操作按钮";
    }
    if (inputs.length > 5) {
      purpose += "，包含多个输入框";
    }

    return purpose;
  },

  _describeAreas: function(layout, buttons, links, inputs, forms) {
    var areas = [];

    if (layout.hasHeader || layout.hasNav) {
      var headerDesc = "顶部区域：";
      var headerParts = [];
      if (layout.hasNav) headerParts.push("导航栏");
      if (layout.hasSearchInput) headerParts.push("搜索框");
      headerDesc += headerParts.length > 0 ? headerParts.join("、") : "页面头部";
      areas.push({ name: "页面顶部", description: headerDesc, position: "顶部" });
    }

    areas.push({
      name: "主内容区",
      description: "页面主体内容区域" + (layout.dominantTag ? "（以" + layout.dominantTag + "元素为主）" : ""),
      position: "中部"
    });

    if (layout.hasSidebar) {
      areas.push({
        name: "侧边栏",
        description: "辅助导航或信息区域",
        position: layout.mainColumnCount > 1 ? "右侧" : "左侧"
      });
    }

    if (forms.length > 0) {
      areas.push({
        name: "表单区域",
        description: forms.length + " 个表单",
        position: "主内容区内"
      });
    }

    if (layout.hasFooter) {
      areas.push({
        name: "页面底部",
        description: "页脚区域",
        position: "底部"
      });
    }

    return areas;
  },

  _suggestApproach: function(pageType, layout, buttons, inputs, forms) {
    if (pageType === "form" && forms.length > 0) {
      var firstForm = forms[0];
      if (firstForm.inputs && firstForm.inputs.length > 0) {
        return "依次填写表单字段后提交";
      }
    }

    if (layout.hasSearchInput) {
      return "先在搜索框中输入关键词，再点击搜索结果";
    }

    if (pageType === "list" || pageType === "dashboard") {
      return "点击列表中第一个相关链接或按钮";
    }

    if (buttons.length > 0) {
      var primaryBtn = buttons[0];
      if (primaryBtn.text) {
        return "可直接点击「" + primaryBtn.text + "」按钮";
      }
    }

    return "观察页面内容后选择合适操作";
  },

  _pickPrimaryActions: function(availableActions, pageType, layout) {
    var actions = [];

    var searchKeywords = ["搜索", "search", "查找", "查询"];
    for (var i = 0; i < availableActions.length; i++) {
      var act = availableActions[i].toLowerCase();
      for (var k = 0; k < searchKeywords.length; k++) {
        if (act.indexOf(searchKeywords[k]) !== -1) {
          if (actions.indexOf(availableActions[i]) === -1) {
            actions.push(availableActions[i]);
          }
          break;
        }
      }
    }

    for (var j = 0; j < availableActions.length; j++) {
      if (actions.length >= 5) break;
      if (actions.indexOf(availableActions[j]) === -1) {
        actions.push(availableActions[j]);
      }
    }

    if (actions.length === 0 && availableActions.length > 0) {
      actions = availableActions.slice(0, 5);
    }

    return actions;
  },

  _describeLayout: function(layout) {
    var hints = [];

    if (layout.dominantTag === "a" && !layout.hasSearchInput) {
      hints.push("以链接为主的导航页面");
    }
    if (layout.dominantTag === "button") {
      hints.push("以按钮操作为主的应用页面");
    }
    if (layout.hasNav && layout.hasMainContent) {
      hints.push("标准页面布局：导航+内容");
    }

    return hints;
  },

  // ==========================================
  //   观察文本构建（包含语义摘要）
  // ==========================================

  _buildObservationText: function(snapshot, pageType, availableActions, semanticSummary) {
    var lines = [];
    var meta = snapshot.pageMeta || {};

    lines.push("=== 页面理解 ===");
    lines.push("");

    if (semanticSummary) {
      lines.push("📄 " + semanticSummary.pagePurpose);
      lines.push("");

      if (semanticSummary.functionalAreas && semanticSummary.functionalAreas.length > 0) {
        lines.push("页面结构：");
        for (var ai = 0; ai < semanticSummary.functionalAreas.length; ai++) {
          var area = semanticSummary.functionalAreas[ai];
          lines.push("  · " + area.name + "（" + area.position + "）：" + area.description);
        }
        lines.push("");
      }

      if (semanticSummary.recommendedApproach) {
        lines.push("💡 推荐方式：" + semanticSummary.recommendedApproach);
        lines.push("");
      }

      if (semanticSummary.layoutHints && semanticSummary.layoutHints.length > 0) {
        for (var lh = 0; lh < semanticSummary.layoutHints.length; lh++) {
          lines.push("ℹ️ " + semanticSummary.layoutHints[lh]);
        }
        lines.push("");
      }
    }

    lines.push("=== 页面信息 ===");
    if (meta.title) lines.push("标题：" + meta.title);
    if (meta.url) lines.push("URL：" + meta.url);
    lines.push("页面类型：" + this._pageTypeLabel(pageType));
    lines.push("");

    // 注入站点 Selector 映射提示
    if (meta.url) {
      try {
        var hostname = new URL(meta.url).hostname;
        var selectorHints = SiteSelectorMap.buildObservationHints(hostname, pageType);
        if (selectorHints) {
          lines.push(selectorHints);
        }
      } catch (e) {}
    }

    if (semanticSummary && semanticSummary.primaryActions && semanticSummary.primaryActions.length > 0) {
      lines.push("=== 建议操作 ===");
      for (var pk = 0; pk < semanticSummary.primaryActions.length; pk++) {
        lines.push("  " + (pk + 1) + ". " + semanticSummary.primaryActions[pk]);
      }
      lines.push("");
    }

    var visibleElements = [];
    var interactiveElements = snapshot.interactiveElements || [];
    for (var vi = 0; vi < interactiveElements.length; vi++) {
      if (interactiveElements[vi].visible) {
        visibleElements.push(interactiveElements[vi]);
      }
    }

    if (visibleElements.length > 0) {
      lines.push("=== 可交互元素（" + visibleElements.length + " 个可见）===");
      var maxEl = Math.min(visibleElements.length, 15);
      for (var j = 0; j < maxEl; j++) {
        var el = visibleElements[j];
        var desc = "  [" + el.tag.toUpperCase() + "]";
        if (el.text) desc += " 「" + el.text + "」";
        if (el.selector) desc += " selector=" + el.selector;
        if (el.type) desc += " type=" + el.type;
        lines.push(desc);
      }
      if (visibleElements.length > 15) {
        lines.push("  ... 还有 " + (visibleElements.length - 15) + " 个元素");
      }
    }

    var pageText = snapshot.textContent || "";
    if (pageText.length > 0) {
      var maxTextLen = 1200;
      var textPreview = pageText.substring(0, maxTextLen);
      lines.push("");
      lines.push("=== 页面内容 ===");
      lines.push(textPreview);
      if (pageText.length > maxTextLen) {
        lines.push("...（已截断，总长 " + pageText.length + " 字符）");
      }
    }

    return lines.join("\n");
  },

  // ==========================================
  //   工具方法
  // ==========================================

  _pageTypeLabel: function(pageType) {
    var labels = {
      article: "文章/阅读页",
      form: "表单页",
      list: "列表/导航页",
      dashboard: "仪表盘/应用页",
      chat: "对话页",
      other: "其他"
    };
    return labels[pageType] || "其他";
  },

  _emptyObservation: function() {
    return {
      summary: "无页面信息",
      pageType: "other",
      semanticSummary: null,
      interactiveElements: [],
      availableActions: [],
      forms: [],
      pageMeta: {},
      observationText: "无页面观察数据"
    };
  }
};
