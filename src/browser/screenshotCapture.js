/**
 * screenshotCapture.js — 截图能力封装
 *
 * 职责：
 *   1. captureTab() — 截取当前 Tab 可见区域，返回 base64
 *   2. fileToBase64() — 将 File 对象转为 base64
 *   3. compress() — 压缩图片到目标大小
 *
 * 运行在 Side Panel 上下文（非 content script）。
 */

var ScreenshotCapture = {
  MAX_BASE64_SIZE: 1048576,

  captureTab: async function() {
    var dataUrl = await chrome.tabs.captureVisibleTab(null, {
      format: "jpeg",
      quality: 90
    });
    var base64 = dataUrl.replace(/^data:image\/jpeg;base64,/, "");
    return base64;
  },

  fileToBase64: async function(file) {
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function() {
        var dataUrl = reader.result;
        var base64 = dataUrl.replace(/^data:[^;]+;base64,/, "");
        resolve(base64);
      };
      reader.onerror = function() {
        reject(new Error("读取文件失败"));
      };
      reader.readAsDataURL(file);
    });
  },

  compress: async function(base64, mimeType, maxWidth, quality) {
    if (!maxWidth) maxWidth = 1280;
    if (!quality) quality = 0.85;
    if (!mimeType) mimeType = "image/jpeg";

    return new Promise(function(resolve) {
      var img = new Image();
      img.onload = function() {
        var w = img.width;
        var h = img.height;

        if (w > maxWidth) {
          h = Math.round(h * maxWidth / w);
          w = maxWidth;
        }

        var canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;

        var ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);

        var compressed = canvas.toDataURL(mimeType, quality);
        var result = compressed.replace(/^data:[^;]+;base64,/, "");

        if (result.length > ScreenshotCapture.MAX_BASE64_SIZE && quality > 0.3) {
          ScreenshotCapture.compress(base64, mimeType, maxWidth, quality - 0.15).then(resolve);
        } else {
          resolve(result);
        }
      };
      img.onerror = function() {
        resolve(base64);
      };
      img.src = "data:" + mimeType + ";base64," + base64;
    });
  }
};
