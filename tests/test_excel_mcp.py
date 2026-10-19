"""Synthetic tests: no real plans, account credentials, or article content."""
import json
from pathlib import Path
import tempfile
import unittest

from openpyxl import Workbook

from scripts.verify_excel_mcp import unpack, verify


class FakeToolResult:
    def __init__(self, payload):
        self.payload = payload

    def model_dump(self, **kwargs):
        return self.payload


class ToolResultCompatibilityTests(unittest.TestCase):
    def test_camel_case_sdk_result(self):
        self.assertEqual(
            unpack(FakeToolResult({"isError": True, "structuredContent": {"test": 1}, "content": []})),
            {"is_error": True, "structured": {"test": 1}, "content": []},
        )

    def test_snake_case_sdk_result(self):
        self.assertEqual(
            unpack(FakeToolResult({"is_error": False, "structured_content": {"test": 1}, "content": []})),
            {"is_error": False, "structured": {"test": 1}, "content": []},
        )


class ExcelMcpIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_synthetic_workbook_acceptance(self):
        with tempfile.TemporaryDirectory(prefix="pushgo-test-") as directory:
            root = Path(directory).resolve()
            source = root / "source.xlsx"
            wb = Workbook()
            wb.active.title = "中文样例"
            wb.active.append(["活动", "推送链接"])
            wb.active.append(["虚构校园活动", "https://example.com/notice"])
            wb.save(source)
            wb.close()
            before = source.read_bytes()
            report = await verify(root, source)
            self.assertEqual(report["status"], "passed")
            self.assertEqual(source.read_bytes(), before)
            self.assertEqual(len(report["checks"]), 9)
            self.assertEqual(report["metadata"]["sheets"][0]["name"], "中文样例")
            stored = json.loads((root / ".local" / "excel-mcp-acceptance.json").read_text(encoding="utf-8"))
            self.assertEqual(stored["status"], "passed")
            self.assertFalse(any(path.is_dir() for path in (root / ".local").glob("excel-mcp-*")))


if __name__ == "__main__":
    unittest.main()
