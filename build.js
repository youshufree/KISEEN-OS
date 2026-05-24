/**
 * build.js — Chrome Extension 拼接式构建脚本
 *
 * 策略：
 *   不转换 var → import/export，而是按依赖顺序拼接所有源文件，
 *   再用 esbuild 做 IIFE 包裹 + 压缩。
 *
 * 好处：
 *   1. 全局 var 语义完全保留
 *   2. 不再依赖 manifest.json 的顺序加载
 *   3. 每个 bundle 是单一文件
 *   4. 零业务逻辑改动
 */

var esbuild = require("esbuild");
var fs = require("fs");
var path = require("path");

var SRC = path.join(__dirname, "src");
var DIST = path.join(__dirname, "dist");

// ==========================================
//   文件依赖顺序（关键！）
// ==========================================

var SIDEPANEL_FILES = [
  // ─── Environment HAL（环境抽象层）───
  "core/environmentHAL.js",
  "core/environmentManager.js",
  "adapters/browserAdapter.js",

  // 基础层
  "events/runtimeEvents.js",
  "utils/runtimeLogger.js",

  // Runtime 核心
  "runtime/runtimeState.js",
  "runtime/runtimeSession.js",
  "runtime/runtimeQueue.js",
  "runtime/runtimeContext.js",
  "trace/traceTypes.js",
  "trace/traceStore.js",
  "trace/runtimeTrace.js",

  // Provider
  "providers/baseProvider.js",
  "providers/llmProvider.js",

  // Browser Actions
  "tools/actionRegistry.js",
  "tools/browserActionRuntime.js",
  "browser/actions/clickAction.js",
  "browser/actions/inputAction.js",
  "browser/actions/scrollAction.js",
  "browser/actions/extractAction.js",
  "browser/actions/waitElementAction.js",
  "browser/actions/hoverAction.js",
  "browser/actions/pressKeyAction.js",
  "browser/actions/scrollToElementAction.js",
  "browser/actions/scrollToBottomAction.js",
  "browser/actions/selectOptionAction.js",
  "browser/actions/extractAttributeAction.js",
  "browser/actions/navigateUrlAction.js",
  "browser/actions/openTabAction.js",
  "browser/actions/switchTabAction.js",
  "browser/browserActionDispatcher.js",
  "browser/tabRegistry.js",

  // Tools (ActionDispatcher merged into toolDispatcher)
  "tools/toolRegistry.js",
  "tools/toolDispatcher.js",
  "tools/actionExecutor.js",

  // Memory
  "memory/browserMemory.js",
  "memory/chatMemory.js",
  "runtime/react/loopMemory.js",

  // Observation
  "content/siteSelectorMap.js",
  "observation/observationBuilder.js",
  "observation/observationFetcher.js",
  "observation/observationSerializer.js",

  // Prompt
  "prompts/promptBuilder.js",

  // Planner
  "planner/stepEvaluator.js",
  "planner/planGraph.js",
  "planner/goalDecomposer.js",
  "planner/replanner.js",
  "planner/plannerEngine.js",

  // Recovery
  "recovery/actionRetry.js",
  "recovery/selectorRecovery.js",
  "recovery/recoveryStrategies.js",
  "recovery/recoveryManager.js",
  "recovery/recoveryStrategyTracker.js",
  "recovery/recoveryIntegration.js",

  // Validation
  "validation/selectorValidator.js",
  "validation/validationIntegration.js",

  // Plugins
  "plugins/pluginManager.js",
  "plugins/pluginsInit.js",

  // Chat
  "chat/chatRuntime.js",

  // Runtime Loop
  "runtime/react/loopController.js",
  "runtime/react/reactRuntimeLoop.js",
  "runtime/agentRuntime.js",

  // Runtime API (UI 唯一入口)
  "runtime/runtimeAPI.js",

  // UI
  "browser/screenshotCapture.js",
  "ui/popupState.js",
  "ui/popupControls.js",
  "ui/popupRenderer.js",
  "ui/popupEvents.js",
  "ui/popupRuntime.js",

  // UI 拆分模块
  "ui/sidepanel-config.js",
  "ui/sidepanel-tabs.js",
  "ui/sidepanel-images.js",
  "ui/sidepanel-chat.js",
  "ui/sidepanel-analyze.js",
  "ui/sidepanel-benchmark.js",
  "ui/agentModeController.js",
  "ui/sidepanel-init.js",
  "ui/sidepanel.js",

  // Benchmark
  "../benchmark/tasks/standard-tasks.js",
  "../benchmark/runner.js",
];

var BACKGROUND_FILES = [
  "events/runtimeEvents.js",
  "browser/tabRegistry.js",
  "../background.js",
];

var CONTENT_FILES = [
  "content/contentProcessor.js",
  "content/contentObserver.js",
  "content/elementLocator.js",
  "content/siteSelectorMap.js",

  // Plugin handlers (在 ContentRuntime 之前加载)
  "plugins/form-autofill/fill-form-handler.js",

  "content/contentRuntime.js",
  "content/content.js",
];

// ==========================================
//   构建函数
// ==========================================

function buildBundle(name, files) {
  console.log("[build] \uD83D\uDCE6 " + name + ".bundle.js — " + files.length + " files");

  // 拼接所有文件内容
  var concatenated = "";
  var missingFiles = [];

  for (var i = 0; i < files.length; i++) {
    var file = files[i];
    var fullPath = path.join(SRC, file);
    if (!fs.existsSync(fullPath)) {
      missingFiles.push(file);
      continue;
    }
    var content = fs.readFileSync(fullPath, "utf8");
    concatenated += "\n// === " + file + " ===\n";
    concatenated += content;
    concatenated += "\n";
  }

  if (missingFiles.length > 0) {
    console.warn("[build] \u26A0  \uFE0F 以下文件不存在（将跳过）:", missingFiles);
  }

  // esbuild 转换（IIFE 包裹 + 压缩）
  return esbuild.transform(concatenated, {
    loader: "js",
    format: "iife",
    minify: process.argv.includes("--minify"),
    target: "chrome114",
  }).then(function(result) {
    var outPath = path.join(DIST, name + ".bundle.js");
    fs.mkdirSync(DIST, { recursive: true });
    fs.writeFileSync(outPath, result.code, "utf8");

    var sizeKB = (Buffer.byteLength(result.code, "utf8") / 1024).toFixed(1);
    console.log("  \u2705 " + name + ".bundle.js — " + sizeKB + " KB");
  });
}

// ==========================================
//   入口
// ==========================================

function main() {
  console.log("[build] \uD83D\uDE80 开始构建...\n");

  return Promise.all([
    buildBundle("sidepanel", SIDEPANEL_FILES),
    buildBundle("background", BACKGROUND_FILES),
    buildBundle("content", CONTENT_FILES),
  ]).then(function() {
    console.log("\n[build] \uD83C\uDF89 构建完成！");
  }).catch(function(err) {
    console.error("[build] \uD83D\uDCA5 构建失败:", err);
    process.exit(1);
  });
}

main();
