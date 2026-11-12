# agent-harness —— dsh 最小 core 实现

对照官方 `deepseek-harness` 的 `packages/core` 结构，用 TypeScript 实现的最小可运行版本：
**agent（门面）+ agent-loop（ReAct 循环）+ llm（决策）+ session（上下文）+ tools（工具层）+ CLI**。

## 目录结构

```
agent-harness/
├── package.json
├── tsconfig.json
└── src/
    ├── cli.ts                     # 命令行入口
    └── core/
        ├── agent/index.ts         # Agent 门面：组装 LLM + Session + AgentLoop
        ├── agent-loop/index.ts    # 最小 ReAct 循环：思考 → 调工具 → 观察 → 再思考
        ├── llm/index.ts           # LLM 层：规则式 / OpenAI 兼容两种实现
        ├── session/index.ts       # 会话上下文：消息历史
        └── tools/
            ├── types.ts           # Tool / ToolResult 接口定义
            ├── web-search.ts      # web_search 工具（Bing，备用 DuckDuckGo）
            ├── web-fetch.ts       # web_fetch 工具（抓取网页转纯文本）
            └── index.ts           # 工具注册表
```

## 安装与编译

```bash
cd ~/agent-harness
npm install
./node_modules/.bin/tsc --outDir dist
```

## 命令

```bash
# 列出所有已注册工具
node dist/cli.js tools

# 搜索（默认 5 条，最多 10 条）
node dist/cli.js web-search "TypeScript node-fetch 用法" 3

# 抓取单个网页
node dist/cli.js web-fetch https://httpbin.ceshiren.com/get

# 串联演示：先搜索，再抓取第一条结果
node dist/cli.js run "deepseek harness"

# 完整最小 core：Agent 自主决定调用哪个工具，直到得出答案
node dist/cli.js agent "TypeScript node-fetch 用法"
```

## 各模块职责

| 模块 | 职责 |
|---|---|
| `agent` | 对外门面，把 LLM、Session、AgentLoop 组装起来，暴露 `run(task)` |
| `agent-loop` | ReAct 循环：把会话历史交给 LLM → 解析决策 JSON → 执行工具 → 结果写回会话 → 下一轮 |
| `llm` | 只做一件事：输入对话历史，输出决策文本（`{action:"tool"...}` 或 `{action:"final"...}`） |
| `session` | 保存每一轮的 user / assistant / tool 消息，是循环能连续推进的记忆基础 |
| `tools` | 统一接口的工具注册表，按名称分发调用 |

## 两种 LLM 模式

- **规则式（默认）**：不需要 API Key。用“没有资料 → 先搜索；有搜索结果 → 抓第一条正文；
  有正文 → 总结”的规则模拟模型决策，用来演示 ReAct 循环的形状。
- **OpenAI 兼容（可选）**：设置环境变量后自动切换到真实模型。

```bash
export LLM_API_KEY=你的key
export LLM_BASE_URL=https://api.deepseek.com/v1   # 可选
export LLM_MODEL=deepseek-chat                    # 可选
node dist/cli.js agent "搜索 TypeScript 的用法并总结"
```

## 设计要点

1. **统一工具接口**：每个工具都有 `name / description / parameters / run`，
   `description` 和 `parameters` 就是喂给大模型做工具选择的元数据。
2. **注册表分发**：`tools/index.ts` 集中注册，`getTool(name)` 按名称取用，
   `describeTools()` 生成给模型看的工具清单。
3. **搜索源容错**：先请求 `cn.bing.com`（国内服务器可达、不需要 API Key），
   解析失败再降级到 DuckDuckGo。
4. **抓取后处理**：去掉 script/style/注释标签，HTML 转纯文本，超长内容截断到 4000 字符，
   避免把整页塞进模型上下文。
5. **决策容错**：模型输出前后带解释文字或 ```json 代码块也能解析；解析失败时直接当答案返回，
   不会让循环卡死。
6. **步数上限**：默认 6 步，防止模型反复调工具不收敛。
