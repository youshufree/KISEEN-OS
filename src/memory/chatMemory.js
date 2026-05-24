/**
 * chatMemory.js — 对话历史持久化
 *
 * 职责：
 *   1. 按 URL 分组存储对话历史到 chrome.storage.local
 *   2. 图片消息剥离 base64，只保留文字 + hasImage 标记
 *   3. system prompt 不持久化
 *   4. 每 URL 上限 50 条，总存储上限 4MB
 *   5. 异步操作，失败只 warn 不 throw
 *
 * 存储结构：
 *   chat:{urlKey}  → 该 URL 的消息数组
 *   chat:index     → { urlKeys: { key: lastUpdated }, totalBytes }
 */

var ChatMemory = {
  MAX_MESSAGES_PER_URL: 50,
  MAX_TOTAL_BYTES: 4 * 1024 * 1024,
  KEY_PREFIX: "chat:",
  INDEX_KEY: "chat:index",

  buildUrlKey: function(url) {
    try {
      var parsed = new URL(url);
      var key = parsed.origin + parsed.pathname;
      key = key.substring(0, 200).replace(/[^a-zA-Z0-9._-]/g, "_");
      return key;
    } catch (e) {
      return "unknown";
    }
  },

  serializeMessage: function(message) {
    var content = message.content;
    var hasImage = false;

    if (Array.isArray(content)) {
      var textParts = [];
      for (var i = 0; i < content.length; i++) {
        var part = content[i];
        if (part.type === "image_url") {
          hasImage = true;
          textParts.push("[图片]");
        } else if (part.type === "text" && part.text) {
          textParts.push(part.text);
        }
      }
      content = textParts.join("\n");
    }

    return {
      role: message.role,
      content: content,
      hasImage: hasImage,
      timestamp: Date.now()
    };
  },

  deserializeMessage: function(stored) {
    var content = stored.content || "";
    if (stored.hasImage) {
      content = content.replace("[图片]", "[图片已过期，请重新上传]");
    }
    return {
      role: stored.role,
      content: content
    };
  },

  load: async function(url) {
    var self = this;
    try {
      var urlKey = self.buildUrlKey(url);
      var storageKey = self.KEY_PREFIX + urlKey;
      var data = await chrome.storage.local.get(storageKey);
      var messages = data[storageKey] || [];
      var result = [];
      for (var i = 0; i < messages.length; i++) {
        result.push(self.deserializeMessage(messages[i]));
      }
      return result;
    } catch (e) {
      console.warn("ChatMemory.load 失败:", e);
      return [];
    }
  },

  save: async function(url, messages) {
    var self = this;
    try {
      var urlKey = self.buildUrlKey(url);
      var storageKey = self.KEY_PREFIX + urlKey;

      var filtered = [];
      for (var i = 0; i < messages.length; i++) {
        if (messages[i].role !== "system") {
          filtered.push(messages[i]);
        }
      }

      if (filtered.length > self.MAX_MESSAGES_PER_URL) {
        filtered = filtered.slice(filtered.length - self.MAX_MESSAGES_PER_URL);
      }

      var serialized = [];
      for (var j = 0; j < filtered.length; j++) {
        serialized.push(self.serializeMessage(filtered[j]));
      }

      var data = {};
      data[storageKey] = serialized;
      await chrome.storage.local.set(data);

      await self._updateIndex(urlKey, "add");
      await self._enforceStorageLimit();
    } catch (e) {
      console.warn("ChatMemory.save 失败:", e);
    }
  },

  append: async function(url, message) {
    var self = this;
    try {
      var urlKey = self.buildUrlKey(url);
      var storageKey = self.KEY_PREFIX + urlKey;
      var data = await chrome.storage.local.get(storageKey);
      var messages = data[storageKey] || [];

      if (message.role !== "system") {
        messages.push(self.serializeMessage(message));
      }

      if (messages.length > self.MAX_MESSAGES_PER_URL) {
        messages = messages.slice(messages.length - self.MAX_MESSAGES_PER_URL);
      }

      var update = {};
      update[storageKey] = messages;
      await chrome.storage.local.set(update);

      await self._updateIndex(urlKey, "add");
    } catch (e) {
      console.warn("ChatMemory.append 失败:", e);
    }
  },

  clear: async function(url) {
    var self = this;
    try {
      var urlKey = self.buildUrlKey(url);
      var storageKey = self.KEY_PREFIX + urlKey;
      await chrome.storage.local.remove(storageKey);
      await self._updateIndex(urlKey, "remove");
    } catch (e) {
      console.warn("ChatMemory.clear 失败:", e);
    }
  },

  clearAll: async function() {
    var self = this;
    try {
      var indexData = await chrome.storage.local.get(self.INDEX_KEY);
      var index = indexData[self.INDEX_KEY] || { urlKeys: {} };
      var keysToRemove = [];
      for (var key in index.urlKeys) {
        if (index.urlKeys.hasOwnProperty(key)) {
          keysToRemove.push(self.KEY_PREFIX + key);
        }
      }
      keysToRemove.push(self.INDEX_KEY);
      await chrome.storage.local.remove(keysToRemove);
    } catch (e) {
      console.warn("ChatMemory.clearAll 失败:", e);
    }
  },

  getStorageInfo: async function() {
    var self = this;
    try {
      var indexData = await chrome.storage.local.get(self.INDEX_KEY);
      var index = indexData[self.INDEX_KEY] || { urlKeys: {} };
      var totalUrls = Object.keys(index.urlKeys).length;
      return { totalUrls: totalUrls, estimatedBytes: index.totalBytes || 0 };
    } catch (e) {
      return { totalUrls: 0, estimatedBytes: 0 };
    }
  },

  _enforceStorageLimit: async function() {
    var self = this;
    try {
      var indexData = await chrome.storage.local.get(self.INDEX_KEY);
      var index = indexData[self.INDEX_KEY] || { urlKeys: {} };

      if ((index.totalBytes || 0) <= self.MAX_TOTAL_BYTES) return;

      var entries = [];
      for (var key in index.urlKeys) {
        if (index.urlKeys.hasOwnProperty(key)) {
          entries.push({ key: key, lastUpdated: index.urlKeys[key] });
        }
      }
      entries.sort(function(a, b) { return a.lastUpdated - b.lastUpdated; });

      while ((index.totalBytes || 0) > self.MAX_TOTAL_BYTES && entries.length > 0) {
        var oldest = entries.shift();
        var storageKey = self.KEY_PREFIX + oldest.key;
        var removeData = await chrome.storage.local.get(storageKey);
        var messages = removeData[storageKey] || [];
        var removedBytes = JSON.stringify(messages).length;

        await chrome.storage.local.remove(storageKey);
        delete index.urlKeys[oldest.key];
        index.totalBytes = Math.max(0, (index.totalBytes || 0) - removedBytes);
      }

      var update = {};
      update[self.INDEX_KEY] = index;
      await chrome.storage.local.set(update);
    } catch (e) {
      console.warn("ChatMemory._enforceStorageLimit 失败:", e);
    }
  },

  _updateIndex: async function(urlKey, action) {
    var self = this;
    try {
      var indexData = await chrome.storage.local.get(self.INDEX_KEY);
      var index = indexData[self.INDEX_KEY] || { urlKeys: {}, totalBytes: 0 };

      if (action === "add") {
        index.urlKeys[urlKey] = Date.now();
        var storageKey = self.KEY_PREFIX + urlKey;
        var msgData = await chrome.storage.local.get(storageKey);
        var messages = msgData[storageKey] || [];
        var entrySize = JSON.stringify(messages).length;
        var total = 0;
        var keys = Object.keys(index.urlKeys);
        for (var i = 0; i < keys.length; i++) {
          var sk = self.KEY_PREFIX + keys[i];
          var d = await chrome.storage.local.get(sk);
          var m = d[sk] || [];
          total += JSON.stringify(m).length;
        }
        index.totalBytes = total;
      } else if (action === "remove") {
        delete index.urlKeys[urlKey];
      }

      var update = {};
      update[self.INDEX_KEY] = index;
      await chrome.storage.local.set(update);
    } catch (e) {
      console.warn("ChatMemory._updateIndex 失败:", e);
    }
  }
};
