/**
 * background.js - Service Worker
 *
 * 职责：监听插件图标点击，打开 Side Panel。
 */

chrome.action.onClicked.addListener(function(tab) {
  chrome.sidePanel.open({ tabId: tab.id });
});
