/**
 * sidepanel-init.js — 入口文件
 *
 * 职责：初始化 Runtime 核心 + 协调各 UI 模块初始化
 * 这是 sidepanel.bundle.js 的启动入口。
 */
document.addEventListener("DOMContentLoaded", async function() {

  // 1. 初始化 Runtime 核心
  RuntimeSession.init();
  RuntimeTrace.init();
  RuntimeEvents.enableThrottle(50);

  // 2. 初始化 Agent 模式控制器
  AgentModeController.init({
    summaryModeBtn: document.getElementById("summaryModeBtn"),
    agentModeBtn: document.getElementById("agentModeBtn"),
    summaryModeContent: document.getElementById("summaryModeContent"),
    agentModeContent: document.getElementById("agentModeContent"),
    agentGoalInput: document.getElementById("agentGoalInput"),
    agentRunBtn: document.getElementById("agentRunBtn"),
    agentCancelBtn: document.getElementById("agentCancelBtn"),
    agentProgress: document.getElementById("agentProgress"),
    planNodeList: document.getElementById("planNodeList"),
    agentCurrentStep: document.getElementById("agentCurrentStep"),
    agentAnswer: document.getElementById("agentAnswer"),
    agentAnswerText: document.getElementById("agentAnswerText")
  });

  // 2.5 初始化插件系统
  BuiltinPlugins.init();

  // 3. 初始化各 UI 模块
  await SidepanelConfig.init();
  await SidepanelTabs.init();

  SidepanelImages.init();
  SidepanelChat.init();
  SidepanelAnalyze.init();
  SidepanelBenchmark.init();

  // 4. 绑定对话发送按钮（协调图片）
  var askBtn = document.getElementById("askBtn");
  var questionInput = document.getElementById("questionInput");

  askBtn.addEventListener("click", function() {
    SidepanelChat.sendMessage();
    SidepanelImages.clear();
  });

  questionInput.addEventListener("keydown", function(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      askBtn.click();
    }
  });

  // 5. 抓取首次页面内容
  try {
    await SidepanelAnalyze.fetchPageContent("content");
  } catch (err) {
    var loadingEl = document.getElementById("loading");
    var errorEl = document.getElementById("error");
    if (loadingEl) loadingEl.style.display = "none";
    if (errorEl) {
      errorEl.style.display = "block";
      errorEl.textContent = "读取失败：" + err.message;
    }
  }

  // 6. 加载对话历史
  await SidepanelChat.loadHistory();
});
