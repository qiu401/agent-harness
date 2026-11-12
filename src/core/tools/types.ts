/**
 * 工具的统一接口定义
 * 每个工具都必须实现 name / description / parameters / run 四部分，
 * 这样 agent-loop 才能把工具列表交给大模型，并按名称分发调用。
 */
export interface ToolResult {
  ok: boolean;
  content: string;
  error?: string;
}

export interface Tool {
  /** 工具名，全局唯一，大模型通过它来选择工具 */
  name: string;
  /** 工具用途说明，写清楚"什么时候该用它" */
  description: string;
  /** 参数说明，key 为参数名，value 为含义 */
  parameters: Record<string, string>;
  /** 真正执行工具的逻辑 */
  run(args: Record<string, any>): Promise<ToolResult>;
}
