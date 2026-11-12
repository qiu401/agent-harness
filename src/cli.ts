#!/usr/bin/env node
import { Agent } from "./core/agent";
import { getTool, tools, describeTools } from "./core/tools";

const USAGE = `
agent-harness —— dsh 最小 core 的命令行入口

用法：
  node dist/cli.js tools                    列出所有已注册的工具
  node dist/cli.js web-search "关键词" [条数]  调用 web_search 工具
  node dist/cli.js web-fetch <URL>          调用 web_fetch 工具
  node dist/cli.js run "关键词"              串联演示：先搜索，再抓取第一条结果
  node dist/cli.js agent "任务描述"          用最小 core（Agent + ReAct 循环）自主完成任务

示例：
  node dist/cli.js web-search "TypeScript node-fetch 用法" 3
  node dist/cli.js web-fetch https://httpbin.ceshiren.com/get
  node dist/cli.js run "deepseek harness"
  node dist/cli.js agent "搜索 TypeScript node-fetch 的用法并总结"
`.trim();

/** 长文本截断，打印观察结果时用 */
function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + "\n……（共 " + text.length + " 字符，已截断）";
}

function printResult(title: string, ok: boolean, content: string, error?: string): void {
  console.log("");
  console.log("===== " + title + " =====");
  if (ok) {
    console.log(content);
  } else {
    console.log("执行失败：" + (error || "未知错误"));
  }
  console.log("===== 结束 =====");
  console.log("");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") {
    console.log(USAGE);
    return;
  }

  if (cmd === "tools") {
    console.log("已注册工具：" + tools.length + " 个\n");
    console.log(describeTools());
    return;
  }

  if (cmd === "web-search") {
    const query = argv[1];
    if (!query) {
      console.error("缺少关键词，用法：node dist/cli.js web-search \"关键词\" [条数]");
      process.exitCode = 2;
      return;
    }
    const limit = argv[2] ? Number(argv[2]) : 5;
    const tool = getTool("web_search")!;
    console.log(`调用工具 ${tool.name}，参数：query="${query}"，limit=${limit}`);
    const r = await tool.run({ query, limit });
    printResult("web_search 结果", r.ok, r.content, r.error);
    if (!r.ok) process.exitCode = 1;
    return;
  }

  if (cmd === "web-fetch") {
    const url = argv[1];
    if (!url) {
      console.error("缺少 URL，用法：node dist/cli.js web-fetch <URL>");
      process.exitCode = 2;
      return;
    }
    const tool = getTool("web_fetch")!;
    console.log(`调用工具 ${tool.name}，参数：url=${url}`);
    const r = await tool.run({ url });
    printResult("web_fetch 结果", r.ok, r.content, r.error);
    if (!r.ok) process.exitCode = 1;
    return;
  }

  if (cmd === "run") {
    const query = argv[1];
    if (!query) {
      console.error("缺少关键词，用法：node dist/cli.js run \"关键词\"");
      process.exitCode = 2;
      return;
    }

    // 第一步：搜索
    console.log("【第 1 步】调用 web_search");
    const s = await getTool("web_search")!.run({ query, limit: 3 });
    printResult("web_search 结果", s.ok, s.content, s.error);
    if (!s.ok) {
      process.exitCode = 1;
      return;
    }

    // 从搜索结果里取第一条链接
    const firstLine = s.content.split("\n").find((l) => l.includes("链接："));
    const firstUrl = firstLine ? firstLine.split("链接：")[1].trim() : "";
    if (!firstUrl) {
      console.log("未能从搜索结果中提取到链接，流程结束");
      process.exitCode = 1;
      return;
    }

    // 第二步：抓取
    console.log("【第 2 步】调用 web_fetch 抓取第一条结果：" + firstUrl);
    const f = await getTool("web_fetch")!.run({ url: firstUrl });
    printResult("web_fetch 结果", f.ok, f.content, f.error);
    if (!f.ok) {
      process.exitCode = 1;
      return;
    }

    console.log("流程完成：search → fetch 两步调用链验证通过");
    return;
  }

  if (cmd === "agent") {
    const task = argv[1];
    if (!task) {
      console.error("缺少任务描述，用法：node dist/cli.js agent \"任务描述\"");
      process.exitCode = 2;
      return;
    }

    const agent = new Agent();
    console.log("模型：" + agent.llm.name);
    console.log("工具：" + agent.listTools().join(" / "));
    console.log("任务：" + task);

    const r = await agent.run(task);

    for (let i = 0; i < r.steps.length; i++) {
      const s = r.steps[i];
      console.log("");
      console.log("---- 第 " + s.index + " 步 ----");
      console.log("Thought: " + s.thought);
      console.log("Action: " + s.action);
      if (s.action !== "final") {
        console.log("Args: " + s.detail);
        console.log("Observation: " + truncate(s.observation, 300));
      }
    }

    console.log("");
    console.log("===== 最终回答 =====");
    if (r.ok) {
      console.log(r.answer);
    } else {
      console.log("未完成：" + (r.reason || "未知原因"));
      process.exitCode = 1;
    }
    console.log("===== 结束 =====");
    console.log("");
    return;
  }

  console.error("未知命令：" + cmd);
  console.error(USAGE);
  process.exitCode = 2;
}

main().catch((err) => {
  console.error("未捕获异常：", err);
  process.exitCode = 1;
});
