// dsh 最小 core - session 会话模块
export class Session {
  private messages: string[] = [];

  addMessage(text: string): void {
    this.messages.push(text);
  }

  getHistory(): string[] {
    return this.messages;
  }
}
