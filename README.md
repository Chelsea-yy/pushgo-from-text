# PushGo · 从材料到活动推送

面向高校社团与学生组织，把简短描述或本地策划案整理成**有来源、可审阅、可换主题的推送草稿**。核心工具、命令行和 Agent Skill 共用一套逻辑，后续再接网页界面，小程序后置。

当前提供本地可运行的第一版工具。支持文本、Markdown、DOCX 和文字型 PDF，提供三套主题，并导出可编辑 HTML、Word、Markdown 和带来源的 JSON。

**秀米导入尚未通过真实平台验收。** 验收目标是导入后能继续修改文本和图片，不要求必须使用秀米原生组件；整篇截图不符合要求。富文本复制和 Word 是待测候选，不能当作已支持秀米/微信的承诺。平台教程、观察和验收步骤分别见 [导入研究](docs/research/xiumi-editable-import.md) 与 [平台验收](docs/acceptance/xiumi-editable.md)。

## 为什么采用“核心 + CLI + Skill”

- **核心模块**负责提取、事实引用、校验和渲染，容易测试，也能被未来网页服务复用。
- **CLI（命令行工具）**使没有特定 Agent 平台的用户也能重复运行完整流程。
- **Agent Skill**负责收集需求、追问缺失信息和人工确认，不把关键能力锁在提示词里。入口为 [SKILL.md](skills/campus-push/SKILL.md)。

项目尚未选择开源许可证，目前可公开审阅代码，不宣称已经按某项开源许可证授权。`private: true` 用于防止误发布到 npm。

## 快速开始

需要 Node.js 22.3 或以上，推荐 Node.js 24。Windows 为当前本地验证环境，GitHub 自动测试覆盖 Node.js 22 和 24。

```powershell
npm ci
npm run check
npm run pushgo -- draft --input "examples/campus-reading.md" --out ".local/demo-campus" --theme campus --style "简洁,温暖"
```

示例全部虚构。先阅读 `.local/demo-campus/review.md`，然后用浏览器打开 `preview.html`。输出目录必须不存在，工具不会覆盖已有目录。

处理自己的策划案：

```powershell
npm run pushgo -- draft --input "raw_data/你的策划案.docx" --out ".local/my-first-draft" --theme formal
```

输入支持 `.txt`、`.md`、`.docx`、`.pdf`，上限 20 MB、150000 个提取字符，PDF 上限 100 页。扫描件不做 OCR；复杂表格、图片、文本框、修订、二维码需要人工核对。材料只读，输出不能放在 `raw_data` 中。

简短文字也可使用 `--text "活动名称：校园交流会"` 替代 `--input`。查看提取及来源定位：

```powershell
npm run pushgo -- inspect --input "raw_data/你的策划案.pdf"
```

`inspect` 会把原文写到终端标准输出，请注意隐私，避免把输出上传到公开日志。

## 生成模式与事实补充

### 离线模式（默认）

按显式字段和少量日期/时间规则摘录事实，保留原文段落与出处，生成待审核模板。它**不是 AI 润色成稿**，不会联网搜索、自动补造信息，也不会读取模型密钥后自行调用。长策划案可能产生较长的原文整理稿，需人工删改。

原文没有的时间、场地、费用、嘉宾等会保持缺失或待定。存在多个候选时提示冲突，保留原文供人确认。补充信息时，请把有依据的内容加入本地材料，再重新运行；不能靠删除提示来消除事实冲突。

### 模型辅助（显式选择）

支持兼容 OpenAI Chat Completions 的接口，不绑定某个厂商或模型。需要在本机安全设置：

- `OPENAI_API_KEY`：自己的密钥，避免写入命令历史、聊天或仓库。
- `OPENAI_MODEL`：明确选择模型，工具不默认选择付费模型。
- `OPENAI_BASE_URL`：可选，默认 `https://api.openai.com/v1`。自定义接口需要支持 JSON 输出；材料和密钥会发送到该地址，请自行确认可信性。

