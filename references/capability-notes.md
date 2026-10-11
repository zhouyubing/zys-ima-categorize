# ima 能力边界与实证结论（工作笔记）

> 用途：执行本 skill 前了解 ima 的能力边界、ID 体系与已知坑，少走弯路。
> 实证时间：2026-10-11（真实知识库整理案例）。

---

## 一、能力总表

| 操作 | 开放接口（skill / MCP） | ima copilot | ima 客户端 |
| --- | --- | --- | --- |
| 读取 / 搜索 / 浏览 | ✅ | ✅ | ✅ |
| 新增内容到指定文件夹（上传文件 / 导入链接 / 笔记） | ✅ | ✅ | ✅ |
| **移动已有内容到文件夹** | ❌ 无此接口 | ✅（已实证 231/231） | ✅（多选 → 右键「移动到」） |
| 删除 / 重命名 | ❌ | ❌（报告确认） | ✅ |
| 创建文件夹 | ❌ | ❌ | ✅（右键创建） |

**开放接口全量（openapi/wiki/v1，v1.1.10 skill）共 10 个**：create_media、add_knowledge、get_knowledge_base、get_knowledge_list、search_knowledge、search_knowledge_base、get_addable_knowledge_base_list、check_repeated_names、import_urls、get_media_info。

**分工结论**：批量移动类任务 → 交 ima copilot（优先）或人工；编制/核验类任务 → 本 skill 在 WorkBuddy 侧完成。

---

## 二、ID 体系（关键）

| ID | 说明 |
| --- | --- |
| **kb_id（开放平台）** | 加密长串（如 `Ulshp……=`），开放平台/Skill 脚本入参使用；来自 `search_knowledge_base` |
| **kb_id（内部）** | 纯数字（如 `1234567890123456`），MCP 通道返回；两套 ID 指同一库 |
| **media_id** | 条目唯一标识（如 `wechatarticle_……` / `markdown_……` / `folder_……`）；**开放接口与 copilot 侧完全一致**（已验证逐条对应） |
| **folder_id** | 文件夹标识（`folder_` 前缀）；文件夹的 media_id 即其 folder_id |

**实证结论**：

1. media_id **跨迁移稳定**（move 不改变 media_id；迁移前后 264 项集合完全一致）；
2. WorkBuddy 快照数据与 copilot 执行数据可**逐条互认**（作为机器清单依据）；
3. ⚠️ `parent_folder_id` 格式不统一：根目录条目返回纯数字短 ID、子目录条目返回 `folder_` 前缀形式——**不要用它做位置判断**，位置以列表返回的面包屑或自建路径为准。

---

## 三、已知坑（实测）

1. **spawn 子进程 EBUSY**：在 node 脚本中 spawn `ima_api.cjs` 会报 `spawnSync … EBUSY`；正确做法是 `require` 该模块直接调用（`const { imaApi } = require('…/ima_api.cjs')`）——本 skill 脚本已按此实现；
2. **空目录上传被跳过**：本地骨架上传 ima 时，空文件夹不会被带过去（案例：两个二级目录未同步，需客户端补建）；
3. **标题空白差异**：快照标题做"连续空白 → 单空格"归一化后，与库内显示标题 100% 一致；直接比对时注意归一化；
4. **列表接口上限**：`get_knowledge_list` limit ≤ 50（翻页用 next_cursor）；知识库列表搜索 limit ≤ 50；
5. **频控**：错误码 110021 = 请求频控，降低频率重试；
6. **凭证位置**：`~/.config/ima/client_id` 与 `~/.config/ima/api_key`（或环境变量 `IMA_OPENAPI_CLIENTID` / `IMA_OPENAPI_APIKEY`）；凭证缺失时引导用户到 https://ima.qq.com/agent-interface 获取，**不搜索、不伪造**；
7. **ima_api.cjs 定位**：`~/.workbuddy/skills/ima-skills/ima_api.cjs`（本 skill 脚本会自动搜索）；
8. **上传格式白名单（★交接材料必读）**：ima **不支持上传 json 格式文件**。可上传类型（实测）：PDF / Word / PPT / Excel / Markdown / TXT / 图片 / XMind 等。**交接给执行方的材料必须用 `.md`（操作地图）+ `.csv`（机器清单）**；JSON 仅作编制方存档。案例：某次整理中机器清单 json 上传失败，执行方改用 CSV 交叉对齐后精确执行成功（158/158）；
9. **不间断空格（\xa0）**：部分条目标题含 \xa0（下载 / 转载类内容中较常见），与普通空格显示无差但字节不同。**以 media_id 精确匹配执行不受影响**；做标题字符串比对时，建议先归一化 \xa0 → 空格再比。

---

## 四、一致性验证方法（案例复盘）

编制方（WorkBuddy 快照）与执行方（copilot）协作前/后，建议做 ID 级交叉验证，8 项比对（全量、非抽样）：

1. media_id 集合一致性（编制快照 ↔ 执行前快照）；
2. 标题一致性（归一化后逐条）；
3. 路径一致性（`根目录 / A / B` ↔ `(root)/A/B` 无损互转）；
4. 任务三方核对（执行计划 ↔ 双快照：media_id / 标题 / 位置）；
5. 迁移轨迹（每条到达目标目录）；
6. media_id 稳定性（迁移前/后全集合）；
7. 迁移后计数（各目标目录 + 根目录）；
8. 目标区集合一致性。

案例结果：8/8 全过（验证脚本模式可复用于 `scripts/compare_snapshots.cjs` 的思路）。

---

## 五、与人机协作的交接建议

**给执行方（copilot）的交底材料**：

- 操作地图（md，人读版）+ 机器清单（CSV，含 media_id / folder_id）；
- 目标目录一览（含 folder_id）与执行规则（前缀匹配 / 同名消歧 / 跳过回执格式）；
- 明确"全部为移动、不涉及删除"的边界。

**收执行方回执**：

- 执行总结报告（结构参考 templates/migration-report.md）：批次明细、成功/跳过统计、验证结论、差异记录、留档清单；
- 如有留档（迁移前后快照 / 匹配计划 / 执行日志），索取用于编制方独立核验。

**人工客户端操作要点**（如不用 copilot）：

- 批量多选：按住 Ctrl 点选 / 鼠标框选；
- 右键 →「移动到」→ 选择目标文件夹；
- 删除（空壳文件夹、废弃条目）在客户端完成。
