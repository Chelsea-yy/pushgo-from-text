"""Local acceptance test for excel-mcp-server; never saves the input workbook.

Run with: uv run --with excel-mcp-server==2.2.1 python scripts/verify_excel_mcp.py
Private reports and synthetic fixtures stay in ignored .local/.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from openpyxl import Workbook


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def unpack(result):
    payload = result.model_dump(mode="json", by_alias=True)
    return {
        "is_error": bool(payload.get("isError", payload.get("is_error", False))),
        "structured": payload.get("structuredContent", payload.get("structured_content")),
        "content": payload.get("content", []),
    }


async def verify(root: Path, source: Path) -> dict:
    before = digest(source)
    local = root / ".local"
    local.mkdir(exist_ok=True)
    report = {"server_version": "2.2.1", "source_sha256_before": before, "calls": {}}
    fixture_dir = Path(tempfile.mkdtemp(prefix="excel-mcp-", dir=local))
    fixture = fixture_dir / "links.xlsx"
    wb = Workbook()
    ws = wb.active
    ws.title = "链接验证"
    ws.append(["类型", "示例"])
    ws.append(["普通网址", "https://example.com/plain"])
    ws.append(["单元格超链接", "查看推送"])
    ws["B3"].hyperlink = "https://example.com/hyperlink"
    ws.append(["超链接公式", '=HYPERLINK("https://example.com/formula","公式链接")'])
    wb.save(fixture)
    wb.close()
    fixture_before = digest(fixture)
    env = dict(os.environ)
    env.update(EXCEL_FILES_PATH=str(root), EXCEL_MCP_READ_ONLY="1")
    server = StdioServerParameters(
        command=shutil.which("uvx") or "uvx",
        args=["excel-mcp-server==2.2.1", "stdio", "--read-only",
              "--allow-dir", str(root), "--max-cells", "2000"],
        env=env,
    )
    try:
        async with stdio_client(server) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                tools = await session.list_tools()
                names = [tool.name for tool in tools.tools]
                report["tools"] = names
                safe_tools = {"describe_workbook", "describe_sheet", "read_range",
                              "list_workbooks", "export_workbook", "find_cells", "read_vba",
                              "trace_formula"}
                assert set(names) <= safe_tools, f"Unexpected tools: {set(names) - safe_tools}"
                for key, tool, args in [
                    ("workbook", "describe_workbook", {"path": str(source)}),
                    ("fixture_sheet", "describe_sheet", {"path": str(fixture), "sheet": "链接验证"}),
                    ("fixture_formulas", "read_range", {"path": str(fixture), "sheet": "链接验证", "range": "A1:B4", "mode": "formulas"}),
                ]:
                    result = await session.call_tool(tool, args)
                    report["calls"][key] = unpack(result)
                    assert not report["calls"][key]["is_error"], f"{key} failed: {report['calls'][key]}"
                fixture_sheet = json.dumps(report["calls"]["fixture_sheet"], ensure_ascii=False)
                fixture_rows = json.dumps(report["calls"]["fixture_formulas"], ensure_ascii=False)
                assert "https://example.com/hyperlink" in fixture_sheet
                assert "https://example.com/formula" in fixture_rows
                assert "https://example.com/plain" in fixture_rows
                assert "查看推送" in fixture_rows
                # A nonexistent sibling outside the project tests the boundary without reading private files.
                outside = root.parent / "pushgo-boundary-probe-nonexistent.xlsx"
                denied = await session.call_tool("describe_workbook", {"path": str(outside)})
                report["calls"]["outside_directory"] = unpack(denied)
                denial = json.dumps(report["calls"]["outside_directory"]).lower()
                assert report["calls"]["outside_directory"]["is_error"] and ("outside" in denial or "allowed" in denial), denial
                # Obtain sheet names from structured metadata, or the tool's JSON text.
                meta = report["calls"]["workbook"]["structured"]
                if meta is None:
                    meta = json.loads(next(item["text"] for item in report["calls"]["workbook"]["content"] if item["type"] == "text"))
                report["metadata"] = meta
                sheets = meta.get("sheets", {})
                if isinstance(sheets, dict):
                    sheet_names = list(sheets)
                else:
                    sheet_names = [sheet if isinstance(sheet, str) else sheet.get("name", sheet.get("title")) for sheet in sheets]
                assert sheet_names and all(sheet_names), f"Unsupported sheets metadata: {meta}"
                report["sheets"] = []
                for name in sheet_names:
                    details = unpack(await session.call_tool("describe_sheet", {"path": str(source), "sheet": name}))
                    rows = unpack(await session.call_tool("read_range", {"path": str(source), "sheet": name, "range": "A1:P80", "mode": "formulas", "max_cells": 1280}))
                    assert not details["is_error"] and not rows["is_error"]
                    report["sheets"].append({"name": name, "details": details, "rows": rows})
        report["source_sha256_after"] = digest(source)
        report["fixture_sha256_after"] = digest(fixture)
        assert before == report["source_sha256_after"], "Source workbook changed"
        assert fixture_before == report["fixture_sha256_after"], "Fixture changed during reads"
        report["status"] = "passed"
        report["checks"] = ["readonly_tool_allowlist", "directory_boundary", "plain_url", "hyperlink_attribute", "hyperlink_formula_raw", "chinese_text", "real_workbook_reads", "source_unchanged", "fixture_unchanged"]
    except Exception as exc:
        report["status"] = "failed"
        report["error"] = str(exc)
        raise
    finally:
        report["source_sha256_after"] = digest(source)
        output = local / "excel-mcp-acceptance.json"
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        shutil.rmtree(fixture_dir)
        print(json.dumps({"status": report.get("status"), "report": str(output), "source_unchanged": before == report["source_sha256_after"], "error": report.get("error")}, ensure_ascii=False))
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--workbook", type=Path)
    args = parser.parse_args()
    root = args.root.resolve()
    source = (args.workbook or root / "方案推送对接.xlsx").resolve()
    if not source.is_relative_to(root):
        parser.error("Workbook must be inside --root")
    asyncio.run(verify(root, source))
