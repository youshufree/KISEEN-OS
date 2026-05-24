/**
 * ElementLocator - 安全定位 DOM 元素
 *
 * 职责：
 *   1. 根据 selector 安全定位 DOM 元素
 *   2. 检查元素存在性、可见性、可交互性
 *   3. 检查元素是否在 viewport 内
 *   4. 禁止直接 querySelector 后立刻操作
 *
 * 运行环境：Content Script（可访问页面 DOM）
 */

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
      return this._result(false, false, false, false, false, null, null, null, "selector 为空");
    }

    var element;
    try {
      element = document.querySelector(selector);
    } catch (e) {
      return this._result(false, false, false, false, false, null, null, null, "selector 语法错误: " + e.message);
    }

    if (!element) {
      return this._result(false, false, false, false, false, null, null, null, "元素不存在: " + selector);
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
      visible: visible,
      clickable: clickable,
      inViewport: inViewport,
      disabled: disabled,
      rect: rect,
      tagName: tagName,
      text: text,
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
    if (!loc.found) return false;
    if (loc.inViewport) return false;

    try {
      var element = document.querySelector(selector);
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      return true;
    } catch (e) {
      return false;
    }
  },

  _isVisible: function(element) {
    if (!element) return false;

    var rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;

    var style = window.getComputedStyle(element);
    if (style.display === "none") return false;
    if (style.visibility === "hidden") return false;
    if (parseFloat(style.opacity) === 0) return false;

    return true;
  },

  _isInViewport: function(element) {
    if (!element) return false;

    var rect = element.getBoundingClientRect();
    var vw = window.innerWidth || document.documentElement.clientWidth;
    var vh = window.innerHeight || document.documentElement.clientHeight;

    return rect.top < vh && rect.bottom > 0 && rect.left < vw && rect.right > 0;
  },

  _result: function(found, visible, clickable, inViewport, disabled, rect, tagName, text, error) {
    return {
      found: found,
      visible: visible,
      clickable: clickable,
      inViewport: inViewport,
      disabled: disabled,
      rect: rect,
      tagName: tagName,
      text: text,
      error: error
    };
  }
};
