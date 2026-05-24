/**
 * runtimeAPI.js — Runtime 对外唯一接口
 *
 * 这是 UI 层唯一允许直接调用的 Runtime 入口。
 * 所有 Runtime 内部操作（Agent / Chat / 状态查询）必须经过此 API。
 *
 * 单向数据流：
 *   UI → runtimeAPI.startTask() / sendMessage() / stopTask()
 *   UI ← runtimeEvents (通过 subscribe)
 *
 * UI 绝不直接访问 RuntimeState / Planner / Tool / Provider。
 */

var RuntimeAPI = (function() {
  'use strict';

  var _config = {
    providerType: 'deepseek',
    apiKey: '',
    openclawEndpoint: 'http://localhost:18789/hooks/agent',
    captureMode: 'content'
  };

  var api = {};

  /**
   * configure(options)
   *
   * 设置 Runtime 配置。UI 启动时必须调用一次。
   */
  api.configure = function(options) {
    if (!options) return;
    if (options.providerType !== undefined) _config.providerType = options.providerType;
    if (options.apiKey !== undefined) _config.apiKey = options.apiKey;
    if (options.openclawEndpoint !== undefined) _config.openclawEndpoint = options.openclawEndpoint;
    if (options.captureMode !== undefined) _config.captureMode = options.captureMode;
    _applyProvider();
  };

  /**
   * startTask(request)
   *
   * 启动一个 Runtime 任务（总结 / QA / Agent）。
   *
   * request: {
   *   template: 'summarize' | 'qa' | 'agent',
   *   pageContent: string,
   *   question: string (optional),
   *   goal: string (for agent mode),
   *   activeTab: chrome.tabs.Tab
   * }
   *
   * 返回：Promise<result>
   */
  api.startTask = async function(request) {
    if (!request) throw new Error('RuntimeAPI.startTask: request 为空');

    if (ReactRuntimeLoop.isRunning()) {
      throw new Error('Agent 正在执行任务中，请等待完成后再操作');
    }

    var activeTab = request.activeTab || PopupState.activeTab;
    if (!activeTab || !activeTab.id) throw new Error('无法获取当前标签页');

    if (_config.providerType !== 'openclaw' && !_config.apiKey) {
      throw new Error('请先设置 API Key');
    }

    if (_config.providerType === 'openclaw') {
      try {
        var testResult = await api.testConnection();
        if (!testResult.ok) {
          throw new Error('OpenClaw 服务不可用: ' + testResult.message + '。请确保本地 OpenClaw 已启动，或在设置中切换到 DeepSeek。');
        }
      } catch (testErr) {
        if (testErr.message.indexOf('不支持连接测试') !== -1) {
          throw new Error('OpenClaw Provider 不支持连接测试');
        }
        if (testErr.message.indexOf('OpenClaw 服务不可用') !== -1) {
          throw testErr;
        }
        throw new Error('OpenClaw 服务不可用: ' + testErr.message + '。请确保本地 OpenClaw 已启动，或在设置中切换到 DeepSeek。');
      }
    }

    var context = RuntimeContext.normalize({
      activeTab: activeTab,
      apiKey: _config.apiKey,
      providerType: _config.providerType,
      mode: _config.captureMode,
      pageContent: request.pageContent || '',
      goal: request.goal || request.question || '',
      question: request.question || '',
      template: request.template || ''
    });

    if (request.template === 'agent') {
      return await ReactRuntimeLoop.start(context.goal, context);
    } else {
      return await AgentRuntime.run({
        template: request.template,
        pageContent: request.pageContent,
        mode: _config.captureMode,
        apiKey: _config.apiKey,
        question: request.question || '',
        context: context
      });
    }
  };

  /**
   * stopTask()
   *
   * 取消当前正在执行的 Runtime 任务。
   */
  api.stopTask = function() {
    if (ReactRuntimeLoop.isRunning()) {
      ReactRuntimeLoop.stop();
    }
    AgentRuntime.cancel();
  };

  /**
   * sendMessage(request)
   *
   * 发送对话消息（Chat Tab）。
   */
  api.sendMessage = async function(request) {
    if (!request) throw new Error('RuntimeAPI.sendMessage: request 为空');

    if (ReactRuntimeLoop.isRunning()) {
      throw new Error('Agent 正在执行任务中，请等待完成后再对话');
    }

    if (_config.providerType !== 'openclaw' && !_config.apiKey) {
      throw new Error('请先设置 API Key');
    }

    if (_config.providerType === 'openclaw') {
      try {
        var testResult = await api.testConnection();
        if (!testResult.ok) {
          throw new Error('OpenClaw 服务不可用: ' + testResult.message + '。请确保本地 OpenClaw 已启动，或在设置中切换到 DeepSeek。');
        }
      } catch (testErr) {
        if (testErr.message.indexOf('OpenClaw 服务不可用') !== -1) throw testErr;
        throw new Error('OpenClaw 服务不可用: ' + testErr.message + '。请确保本地 OpenClaw 已启动，或在设置中切换到 DeepSeek。');
      }
    }

    return await ChatRuntime.send({
      userMessage: request.userMessage,
      apiKey: _config.apiKey,
      systemPrompt: request.systemPrompt,
      imageBase64: request.imageBase64 || null,
      imageMimeType: request.imageMimeType || null
    });
  };

  /**
   * subscribe(eventName, handler)
   *
   * 订阅 Runtime 事件。UI 通过此方法接收状态变化（只读）。
   */
  api.subscribe = function(eventName, handler) {
    RuntimeEvents.on(eventName, handler);
  };

  /**
   * unsubscribe(eventName, handler)
   */
  api.unsubscribe = function(eventName, handler) {
    RuntimeEvents.off(eventName, handler);
  };

  /**
   * getState()
   *
   * 获取 Runtime 当前状态的只读快照。
   */
  api.getState = function() {
    var rs = RuntimeState.get();
    var loopState = ReactRuntimeLoop.isRunning()
      ? ReactRuntimeLoop.getState()
      : null;
    var planProgress = PlannerEngine.getProgress();
    var recoveryStats = RecoveryManager.getStats();

    return Object.freeze({
      phase: rs.phase,
      sessionId: rs.sessionId || RuntimeSession.getSessionId(),
      runId: rs.runId,
      startedAt: rs.startedAt,
      metadata: rs.metadata ? Object.assign({}, rs.metadata) : null,
      loopState: loopState,
      planProgress: planProgress,
      stats: recoveryStats
    });
  };

  /**
   * getProviderCapabilities()
   *
   * 获取当前 Provider 的能力声明。
   */
  api.getProviderCapabilities = function() {
    var provider = LLMProvider._current;
    if (provider && provider.capabilities) {
      return Object.assign({}, provider.capabilities);
    }
    return null;
  };

  /**
   * testConnection()
   *
   * 测试 Provider 连接。
   */
  api.testConnection = async function() {
    var provider = LLMProvider._current;
    if (!provider || !provider.testConnection) {
      return { ok: false, message: '当前 Provider 不支持连接测试' };
    }
    return await provider.testConnection();
  };

  /**
   * clearChat(url)
   */
  api.clearChat = function(url) {
    ChatRuntime.clearHistory(url || '');
  };

  /**
   * loadChatHistory(url)
   */
  api.loadChatHistory = async function(url) {
    return await ChatRuntime.loadHistory(url);
  };

  /**
   * getPlanNodes()
   *
   * 获取当前 Plan 的节点列表（用于 UI 渲染计划图）。
   * 返回：节点数组 [{ id, description, status, action, ... }]
   */
  api.getPlanNodes = function() {
    var plan = PlannerEngine.getCurrentPlan();
    if (!plan) return [];
    return plan.getNodes();
  };

  // ==========================================
  //   内部方法
  // ==========================================

  function _applyProvider() {
    var providerConfig = {};
    if (_config.providerType === 'deepseek') {
      providerConfig = { apiKey: _config.apiKey };
    } else if (_config.providerType === 'openclaw') {
      providerConfig = { endpoint: _config.openclawEndpoint };
    }
    LLMProvider.setProvider(_config.providerType, providerConfig);
  }

  return api;
})();
