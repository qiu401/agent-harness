import fetch from "node-fetch";
import { Tool, ToolResult } from "./types";

interface SearchItem {
  title: string;
  url: string;
  snippet: string;
}

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0 Safari/537.36";

/** 清理 HTML 实体与标签 */
function clean(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&ensp;/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&#0183;/g, " ")
    .replace(/&#160;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Bing 的 ck/a 跳转链接还原成真实地址 */
function resolveBingUrl(raw: string): string {
  if (!raw.includes("bing.com/ck/a")) return raw;
  const m = raw.match(/[?&]u=([^&]+)/);
  if (!m) return raw;
  let u = m[1];
  if (u.startsWith("a1")) u = u.slice(2);
  try {
    u = u.replace(/-/g, "+").replace(/_/g, "/");
    while (u.length % 4 !== 0) u += "=";
    return Buffer.from(u, "base64").toString("utf-8");
  } catch {
    return raw;
  }
}

/** 主搜索源：cn.bing.com，无需 API Key */
async function searchBing(query: string, limit: number): Promise<SearchItem[]> {
  const url = "https://cn.bing.com/search?q=" + encodeURIComponent(query);
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8" },
    timeout: 15000,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const html = await res.text();
  const blocks = html.split('<li class="b_algo"').slice(1);
  const items: SearchItem[] = [];

  for (const block of blocks) {
    if (items.length >= limit) break;
    const head = block.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!head) continue;

    const snippetMatch =
      block.match(/<p class="[^"]*b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/i) ||
      block.match(/<div class="b_caption"[^>]*>\s*<p[^>]*>([\s\S]*?)<\/p>/i);

    items.push({
      title: clean(head[2]),
      url: resolveBingUrl(head[1].replace(/&amp;/g, "&")),
      snippet: snippetMatch ? clean(snippetMatch[1]) : "",
    });
  }

  return items;
}

/** 备用搜索源：DuckDuckGo HTML 版 */
async function searchDuckDuckGo(query: string, limit: number): Promise<SearchItem[]> {
  const url = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query);
  const res = await fetch(url, { headers: { "User-Agent": UA }, timeout: 15000 });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const html = await res.text();
  const items: SearchItem[] = [];
  const re = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;

  while ((m = re.exec(html)) !== null && items.length < limit) {
    let link = m[1].replace(/&amp;/g, "&");
    const u = link.match(/[?&]uddg=([^&]+)/);
    if (u) {
      try {
        link = decodeURIComponent(u[1]);
      } catch {
        /* 保留原链接 */
      }
    }
    items.push({ title: clean(m[2]), url: link, snippet: "" });
  }
  return items;
}

export const webSearchTool: Tool = {
  name: "web_search",
  description: "根据关键词在网络上检索，返回若干条标题、链接和摘要，适合先搜索再挑网页抓取",
  parameters: {
    query: "要检索的关键词",
    limit: "返回条数，默认 5，最大 10",
  },
  async run(args: Record<string, any>): Promise<ToolResult> {
    const query = String(args.query || "").trim();
    if (!query) {
      return { ok: false, content: "", error: "缺少参数 query" };
    }

    let limit = Number(args.limit);
    if (!limit || limit < 1) limit = 5;
    if (limit > 10) limit = 10;

    const errors: string[] = [];

    // 先试 Bing，失败再试 DuckDuckGo
    let items: SearchItem[] = [];
    try {
      items = await searchBing(query, limit);
    } catch (err) {
      errors.push("bing: " + String(err));
    }

    if (items.length === 0) {
      try {
        items = await searchDuckDuckGo(query, limit);
      } catch (err) {
        errors.push("duckduckgo: " + String(err));
      }
    }

    if (items.length === 0) {
      return {
        ok: false,
        content: "",
        error: "未获取到搜索结果（" + (errors.join("；") || "可能被网络或反爬拦截") + "）",
      };
    }

    const text = items
      .map((it, i) => {
        const lines = [`${i + 1}. ${it.title}`, `   链接：${it.url}`];
        if (it.snippet) lines.push(`   摘要：${it.snippet}`);
        return lines.join("\n");
      })
      .join("\n\n");

    return { ok: true, content: text };
  },
};
