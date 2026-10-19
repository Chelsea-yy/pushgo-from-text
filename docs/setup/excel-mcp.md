# Excel MCP 本地接入与验收

## 当前状态（2026-10-19）

已在本机验证 `excel-mcp-server==2.2.1` 的 stdio 服务：

- 能读取真实工作簿、中文内容及单元格范围。
- 独立虚构样例验证了普通网址、单元格超链接属性和 `HYPERLINK` 公式原文。
- 只读工具列表符合允许清单，不包含工作簿写入工具。
- 项目目录外的虚构路径被拒绝，未读取无关私人文件。
- 原工作簿及测试工作簿的读取前后 SHA-256 一致。

本地 MCP 协议验收已通过，**不代表 Cursor 当前会话的调用桥接已刷新成功**。当前会话发现过服务目录，但实际调用返回 `MCP descriptor not found`。必要时在 Cursor 中重新连接 Excel MCP 或重载窗口；最终以真实工具调用成功为准，不把配置保存当成连接通过。

## 环境与配置

无需安装 Microsoft Excel。需要安装 [uv](https://docs.astral.sh/uv/) 并能运行 `uvx`。维护者来源：[Excel MCP Server](https://github.com/haris-musa/excel-mcp-server)。安装任何版本前核实包名及其来源，升级后重新验收。

在 Cursor MCP 配置的 `mcpServers` 下合并下列 `excel` 项，保留其他服务。`WORKBOOK_DIRECTORY` 必须替换成当前机器的项目绝对路径；若桌面客户端无法找到 `uvx`，`command` 使用 `uvx` 的绝对路径。

```json
{
  "mcpServers": {
    "excel": {
      "command": "uvx",
      "args": [
        "excel-mcp-server==2.2.1", "stdio",
        "--allow-dir", "WORKBOOK_DIRECTORY",
        "--read-only", "--max-cells", "2000"
      ],
      "env": {
        "EXCEL_FILES_PATH": "WORKBOOK_DIRECTORY",
        "EXCEL_MCP_READ_ONLY": "1"
      }
    }
  }
}
```

本机现有服务在用户级配置中，因此采用最小修改，不创建同名项目级服务。机器路径及用户配置不纳入 Git。

`EXCEL_FILES_PATH` 显式与允许目录保持一致，避免继承其他目录授权。使用本地 stdio，无需开放 HTTP 端口。不启用宏写入。只读能力不能防止模型把已读内容转发给别的工具，仍须人工审核后续动作。

## 可复现验收

在项目根目录运行（需要包下载网络，首次运行会安装隔离依赖）：

```powershell
uv run --with excel-mcp-server==2.2.1 python scripts/verify_excel_mcp.py --workbook "你的本地表格.xlsx"
```

该命令启动受限的本地 MCP 服务，通过 MCP 客户端实际调用工具，而不是绕过工具直接解析用户表格。它会：

1. 记录输入文件 SHA-256；不保存或修改输入工作簿。
2. 在被 Git 忽略的 `.local/` 下生成独立链接测试文件。
3. 检查工具清单、工作簿元数据、中文、链接和目录拒绝结果。
4. 使用 `mode=formulas` 读取原始公式，不请求公式求值。
5. 读取每张表的 `A1:P80`（有限样本范围，不声称覆盖任意大型表）。
6. 比较哈希并删除本次生成的测试工作簿。
7. 将带真实内容的验收报告保存在 `.local/excel-mcp-acceptance.json`，禁止提交。

若其他表格超出该范围，需分批调整读取范围并逐页检查，不能将截断结果当作完整索引。任何失败退出均不得标记为验收通过；原始文件未改变只证明本次读取行为，不代表未来配置不可能改变。

## 读链接时的区别

- 普通网址：从单元格文本提取。
- 显示为“查看推送”的链接：通过 `describe_sheet` 的 `hyperlinks` 读取目标地址。
- `HYPERLINK`：使用 `read_range` 的公式原文；复杂计算链接不得猜测目标。

本次真实表格使用普通网址；隐藏链接和公式能力来自独立虚构样例测试，不能说原表中存在这些类型。

原表、策划案、完整内容和抓取记录默认只在本地。公开链接的可访问性不等于转载授权。服务不可用时先诊断环境与路径，不要求用户重新手工整理所有材料。
