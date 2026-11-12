/**
 * Session —— 一次对话的上下文容器
 *
 * agent-loop 每想一步、每调一次工具，都把结果写进 Session；
 * 下一轮再把这些历史整体交给 LLM，模型才能"记得"自己刚才做过什么。
 * 这是 ReAct 循环能连续推进的基础。
 */

/** 消息角色：system 系统提示 / user 用户 / assistant 模型输出 / tool 工具观察结果 */
export type SessionRole = "system" | "user" | "assistant" | "tool";

export interface SessionMessage {
  role: SessionRole;
  content: string;
  /** 写入时间戳，便于排查每一步发生的先后顺序 */
  time: number;
}

export class Session {
  readonly id: string;
  private messages: SessionMessage[] = [];

  constructor(id?: string) {
    this.id = id ? id : "sess-" + Date.now().toString(36);
  }

  /** 追加一条消息 */
  addMessage(role: SessionRole, content: string): SessionMessage {
    const msg: SessionMessage = { role, content, time: Date.now() };
    this.messages.push(msg);
    return msg;
  }

  /** 取出全部历史（返回副本，外部无法直接改动内部数组） */
  getHistory(): SessionMessage[] {
    return this.messages.slice();
  }

  /** 按角色取最近一条，没有则返回 undefined */
  lastOf(role: SessionRole): SessionMessage | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === role) return this.messages[i];
    }
    return undefined;
  }

  /** 统计某个角色出现了几次，用于判断"这一步该不该重复执行" */
  countOf(role: SessionRole): number {
    let n = 0;
    for (let i = 0; i < this.messages.length; i++) {
      if (this.messages[i].role === role) n++;
    }
    return n;
  }

  /** 消息条数 */
  size(): number {
    return this.messages.length;
  }
}
