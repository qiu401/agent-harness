/**
 * LLM 层 —— agent-loop 的"大脑"
 *
 * 这一层只做一件事：接收对话历史，返回一段决策文本。
 * 决策文本是固定格式的 JSON，agent-loop 解析后决定下一步动作：
 *
 *   {"thought":"...", "action":"tool", "tool":"web_search", "args":{...}}
 *   {"thought":"...", "action":"final", "answer":"..."}
 *
 * 这里提供两种实现：
 *   RuleBasedLLM          —— 不依赖任何 API Key，用规则模拟模型决策（默认可用）
 *   OpenAICompatibleLLM   —— 有 Key 时接真实模型（OpenAI / DeepSeek 等兼容接口）
 */

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** 所有模型实现的统一接口 */
export interface LLM {
  /** 模型名称，打印轨迹时显示 */
  readonly name: string;
  /** 输入对话历史，输出决策文本 */
  chat(messages: ChatMessage[]): Promise<string>;
}

/** 从工具观察结果里提取第一条链接（web_search 的输出格式为"链接：xxx"） */
function extractFirstUrl(text: string): string {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const idx = lines[i].indexOf("链接：");
    if (idx !== -1) {
      const url = lines[i].slice(idx + 3).trim();
      if (url.indexOf("http") === 0) return url;
    }
  }
  return "";
}

/** 取正文开头作为摘要，去掉工具名前缀 */
function summarize(observation: string, limit: number): string {
  // 去掉行首的 "[web_fetch] " / "[web_search] " 工具前缀
  let body = observation.replace(/^\[[a-z_]+\]\s*/, "");
  // 去掉工具在末尾追加的 "(已截断，原文共 N 字符)" 提示
  const cut = body.indexOf("...(已截断");
  if (cut !== -1) body = body.slice(0, cut);
  body = body.trim();
  if (body.length <= limit) return body;
  return body.slice(0, limit) + "……（后文省略）";
}

/**
 * 规则式 LLM：用"如果……就……"的规则模拟大模型的决策过程
 * 不需要 API Key，能在任何环境跑通，用来演示 ReAct 循环的形状
 */
export class RuleBasedLLM implements LLM {
  readonly name = "rule-based";

  async chat(messages: ChatMessage[]): Promise<string> {
    // 1. 找到本次任务（最后一条用户消息）
    let task = "";
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        task = messages[i].content;
        break;
      }
    }

    // 2. 收集已有的工具观察
    const observations: string[] = [];
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].role === "tool") observations.push(messages[i].content);
    }

    // 3. 还没有任何资料 —— 先搜索
    if (observations.length === 0) {
      return JSON.stringify({
        thought: "我还没有任何资料，先用 web_search 检索关键词「" + task + "」",
        action: "tool",
        tool: "web_search",
        args: { query: task, limit: 3 },
      });
    }

    // 4. 已有搜索结果但还没抓正文 —— 抓第一条链接
    const searchObs = observations.filter((o) => o.indexOf("[web_search]") === 0);
    const fetchObs = observations.filter((o) => o.indexOf("[web_fetch]") === 0);

    if (searchObs.length > 0 && fetchObs.length === 0) {
      const url = extractFirstUrl(searchObs[0]);
      if (url) {
        return JSON.stringify({
          thought: "搜索结果里第一条链接最相关，用 web_fetch 抓取正文",
          action: "tool",
          tool: "web_fetch",
          args: { url: url },
        });
      }
      return JSON.stringify({
        thought: "搜索结果里没有可用链接，只能依据标题和摘要作答",
        action: "final",
        answer: summarize(searchObs[0], 500),
      });
    }

    // 5. 已经有正文 —— 总结作答
    if (fetchObs.length > 0) {
      return JSON.stringify({
        thought: "已经拿到正文，信息足够，可以给出最终回答",
        action: "final",
        answer: summarize(fetchObs[0], 600),
      });
    }

    // 6. 兜底
    return JSON.stringify({
      thought: "没有可用信息，直接作答",
      action: "final",
      answer: "没有检索到有效内容。",
    });
  }
}

/**
 * OpenAI 兼容接口的 LLM 实现
 * 适用于 OpenAI、DeepSeek、以及任何实现了 /chat/completions 的服务
 * 需要设置环境变量：LLM_API_KEY（必填）、LLM_BASE_URL（可选）、LLM_MODEL（可选）
 */
export class OpenAICompatibleLLM implements LLM {
  readonly name: string;
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private systemPrompt: string;

  constructor(opts: {
    apiKey: string;
    baseUrl?: string;
    model?: string;
    systemPrompt?: string;
  }) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl || "https://api.deepseek.com/v1";
    this.model = opts.model || "deepseek-chat";
    this.name = "openai-compatible:" + this.model;
    this.systemPrompt =
      opts.systemPrompt ||
      [
        "你是一个会使用工具的助手。每一步只能输出一个 JSON 对象，不要输出任何多余文字。",
        '需要调用工具时输出：{"thought":"你的思考","action":"tool","tool":"工具名","args":{参数}}',
        '可以作答时输出：{"thought":"你的思考","action":"final","answer":"最终回答"}',
        "可用工具：web_search（参数 query、limit）、web_fetch（参数 url）。",
        "拿到足够信息后必须输出 final，不要无限调用工具。",
      ].join("\n");
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    // 延迟 require，避免没有配置 Key 时也加载网络库
    const fetch = require("node-fetch");
    const body = {
      model: this.model,
      messages: [{ role: "system", content: this.systemPrompt }].concat(
        messages.map((m) => ({ role: m.role, content: m.content }))
      ),
      temperature: 0,
    };

    const res = await fetch(this.baseUrl.replace(/\/$/, "") + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + this.apiKey,
      },
      body: JSON.stringify(body),
      timeout: 30000,
    });

    if (!res.ok) {
      throw new Error("LLM 请求失败：" + res.status + " " + res.statusText);
    }

    const data = await res.json();
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error("LLM 返回格式异常");
    }
    return data.choices[0].message.content;
  }
}

/** 根据环境变量选择实现：有 LLM_API_KEY 就用真模型，否则退回规则式 */
export function createLLM(): LLM {
  const apiKey = process.env.LLM_API_KEY;
  if (apiKey) {
    return new OpenAICompatibleLLM({
      apiKey: apiKey,
      baseUrl: process.env.LLM_BASE_URL,
      model: process.env.LLM_MODEL,
    });
  }
  return new RuleBasedLLM();
}
