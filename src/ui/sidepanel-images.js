/**
 * sidepanel-images.js — 截图 + 图片上传
 *
 * 职责：截图捕获 / 图片上传 / 图片预览
 */
var SidepanelImages = {
  _pendingBase64: null,
  _pendingMimeType: null,

  init: function() {
    var self = this;
    self._elements = {
      screenshotBtn: document.getElementById("screenshotBtn"),
      uploadImageBtn: document.getElementById("uploadImageBtn"),
      imageFileInput: document.getElementById("imageFileInput"),
      imagePreview: document.getElementById("imagePreview"),
      previewImg: document.getElementById("previewImg"),
      removeImageBtn: document.getElementById("removeImageBtn")
    };

    self._bindEvents();
  },

  _bindEvents: function() {
    var self = this;
    var el = self._elements;

    el.screenshotBtn.addEventListener("click", async function() {
      try {
        el.screenshotBtn.disabled = true;
        var base64 = await ScreenshotCapture.captureTab();
        var compressed = await ScreenshotCapture.compress(base64, "image/jpeg");
        if (compressed.length > ScreenshotCapture.MAX_BASE64_SIZE) {
          var chatHistoryEl = document.getElementById("chatHistory");
          if (chatHistoryEl) chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;
          el.screenshotBtn.disabled = false;
          return;
        }
        self._pendingBase64 = compressed;
        self._pendingMimeType = "image/jpeg";
        el.previewImg.src = "data:image/jpeg;base64," + compressed;
        el.imagePreview.style.display = "flex";
      } catch (err) {
        console.error("截图失败：" + err.message);
      }
      el.screenshotBtn.disabled = false;
    });

    el.uploadImageBtn.addEventListener("click", function() {
      el.imageFileInput.click();
    });

    el.imageFileInput.addEventListener("change", async function(e) {
      var file = e.target.files[0];
      if (!file) return;
      try {
        var base64 = await ScreenshotCapture.fileToBase64(file);
        var compressed = await ScreenshotCapture.compress(base64, file.type);
        if (compressed.length > ScreenshotCapture.MAX_BASE64_SIZE) {
          el.imageFileInput.value = "";
          return;
        }
        self._pendingBase64 = compressed;
        self._pendingMimeType = file.type || "image/jpeg";
        el.previewImg.src = "data:" + self._pendingMimeType + ";base64," + compressed;
        el.imagePreview.style.display = "flex";
      } catch (err) {
        console.error("读取图片失败：" + err.message);
      }
    });

    el.removeImageBtn.addEventListener("click", function() {
      self.clear();
    });
  },

  clear: function() {
    this._pendingBase64 = null;
    this._pendingMimeType = null;
    this._elements.imagePreview.style.display = "none";
    this._elements.imageFileInput.value = "";
  },

  getPendingImage: function() {
    return {
      base64: this._pendingBase64,
      mimeType: this._pendingMimeType
    };
  }
};
