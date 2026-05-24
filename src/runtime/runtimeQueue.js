/**
 * runtimeQueue.js - Runtime 任务队列（最小版本）
 *
 * 职责：
 *   1. 同时只运行一个 Runtime
 *   2. 新任务进入队列，当前任务完成后自动执行下一个
 *   3. 队列最多保留 10 个，超出丢弃最旧
 *   4. cancelAll() 取消当前运行任务 + 清空队列
 */

var RuntimeQueue = {
  queue: [],
  running: false,
  MAX_QUEUE: 10,

  enqueue: function(task) {
    if (this.queue.length >= this.MAX_QUEUE) {
      this.queue.shift();
    }
    this.queue.push(task);
    if (!this.running) {
      this.next();
    }
  },

  next: function() {
    if (this.queue.length === 0) {
      this.running = false;
      return;
    }
    this.running = true;
    var task = this.queue.shift();
    var self = this;

    task.execute()
      .then(function(result) {
        if (task.onComplete) task.onComplete(result);
        self.next();
      })
      .catch(function(err) {
        if (task.onError) task.onError(err);
        self.next();
      });
  },

  cancelAll: function() {
    ReactRuntimeLoop.stop();
    AgentRuntime.cancel();
    this.queue = [];
    this.running = false;
  }
};
