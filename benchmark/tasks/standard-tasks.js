/**
 * benchmark/tasks/standard-tasks.js — 标准 Benchmark 任务集
 *
 * 10 个标准任务，覆盖：
 *   - 搜索类 (search)
 *   - 导航类 (navigate)
 *   - 提取类 (extract)
 *   - 表单类 (form)
 *   - 多步骤类 (multi_step)
 *
 * 每个任务定义：
 *   - id: 唯一标识
 *   - name: 任务名称
 *   - goal: 传给 Agent 的自然语言目标
 *   - category: 任务类别
 *   - difficulty: easy / medium / hard
 *   - successCriteria: 成功判定条件
 *   - maxSteps: 最大允许步骤数
 *   - timeout: 超时毫秒数
 *   - tags: 标签
 */

var BENCHMARK_TASKS = [

  // ==========================================
  //   Easy (1-3 步)
  // ==========================================

  {
    id: "bing_search_leijun",
    name: "Bing 搜索雷军",
    description: "在 Bing 搜索 '雷军'，提取第一条搜索结果的标题",
    category: "search",
    difficulty: "easy",
    goal: "在 Bing 搜索 '雷军'，并提取第一条搜索结果的标题",
    startUrl: "https://www.bing.com",
    successCriteria: { type: "contains", value: "雷军" },
    minSteps: 3,
    requiredActionTypes: ["input", "extract"],
    bannedStrings: ["失败", "无法", "错误", "error", "failed", "unable"],
    maxSteps: 6,
    timeout: 60000,
    tags: ["bing", "search", "extract"]
  },

  {
    id: "bing_search_leijun_3_results",
    name: "Bing 搜索雷军并提取前3条",
    description: "在 Bing 搜索 '雷军'，提取前3条搜索结果的标题和摘要",
    category: "search",
    difficulty: "easy",
    goal: "在 Bing 搜索 '雷军'，提取前3条搜索结果的标题和摘要",
    startUrl: "https://www.bing.com",
    successCriteria: { type: "contains", value: "雷军" },
    minSteps: 3,
    requiredActionTypes: ["input", "extract"],
    bannedStrings: ["失败", "无法", "错误", "error", "failed", "unable"],
    maxSteps: 8,
    timeout: 90000,
    tags: ["bing", "search", "extract", "multi_result"]
  },

  {
    id: "baidu_search_ai_news",
    name: "百度搜索 AI 新闻",
    description: "在百度搜索 'AI 最新新闻'，提取第一条结果",
    category: "search",
    difficulty: "easy",
    goal: "打开百度，搜索 'AI 最新新闻'，提取第一条搜索结果的标题和链接",
    startUrl: "https://www.baidu.com",
    successCriteria: { type: "contains", value: "AI" },
    minSteps: 3,
    requiredActionTypes: ["input", "extract"],
    bannedStrings: ["失败", "无法", "错误", "error", "failed", "unable"],
    maxSteps: 6,
    timeout: 60000,
    tags: ["baidu", "search", "extract"]
  },

  // ==========================================
  //   Medium (4-8 步)
  // ==========================================

  {
    id: "github_search_browser_agent",
    name: "GitHub 搜索 browser agent",
    description: "在 GitHub 搜索 'browser agent'，提取第一个 repo 的名称和星标数",
    category: "search",
    difficulty: "medium",
    goal: "打开 GitHub，搜索 'browser agent'，提取第一个仓库的名称和星标数量",
    startUrl: "https://github.com",
    successCriteria: { type: "contains", value: "agent" },
    minSteps: 4,
    requiredActionTypes: ["input", "extract"],
    bannedStrings: ["失败", "无法", "错误", "error", "failed", "unable"],
    maxSteps: 8,
    timeout: 90000,
    tags: ["github", "search", "extract"]
  },

  {
    id: "wikipedia_china_population",
    name: "Wikipedia 中国人口",
    description: "在 Wikipedia 搜索 'China'，提取人口数据",
    category: "extract",
    difficulty: "medium",
    goal: "打开 Wikipedia，搜索 'China'，找到并提取中国的人口数据",
    startUrl: "https://en.wikipedia.org",
    successCriteria: { type: "contains", value: "population" },
    minSteps: 4,
    requiredActionTypes: ["input", "extract"],
    bannedStrings: ["失败", "无法", "错误", "error", "failed", "unable"],
    maxSteps: 8,
    timeout: 90000,
    tags: ["wikipedia", "search", "extract"]
  },

  {
    id: "news_site_top_story",
    name: "新闻网站头条提取",
    description: "打开一个新闻网站，提取头条新闻标题",
    category: "extract",
    difficulty: "medium",
    goal: "打开 CNN 网站，提取头条新闻的标题",
    startUrl: "https://www.cnn.com",
    successCriteria: { type: "extracted", field: "text" },
    minSteps: 2,
    requiredActionTypes: ["extract"],
    bannedStrings: ["失败", "无法", "错误", "error", "failed", "unable"],
    maxSteps: 5,
    timeout: 60000,
    tags: ["news", "extract"]
  },

  {
    id: "amazon_search_product",
    name: "Amazon 搜索产品",
    description: "在 Amazon 搜索 'wireless mouse'，提取第一个产品的名称和价格",
    category: "search",
    difficulty: "medium",
    goal: "打开 Amazon，搜索 'wireless mouse'，提取第一个产品的名称和价格",
    startUrl: "https://www.amazon.com",
    successCriteria: { type: "contains", value: "mouse" },
    minSteps: 4,
    requiredActionTypes: ["input", "extract"],
    bannedStrings: ["失败", "无法", "错误", "error", "failed", "unable"],
    maxSteps: 8,
    timeout: 90000,
    tags: ["amazon", "search", "extract"]
  },

  // ==========================================
  //   Hard (9-15 步)
  // ==========================================

  {
    id: "google_translate_input",
    name: "Google 翻译输入",
    description: "打开 Google 翻译，输入文本并获取翻译结果",
    category: "form",
    difficulty: "hard",
    goal: "打开 Google 翻译，在左侧输入框中输入 'Hello World'，然后查看右侧的翻译结果",
    startUrl: "https://translate.google.com",
    successCriteria: { type: "contains", value: "Hello" },
    minSteps: 4,
    requiredActionTypes: ["input"],
    bannedStrings: ["失败", "无法", "错误", "error", "failed", "unable"],
    maxSteps: 10,
    timeout: 120000,
    tags: ["google", "form", "input", "extract"]
  },

  {
    id: "reddit_search_and_extract",
    name: "Reddit 搜索并提取",
    description: "在 Reddit 搜索 'browser automation'，提取第一个帖子的标题和点赞数",
    category: "search",
    difficulty: "hard",
    goal: "打开 Reddit，搜索 'browser automation'，提取第一个帖子的标题和点赞数",
    startUrl: "https://www.reddit.com",
    successCriteria: { type: "contains", value: "browser" },
    minSteps: 4,
    requiredActionTypes: ["input", "extract"],
    bannedStrings: ["失败", "无法", "错误", "error", "failed", "unable"],
    maxSteps: 10,
    timeout: 120000,
    tags: ["reddit", "search", "extract"]
  },

  {
    id: "multi_tab_extract",
    name: "多标签页提取",
    description: "在 Bing 搜索后打开第一个结果，提取页面内容",
    category: "multi_step",
    difficulty: "hard",
    goal: "在 Bing 搜索 'Browser Agent Runtime'，然后打开第一个搜索结果页面，提取该页面的核心内容",
    startUrl: "https://www.bing.com",
    successCriteria: { type: "contains", value: "agent" },
    minSteps: 5,
    requiredActionTypes: ["input", "extract"],
    bannedStrings: ["失败", "无法", "错误", "error", "failed", "unable"],
    maxSteps: 12,
    timeout: 150000,
    tags: ["bing", "search", "navigate", "extract", "multi_step"]
  }
];

window.BENCHMARK_TASKS = BENCHMARK_TASKS;
