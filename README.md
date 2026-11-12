# agent-harness —— dsh 最小 core（工具层 + CLI）

## 目录结构

```
agent-harness/
├── package.json
├── tsconfig.json
└── src/
    ├── cli.ts                     # 命令行入口
    └── core/
        ├── agent/index.ts         # 智能体主体（已有，本包不改）
        ├── agent-loop/index.ts    # 推理循环（已有，本包不改）
        ├── llm/index.ts           # 大模型调用（已有，本包不改）
        ├── session/index.ts       # 会话状态（已有，本包不改）
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
```

## 设计要点

1. **统一工具接口**：每个工具都有 `name / description / parameters / run`，`description`
   和 `parameters` 是将来直接喂给大模型做工具选择的元数据。
2. **注册表分发**：`tools/index.ts` 集中注册，`getTool(name)` 按名称取用，
   `describeTools()` 生成给模型看的工具清单。
3. **搜索源容错**：先请求 `cn.bing.com`（国内服务器可达、不需要 API Key），
   解析失败再降级到 DuckDuckGo。
4. **抓取后处理**：去掉 script/style/注释标签，HTML 转纯文本，超长内容截断到 4000 字符，
   避免把整页塞进模型上下文。
