/**
 * Agent —— 对外的统一门面
 *
 * 把三块东西组装在一起：
 *   LLM        —— 大脑（决策）
 *   Session    —— 记忆（对话历史）
 *   AgentLoop  —— 手脚（ReAct 循环 + 工具调用）
 *
 * 外部只需要 new Agent().run("问题")，不用关心内部怎么转。
 */
import { AgentLoop, LoopResult } from "../agent-loop";
import { LLM, createLLM } from "../llm";
import { Session } from "../session";
import { tools } from "../tools";

export interface AgentOptions {
  /** 不传则按环境变量自动选择：有 LLM_API_KEY 用真模型，否则用规则式 */
  llm?: LLM;
  /** 不传则新建一个会话 */
  session?: Session;
  /** 最大循环步数，默认 6 */
  maxSteps?: number;
}

export class Agent {
  readonly llm: LLM;
  readonly session: Session;
  private loop: AgentLoop;

  constructor(opts?: AgentOptions) {
    const o = opts || {};
    this.llm = o.llm || createLLM();
    this.session = o.session || new Session();
    this.loop = new AgentLoop(this.llm, this.session, o.maxSteps);
  }

  /** 执行一次任务 */
  async run(task: string): Promise<LoopResult> {
    return this.loop.run(task);
  }

  /** 当前可用的工具名列表 */
  listTools(): string[] {
    return tools.map((t) => t.name);
  }
}
