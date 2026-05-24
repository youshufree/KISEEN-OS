/**
 * PopupState - popup 全局状态
 *
 * 集中管理 popup 运行时的所有可变状态。
 */

var PopupState = {
  pageContent: "",
  hasApiKey: false,
  lastParsedData: null,
  captureMode: "content",
  activeTab: null,
  currentQuestion: "",
  chatMode: false,
  chatHistory: [],
  providerType: "deepseek",
  openclawEndpoint: "",
  agentTabId: null,
  activePanel: "analyze",
  analyzeMode: "summary"
};
