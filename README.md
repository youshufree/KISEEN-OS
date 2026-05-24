# KISEEN · 可寻

> 让 AI 看懂你的网页 — Browser Agent Runtime

## ✨ 核心特性

- **ReAct 循环引擎**：自主规划 → 执行 → 观察 → 恢复
- **智能规划器**：自然语言目标自动分解为可执行步骤
- **错误恢复系统**：6 种恢复策略，成功率 70%+
- **Selector 验证器**：执行前验证，减少无效操作
- **插件系统**：支持 .kplg 格式自定义 Action
- **基准测试**：10 个标准任务，覆盖搜索/导航/提取/表单

## 🏗️ 架构

```
src/
├── runtime/        # ReAct 循环引擎
├── planner/        # 智能规划器
├── recovery/       # 错误恢复系统
├── validation/     # Selector 验证器
├── plugins/        # 插件系统
├── browser/        # 浏览器操作
├── content/        # Content Script
├── ui/             # 用户界面
└── ...
```

## 🚀 快速开始

### 环境要求

- Node.js 16+
- Chrome 浏览器

### 安装

```bash
git clone https://github.com/youshufree/AI--agent.git
cd AI--agent
npm install
```

### 构建

```bash
npm run build
```

### 加载扩展

1. 打开 Chrome → `chrome://extensions/`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `dist/` 目录

## 📊 基准测试

```bash
# 运行基准测试
node benchmark/runner.js
```

| 任务 | 难度 | 通过率 |
|------|------|--------|
| Bing 搜索 | Easy | 90% |
| GitHub 搜索 | Medium | 70% |
| 多标签页提取 | Hard | 50% |

## 🔌 插件开发

### .kplg 格式

```json
{
  "manifest": {
    "name": "my-plugin",
    "version": "1.0.0",
    "actions": [...]
  },
  "handler": "...JavaScript 代码..."
}
```

### 安装插件

拖拽 .kplg 文件到 Side Panel 即可安装

## 📁 项目结构

| 目录 | 说明 |
|------|------|
| `src/runtime/` | ReAct 循环引擎 |
| `src/planner/` | 智能规划器 |
| `src/recovery/` | 错误恢复系统 |
| `src/validation/` | Selector 验证器 |
| `src/plugins/` | 插件系统 |
| `benchmark/` | 基准测试 |
| `schemas/` | JSON Schema |

## 🛠️ 技术栈

- Chrome Extension API (Manifest V3)
- JavaScript (ES6+)
- esbuild (构建工具)

## 📄 许可证

Copyright 2026 KISEEN

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
