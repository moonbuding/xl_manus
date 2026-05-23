import type { McpCatalogItem } from "@/types/agent";

export const mcpCatalog: McpCatalogItem[] = [
  {
    id: "filesystem",
    name: "Filesystem",
    description: "读取指定目录、搜索文件和查看文件内容，适合本地资料整理任务。",
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "./"],
    envTemplate: [],
    tags: ["files", "local"],
    safetyNote: "只给需要处理的目录授权，避免把敏感目录暴露给 Agent。"
  },
  {
    id: "github",
    name: "GitHub",
    description: "读取仓库、Issue 和 Pull Request，用于代码库调研与项目管理。",
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    envTemplate: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
    tags: ["code", "repo"],
    safetyNote: "建议使用最小权限 token，并避免授予写权限。"
  },
  {
    id: "slack",
    name: "Slack",
    description: "搜索频道消息和团队知识，用于会议纪要、上下文检索和协作分析。",
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-slack"],
    envTemplate: ["SLACK_BOT_TOKEN", "SLACK_TEAM_ID"],
    tags: ["team", "chat"],
    safetyNote: "只接入必要 workspace，并在 Slack 后台限制 bot 可访问频道。"
  },
  {
    id: "notion",
    name: "Notion",
    description: "搜索和读取 Notion 页面，用于知识库问答、项目资料整理和报告生成。",
    type: "stdio",
    command: "npx",
    args: ["-y", "@notionhq/notion-mcp-server"],
    envTemplate: ["NOTION_API_KEY"],
    tags: ["docs", "knowledge"],
    safetyNote: "只把集成授权给需要读取的页面或数据库。"
  },
  {
    id: "mock-stdio",
    name: "Mock Echo",
    description: "本地开发诊断 MCP，提供 echo_context 和 list_directory 等模拟工具。",
    type: "stdio",
    command: "node",
    args: ["scripts/mock-mcp-stdio.mjs"],
    envTemplate: [],
    tags: ["local-test", "diagnostic"],
    safetyNote: "仅用于本地验收，不连接第三方服务。"
  }
];

export function listMcpCatalog() {
  return mcpCatalog;
}
