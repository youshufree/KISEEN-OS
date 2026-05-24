/**
 * form-autofill plugin — Content Script handler
 *
 * 运行环境：Content Script（可访问 DOM）
 * 注册方：PluginManager 在加载时注入到 ContentRuntime
 */
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

    return { success: false, error: "未知操作: " + actionType, data: {} };
  },

  _fillForm: function(params) {
    var fields = params.fields;
    if (!fields || typeof fields !== "object") {
      return { success: false, error: "缺少 fields 参数", data: {} };
    }

    var filled = [];
    var failed = [];
    var fieldNames = Object.keys(fields);

    for (var i = 0; i < fieldNames.length; i++) {
      var name = fieldNames[i];
      var value = fields[name];

      // 按 name 属性查找
      var el = document.querySelector('[name="' + name + '"]');
      if (!el) {
        // 按 id 查找
        el = document.getElementById(name);
      }
      if (!el) {
        // 按 placeholder 模糊查找
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
      data: { filled: filled, failed: failed, total: fieldNames.length },
      error: failed.length > 0 ? "未找到字段: " + failed.join(", ") : null
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
      return { success: false, error: "未找到表单元素", data: {} };
    }

    var inputs = form.querySelectorAll("input, textarea, select");
    var values = {};
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      var key = el.name || el.id || el.placeholder || ("field_" + i);
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
      return { success: false, error: "未找到表单元素", data: {} };
    }

    // 查找提交按钮
    var submitBtn = form.querySelector('[type="submit"]') ||
                    form.querySelector('button[type="submit"]') ||
                    form.querySelector('input[type="submit"]');

    if (!submitBtn) {
      // 文本匹配
      var btns = form.querySelectorAll("button, input[type='button']");
      for (var i = 0; i < btns.length; i++) {
        var text = (btns[i].textContent || btns[i].value || "").toLowerCase();
        if (text.indexOf("submit") !== -1 || text.indexOf("提交") !== -1 || text.indexOf("登录") !== -1) {
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
        return { success: false, error: "点击提交按钮失败: " + e.message, data: {} };
      }
    }

    // 最后的 fallback：触发 form submit 事件
    try {
      form.submit();
      return { success: true, data: { submitted: true, formAction: form.action || "", method: "form.submit()" } };
    } catch (e) {
      return { success: false, error: "表单提交失败: " + e.message, data: {} };
    }
  }
};
