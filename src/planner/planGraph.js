var PlanStatus = {
  PLANNING: "planning",
  RUNNING: "running",
  BLOCKED: "blocked",
  RECOVERING: "recovering",
  COMPLETED: "completed",
  FAILED: "failed"
};

var NodeStatus = {
  PENDING: "pending",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  SKIPPED: "skipped"
};

var PlanGraph = {

  MAX_NODES: 20,
  MAX_DEPTH: 5,

  create: function(goal) {
    var instance = {
      _id: "plan_" + Date.now(),
      _goal: goal || "",
      _nodes: [],
      _edges: [],
      _status: PlanStatus.PLANNING,
      _createdAt: Date.now(),
      _currentNodeId: null,
      _nodeIdCounter: 0
    };

    instance.addNode = PlanGraph._addNode.bind(instance);
    instance.addNodesFromSteps = PlanGraph._addNodesFromSteps.bind(instance);
    instance.getCurrentNode = PlanGraph._getCurrentNode.bind(instance);
    instance.getFirstPendingNode = PlanGraph._getFirstPendingNode.bind(instance);
    instance.getNode = PlanGraph._getNode.bind(instance);
    instance.startNode = PlanGraph._startNode.bind(instance);
    instance.completeNode = PlanGraph._completeNode.bind(instance);
    instance.failNode = PlanGraph._failNode.bind(instance);
    instance.skipNode = PlanGraph._skipNode.bind(instance);
    instance.insertNodeAfter = PlanGraph._insertNodeAfter.bind(instance);
    instance.replaceNode = PlanGraph._replaceNode.bind(instance);
    instance.getNodes = PlanGraph._getNodes.bind(instance);
    instance.getGoal = PlanGraph._getGoal.bind(instance);
    instance.getStatus = PlanGraph._getStatus.bind(instance);
    instance.getId = PlanGraph._getId.bind(instance);
    instance.getProgress = PlanGraph._getProgress.bind(instance);
    instance.isComplete = PlanGraph._isComplete.bind(instance);
    instance.isFailed = PlanGraph._isFailed.bind(instance);
    instance.hasPendingNodes = PlanGraph._hasPendingNodes.bind(instance);
    instance.getCompletedResults = PlanGraph._getCompletedResults.bind(instance);
    instance.serialize = PlanGraph._serialize.bind(instance);
    instance.clear = PlanGraph._clear.bind(instance);

    return instance;
  },

  _addNode: function(step) {
    if (this._nodes.length >= PlanGraph.MAX_NODES) {
      console.warn("[Planner] PlanGraph 节点数已达上限:", PlanGraph.MAX_NODES);
      return null;
    }

    this._nodeIdCounter++;
    var node = {
      id: "node_" + this._nodeIdCounter,
      type: step.type || "action",
      action: step.action || null,
      description: step.description || "",
      dependencies: step.dependencies || [],
      status: NodeStatus.PENDING,
      retries: 0,
      maxRetries: step.maxRetries || 1,
      result: null,
      startedAt: null,
      completedAt: null,
      target: step.target || null,
      params: step.params || null
    };

    this._nodes.push(node);

    if (step.dependencies && step.dependencies.length > 0) {
      for (var i = 0; i < step.dependencies.length; i++) {
        this._edges.push({
          from: step.dependencies[i],
          to: node.id
        });
      }
    }

    return node;
  },

  _addNodesFromSteps: function(steps) {
    var addedNodes = [];
    for (var i = 0; i < steps.length; i++) {
      var deps = [];
      if (i > 0 && addedNodes.length > 0) {
        deps.push(addedNodes[addedNodes.length - 1].id);
      }

      var step = Object.assign({}, steps[i]);
      step.dependencies = steps[i].dependencies || deps;

      var node = this.addNode(step);
      if (node) {
        addedNodes.push(node);
      }
    }
    return addedNodes;
  },

  _getCurrentNode: function() {
    if (this._currentNodeId) {
      var node = this.getNode(this._currentNodeId);
      if (node && (node.status === NodeStatus.COMPLETED ||
                   node.status === NodeStatus.FAILED ||
                   node.status === NodeStatus.SKIPPED)) {
        this._currentNodeId = null;
        return this.getFirstPendingNode();
      }
      if (node) return node;
    }
    return this.getFirstPendingNode();
  },

  _getFirstPendingNode: function() {
    for (var i = 0; i < this._nodes.length; i++) {
      if (this._nodes[i].status === NodeStatus.PENDING) {
        if (PlanGraph._areDependenciesMet.call(this, this._nodes[i])) {
          return this._nodes[i];
        }
      }
    }
    return null;
  },

  _getNode: function(nodeId) {
    for (var i = 0; i < this._nodes.length; i++) {
      if (this._nodes[i].id === nodeId) return this._nodes[i];
    }
    return null;
  },

  _startNode: function(nodeId) {
    var node = this.getNode(nodeId);
    if (!node) return false;
    if (node.status !== NodeStatus.PENDING) return false;

    node.status = NodeStatus.RUNNING;
    node.startedAt = Date.now();
    this._currentNodeId = nodeId;
    this._status = PlanStatus.RUNNING;

    return true;
  },

  _completeNode: function(nodeId, result) {
    var node = this.getNode(nodeId);
    if (!node) return false;
    if (node.status !== NodeStatus.RUNNING) return false;

    node.status = NodeStatus.COMPLETED;
    node.result = result || null;
    node.completedAt = Date.now();

    PlanGraph._updatePlanStatus.call(this);

    return true;
  },

  _failNode: function(nodeId, error) {
    var node = this.getNode(nodeId);
    if (!node) return false;
    if (node.status !== NodeStatus.RUNNING) return false;

    node.retries++;
    if (node.retries < node.maxRetries) {
      node.status = NodeStatus.PENDING;
      console.log("[Planner] 节点重试:", nodeId, "retries:", node.retries);
    } else {
      node.status = NodeStatus.FAILED;
      node.result = { error: error || "未知错误" };
      node.completedAt = Date.now();
    }

    PlanGraph._updatePlanStatus.call(this);

    return true;
  },

  _skipNode: function(nodeId, reason) {
    var node = this.getNode(nodeId);
    if (!node) return false;

    node.status = NodeStatus.SKIPPED;
    node.result = { skipped: true, reason: reason || "" };
    node.completedAt = Date.now();

    PlanGraph._updatePlanStatus.call(this);

    return true;
  },

  _insertNodeAfter: function(afterNodeId, step) {
    var afterNode = this.getNode(afterNodeId);
    if (!afterNode) return null;

    var newNode = this.addNode(Object.assign({}, step, {
      dependencies: [afterNodeId]
    }));

    if (!newNode) return null;

    for (var i = 0; i < this._edges.length; i++) {
      if (this._edges[i].from === afterNodeId) {
        this._edges[i].from = newNode.id;
        newNode.dependencies.push(afterNodeId);
      }
    }

    this._edges.push({ from: afterNodeId, to: newNode.id });

    return newNode;
  },

  _replaceNode: function(nodeId, newStep) {
    var oldNode = this.getNode(nodeId);
    if (!oldNode) return null;

    oldNode.type = newStep.type || oldNode.type;
    oldNode.action = newStep.action || oldNode.action;
    oldNode.description = newStep.description || oldNode.description;
    oldNode.target = newStep.target || oldNode.target;
    oldNode.params = newStep.params || oldNode.params;
    oldNode.status = NodeStatus.PENDING;
    oldNode.retries = 0;
    oldNode.result = null;
    oldNode.startedAt = null;
    oldNode.completedAt = null;

    return oldNode;
  },

  _getNodes: function() {
    return this._nodes.slice();
  },

  _getGoal: function() {
    return this._goal;
  },

  _getStatus: function() {
    return this._status;
  },

  _getId: function() {
    return this._id;
  },

  _getProgress: function() {
    var counts = {};
    counts[NodeStatus.PENDING] = 0;
    counts[NodeStatus.RUNNING] = 0;
    counts[NodeStatus.COMPLETED] = 0;
    counts[NodeStatus.FAILED] = 0;
    counts[NodeStatus.SKIPPED] = 0;

    for (var i = 0; i < this._nodes.length; i++) {
      var s = this._nodes[i].status;
      if (counts.hasOwnProperty(s)) counts[s]++;
    }

    var total = this._nodes.length;
    var done = counts[NodeStatus.COMPLETED] + counts[NodeStatus.SKIPPED];
    var progress = total > 0 ? Math.round((done / total) * 100) : 0;

    return {
      total: total,
      pending: counts[NodeStatus.PENDING],
      running: counts[NodeStatus.RUNNING],
      completed: counts[NodeStatus.COMPLETED],
      failed: counts[NodeStatus.FAILED],
      skipped: counts[NodeStatus.SKIPPED],
      progress: progress,
      status: this._status
    };
  },

  _isComplete: function() {
    return this._status === PlanStatus.COMPLETED;
  },

  _isFailed: function() {
    return this._status === PlanStatus.FAILED;
  },

  _hasPendingNodes: function() {
    for (var i = 0; i < this._nodes.length; i++) {
      if (this._nodes[i].status === NodeStatus.PENDING ||
          this._nodes[i].status === NodeStatus.RUNNING) {
        return true;
      }
    }
    return false;
  },

  _getCompletedResults: function() {
    var results = [];
    for (var i = 0; i < this._nodes.length; i++) {
      if (this._nodes[i].status === NodeStatus.COMPLETED && this._nodes[i].result) {
        results.push({
          id: this._nodes[i].id,
          action: this._nodes[i].action,
          description: this._nodes[i].description,
          result: this._nodes[i].result
        });
      }
    }
    return results;
  },

  _serialize: function() {
    return JSON.stringify({
      id: this._id,
      goal: this._goal,
      nodes: this._nodes,
      edges: this._edges,
      status: this._status,
      createdAt: this._createdAt,
      currentNodeId: this._currentNodeId
    }, null, 2);
  },

  _clear: function() {
    this._id = null;
    this._goal = "";
    this._nodes = [];
    this._edges = [];
    this._status = PlanStatus.PLANNING;
    this._createdAt = null;
    this._currentNodeId = null;
    this._nodeIdCounter = 0;
  },

  _areDependenciesMet: function(node) {
    if (!node.dependencies || node.dependencies.length === 0) return true;

    for (var i = 0; i < node.dependencies.length; i++) {
      var dep = this.getNode(node.dependencies[i]);
      if (!dep) continue;
      if (dep.status === NodeStatus.COMPLETED ||
          dep.status === NodeStatus.SKIPPED ||
          dep.status === NodeStatus.FAILED) {
        continue;
      }
      return false;
    }
    return true;
  },

  _checkNoDuplicate: function(step) {
    var action = step.action;
    var target = step.target;
    if (!action) return true;

    for (var i = 0; i < this._nodes.length; i++) {
      var n = this._nodes[i];
      if (n.action === action && JSON.stringify(n.target) === JSON.stringify(target)) {
        if (n.status === NodeStatus.COMPLETED) return false;
      }
    }
    return true;
  },

  _updatePlanStatus: function() {
    var progress = this.getProgress();

    if (progress.completed + progress.skipped >= progress.total) {
      this._status = PlanStatus.COMPLETED;
    } else if (progress.failed > 0 && progress.pending === 0 && progress.running === 0) {
      if (progress.completed > 0) {
        this._status = PlanStatus.COMPLETED;
      } else {
        this._status = PlanStatus.FAILED;
      }
    } else if (progress.running > 0) {
      this._status = PlanStatus.RUNNING;
    } else if (progress.failed > 0) {
      this._status = PlanStatus.RECOVERING;
    } else if (progress.pending > 0) {
      this._status = PlanStatus.RUNNING;
    }
  }
};