确认允许上传该材料、接受可能费用后，显式运行：

```powershell
npm run pushgo -- draft --input "raw_data/你的策划案.docx" --out ".local/model-draft" --provider openai --theme campus --style "清新,简洁"
```

每次只请求一次，不自动重试、不隐藏降级。接口必须为 HTTPS（本机测试接口可用 loopback HTTP），不跟随重定向。输入超过 40000 个序列化字符会拒绝，不静默截断。返回结果需符合结构、引用真实来源，关键字面信息无出处会拒绝导出。

模型仅根据提供材料改写，当前不提供联网补充或事实真伪判断。自动检查无法证明语义正确，特别是“拟邀/确认”“计划/已发生”的区别，仍需逐段人工审阅。当前模型适配器通过本地模拟接口测试，尚未使用真实付费模型验收。

## 策划案转推送文稿 Skill

写作入口为 [campus-push-writer](skills/campus-push-writer/SKILL.md)，与原有导出排版 Skill 分开。它让当前 Agent 读材料、拆解参考、选择读者主线、写三个标题、审稿并定向修订，不要求另配 API 密钥，也不自动调用付费模型。

已整理 [模块内容与选材](skills/campus-push-writer/references/modules.md)、[审稿规约](skills/campus-push-writer/references/evaluation.md) 和 [完整虚构示范](skills/campus-push-writer/references/fictional-example.md)。每个模块说明读者问题、应写内容、来源选择与常见错误。参考研究覆盖5篇预告、4篇回顾；当前没有可核实的阅读/转发数字，不能声称已经学习到高传播规律。

将公开 Skill 复制到候选的 Cursor 项目级目录：

```powershell
npm run skill:install
```

安装只复制公开 Markdown 到 `.cursor/skills/campus-push-writer/`，不改用户级配置，不复制真实材料；目标已存在就停止，不覆盖本地改动。**本轮未成功读取 Cursor 官方 Skills 文档，也未验证当前客户端的自动发现与重载行为**，所以复制成功仅表示文件就位。可在 Skills 列表自行检查发现状态；当前可靠的使用方式是明确要求 Agent 读取源 `SKILL.md`，不依赖自动发现。仓库 `AGENTS.md` 另提供入口指引，但本轮也未独立验收其自动加载。

可以这样要求当前 Agent：

> 使用 campus-push-writer，把我指定的本地策划案写成活动预告。先核对事实和公开范围，参照已有文稿分析模块，写三个标题，完成审稿与定向修改。正文、标题选项、出处审核和修订记录分开保存到 .local/ 下。历史活动只作练习。

交付 `article.md`、`title-options.md`、`editor-review.md` 和 `revision-log.md`。至少经过首稿、审稿、修订；最多三轮，连续两轮无改善时报告阻塞。内部评分是编辑判断，不是模型训练、阅读量或用户验收。缺少报名资产、公开确认或有效日期时，文稿可审阅但不能自动发布。

**安装 Skill 不改变 CLI 默认离线模式。** 独立命令仍先提取模板；模型适配器不会自动加载这个 Skill，也不会自动完成多轮审稿。`render` 需要 Draft JSON，不能直接读取写作 Skill 的 Markdown。当前阶段的实际检查见 [写作 Skill 验收](docs/acceptance/writing-skill.md)。

## 主题、修改与导出

| 主题 | 用途 |
| --- | --- |
| `campus` | 绿系、校园清新 |
| `formal` | 蓝系、正式简洁 |
| `vibrant` | 暖色、明亮活力 |

`--style` 支持逗号分隔的风格词。离线模式仅记录这些词，模型模式才用它们控制表达；视觉配色与排版由 `--theme` 控制。

每次输出六个文件：

