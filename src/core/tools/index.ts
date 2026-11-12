import { Tool } from "./types";
import { webFetchTool } from "./web-fetch";
import { webSearchTool } from "./web-search";

/** 工具注册表：所有可用工具集中在这里，agent-loop 按名字查找 */
export const tools: Tool[] = [webSearchTool, webFetchTool];

/** 按名称取工具，找不到返回 undefined */
export function getTool(name: string): Tool | undefined {
  return tools.find((t) => t.name === name);
}

/** 生成给大模型看的工具清单文本 */
export function describeTools(): string {
  return tools
    .map((t) => {
      const params = Object.entries(t.parameters)
        .map(([k, v]) => `    ${k}: ${v}`)
        .join("\n");
      return `- ${t.name}: ${t.description}\n  参数:\n${params}`;
    })
    .join("\n\n");
}
