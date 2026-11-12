/**
 * AgentLoop —— 最小 ReAct 循环
 *
 * ReAct = Reason + Act：让模型反复"想一步 → 做一步 → 看结果"，
 * 直到它认为信息足够、给出最终回答为止。这是 dsh 里
 * packages/core/agent-loop 的核心思想，这里做了教学版的最小实现。
 *
 * 一轮循环做四件事：
 *   1. 把 Session 里的历史整理成对话消息，交给 LLM
 *   2. LLM 返回一条决策 JSON（调用工具 或 给出答案）
 *   3. 若决策是调用工具，去工具注册表取出工具、执行、把结果写回 Session
 *   4. 若决策是给答案，结束循环
 */
import { ChatMessage, LLM } from "../llm";
import { Session } from "../session";
import { getTool } from "../tools";

/** 模型输出的决策结构 */
export interface AgentDecision {
  thought: string;
  action: "tool" | "final";
  /** action = tool 时有效 */
  tool?: string;
  args?: Record<string, any>;
  /** action = final 时有效 */
  answer?: string;
}

/** 循环中每一步的记录，方便 CLI 打印完整轨迹 */
export interface LoopStep {
  index: number;
  thought: string;
  /** tool:工具名 或 final */
  action: string;
  /** 工具参数摘要，或最终答案 */
  detail: string;
  /** 工具返回的内容（final 步为空） */
  observation: string;
  ok: boolean;
}

export interface LoopResult {
  ok: boolean;
  answer: string;
  steps: LoopStep[];
  /** 未正常结束时的原因说明 */
  reason?: string;
}

/**
 * 从模型输出中解析决策 JSON
 * 兼容模型不听话、在 JSON 前后加了说明文字或 ```json 代码块的情况
 */
export function parseDecision(text: string): AgentDecision | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  let obj: any;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch (e) {
    return null;
  }
  if (!obj || (obj.action !== "tool" && obj.action !== "final")) return null;

  return {
    thought: String(obj.thought || ""),
    action: obj.action,
    tool: obj.tool ? String(obj.tool) : undefined,
    args: obj.args && typeof obj.args === "object" ? obj.args : {},
    answer: obj.answer !== undefined ? String(obj.answer) : undefined,
  };
}

/** 把工具参数压成一行，打印轨迹时用 */
function briefArgs(args: Record<string, any>): string {
  const keys = Object.keys(args || {});
  if (keys.length === 0) return "{}";
  return keys
    .map((k) => {
      let v = args[k];
      if (typeof v === "string" && v.length > 60) v = v.slice(0, 60) + "...";
      return k + "=" + JSON.stringify(v);
    })
    .join(", ");
}

export class AgentLoop {
  private llm: LLM;
  private session: Session;
  private maxSteps: number;

  constructor(llm: LLM, session: Session, maxSteps?: number) {
    this.llm = llm;
    this.session = session;
    this.maxSteps = maxSteps && maxSteps > 0 ? maxSteps : 6;
  }

  /** 执行一次完整任务，返回答案与轨迹 */
  async run(task: string): Promise<LoopResult> {
    const steps: LoopStep[] = [];
    this.session.addMessage("user", task);

    for (let i = 0; i < this.maxSteps; i++) {
      const history = this.session.getHistory();
      const messages: ChatMessage[] = history.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      // 1. 让模型决定下一步
      const raw = await this.llm.chat(messages);
      this.session.addMessage("assistant", raw);

      const decision = parseDecision(raw);

      // 模型没按格式输出时，把它的输出直接当作最终答案
      if (!decision) {
        steps.push({
          index: i + 1,
          thought: "模型输出不是合法决策 JSON，直接作为答案",
          action: "final",
          detail: raw.slice(0, 200),
          observation: "",
          ok: true,
        });
        return { ok: true, answer: raw.trim(), steps: steps };
      }

      // 2. 模型认为可以作答了
      if (decision.action === "final") {
        const answer = decision.answer || "";
        steps.push({
          index: i + 1,
          thought: decision.thought,
          action: "final",
          detail: answer.slice(0, 200),
          observation: "",
          ok: true,
        });
        return { ok: true, answer: answer, steps: steps };
      }

      // 3. 模型要调用工具
      const toolName = decision.tool || "";
      const tool = getTool(toolName);
      if (!tool) {
        const obs = "工具不存在：" + toolName + "（可用工具：" + this.listToolNames() + "）";
        this.session.addMessage("tool", "[error] " + obs);
        steps.push({
          index: i + 1,
          thought: decision.thought,
          action: "tool:" + toolName,
          detail: briefArgs(decision.args || {}),
          observation: obs,
          ok: false,
        });
        continue;
      }

      const result = await tool.run(decision.args || {});
      const obs = result.ok ? result.content : "执行失败：" + (result.error || "未知错误");

      // 4. 观察结果写回会话，供下一轮参考
      this.session.addMessage("tool", "[" + tool.name + "] " + obs);

      steps.push({
        index: i + 1,
        thought: decision.thought,
        action: "tool:" + tool.name,
        detail: briefArgs(decision.args || {}),
        observation: obs,
        ok: result.ok,
      });
    }

    return {
      ok: false,
      answer: "",
      steps: steps,
      reason: "超过最大步数 " + this.maxSteps + " 仍未得到最终答案",
    };
  }

  private listToolNames(): string {
    const { tools } = require("../tools");
    return tools.map((t: any) => t.name).join(" / ");
  }
}