| 文件 | 用途 |
| --- | --- |
| `article.json` | 带原文、事实、引用与问题的可长期编辑草稿 |
| `article.html` | 无脚本、内联样式富文本片段 |
| `preview.html` | 可临时编辑并复制当前正文的本地预览 |
| `article.md` | 方便审阅、再编辑的 Markdown |
| `article.docx` | 可编辑文字段落和列表；图片为人工插入占位 |
| `review.md` | 事实出处、缺失/冲突和人工检查清单 |

修改 `article.json` 的标题、摘要和正文，再运行以下命令更换主题，无需重新调用模型：

```powershell
npm run pushgo -- render --draft ".local/demo-campus/article.json" --out ".local/demo-formal" --theme formal
```

`render` 会重新校验，不会自动把草稿标成审核通过。保留真实来源编号；新增事实需先补来源。离线草稿允许导出带错误提示的审阅候选，因此生成成功不代表可发布。

`preview.html` 可直接修改正文，复制按钮会复制当前编辑内容的富文本和纯文本，操作区不会混入正文。浏览器不允许剪贴板时会选中正文，按 Ctrl+C 手动复制。**预览修改不会回写 JSON，刷新会丢失，也不会更新其他导出文件。** 长期修改应改 JSON 后重新渲染。

图片和二维码需在目标平台重新上传/替换。工具不自动抓图、上传或发布，不保证外链/本地图片粘贴后可用。

## 验证与工程说明

```powershell
npm run check
npm audit --omit=dev
```

测试使用虚构文本、合成 DOCX/PDF 和本地模拟模型服务，不需要真实材料、密钥或秀米账号。覆盖来源校验、缺失/冲突、CLI 全流程、三主题、富文本注入过滤、剪贴板失败分支与 Word 可编辑结构。Windows GitHub Actions 额外验证 Node.js 22/24。

已知依赖风险：`mammoth → argparse → sprintf-js` 存在中等级拒绝服务通告，当前 registry 未提供修复版。本项目仅调用 Mammoth 的文档文字提取 API，不调用其命令行格式化参数路径；仍不能宣称无风险。详见 [依赖与隐私边界](docs/security-and-privacy.md)。CI 阻断高危/严重通告，中等级风险仍记录为待处理。

可选 Excel MCP 验证工具无需安装 Microsoft Excel，使用 [uv](https://docs.astral.sh/uv/) 运行：

```powershell
uv run --with excel-mcp-server==2.2.1 python -m unittest discover -s tests -v
```

只验证本地只读 MCP 和虚构工作簿，不代表 Cursor 工具桥或秀米已打通。配置说明见 [Excel MCP](docs/setup/excel-mcp.md)。

## 后续路线与关键阻塞

1. 在用户登录的秀米中，用虚构样例完成导入、逐项编辑、保存和重开；决定最终交付路径。该环节是当前最关键的外部验收阻塞。
2. 用当前写作 Skill 和真实材料继续收集用户编辑反馈；取得可比阅读/分享证据后再验证传播假设。独立 CLI 的真实模型调用及多轮写作接入仍需单独授权与验收。
3. 完善图片/二维码资产管理和持久化预览编辑；确认许可证后建立可复用的开源发布方式。
4. 在核心与平台导入稳定后接轻量网页，小程序后置。当前没有网页部署或自动发布能力。

## 研究、验收与协作

- [第一阶段接入记录](docs/acceptance/bootstrap.md)（历史记录）
- [本地工具阶段验收](docs/acceptance/editable-mvp.md)
- [原始方案与成稿匿名比较](docs/research/source-comparison.md)
- [参考文章观察](docs/research/sample-analysis.md)
- [旧版原生接口研究](docs/research/xiumi-native-import.md)（历史路线，已不作为开发前置门槛）
- [协作、隐私与 GitHub 同步](docs/contributing.md)

真实策划案、Excel、原文、图片、二维码、凭据、本机配置和生成结果默认只留在 `raw_data/`、`.local/` 等被忽略目录。用户认可参考案例质量不等于允许公开转载。GitHub 仅同步经审查的代码、虚构示例和匿名结论；功能分支与 PR 可以更新，合并 `main` 仍需维护者确认。
