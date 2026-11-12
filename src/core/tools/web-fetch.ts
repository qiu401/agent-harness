import fetch from "node-fetch";
import { Tool, ToolResult } from "./types";

/** HTML 转纯文本：去掉脚本、样式、标签，压缩空白 */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export const webFetchTool: Tool = {
  name: "web_fetch",
  description: "抓取指定 URL 的网页内容，并转换为纯文本返回，适合读取网页正文",
  parameters: {
    url: "目标网页的完整地址，例如 https://example.com",
  },
  async run(args: Record<string, any>): Promise<ToolResult> {
    const url: string = args.url;
    if (!url) {
      return { ok: false, content: "", error: "缺少参数 url" };
    }
    if (!/^https?:\/\//i.test(url)) {
      return { ok: false, content: "", error: "url 必须以 http:// 或 https:// 开头" };
    }

    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "agent-harness/1.0" },
        timeout: 15000,
      });

      if (!res.ok) {
        return { ok: false, content: "", error: `HTTP ${res.status} ${res.statusText}` };
      }

      const contentType = res.headers.get("content-type") || "";
      const body = await res.text();

      // JSON 直接返回原文，HTML 转纯文本
      let text: string;
      if (contentType.includes("application/json")) {
        text = body;
      } else {
        text = htmlToText(body);
      }

      // 截断，避免把超长页面整个塞进模型上下文
      const maxLen = 4000;
      if (text.length > maxLen) {
        text = text.slice(0, maxLen) + `\n...(已截断，原文共 ${text.length} 字符)`;
      }

      return { ok: true, content: text };
    } catch (err) {
      return { ok: false, content: "", error: `请求失败：${String(err)}` };
    }
  },
};
