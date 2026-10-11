#!/usr/bin/env node
// export_kb_snapshot.cjs — 导出 ima 知识库全量快照（只读；含 media_id）
//
// 用法：
//   node export_kb_snapshot.cjs --kb "库名" [--tag 迁移前] [--out <目录>]
//   node export_kb_snapshot.cjs --kb-id "<加密ID>" [--kb-name "库名"] [--tag ...] [--out ...]
//
// 输出：{out}/{库名}-全量清单-{YYYYMMDD}{-tag}.csv
//   列：序号,位置,类型,标题,media_id（文件夹行 type=FOLDER，其 media_id 即 folder_id）
//
// 依赖：腾讯ima 技能包（ima-skills）之 ima_api.cjs + 已配置凭证
const fs = require('fs');
const path = require('path');
const { parseArgs } = require('util');
const S = require(path.join(__dirname, '_shared.cjs'));

async function main() {
  const { values } = parseArgs({
    options: {
      kb: { type: 'string' },
      'kb-id': { type: 'string' },
      'kb-name': { type: 'string' },
      out: { type: 'string' },
      tag: { type: 'string' },
    },
  });

  const imaApi = S.loadImaApi();
  const call = async (apiPath, body) => {
    const respText = await imaApi('openapi/wiki/v1/' + apiPath, body);
    const j = JSON.parse(respText);
    if (j.code !== 0) throw new Error(apiPath + ' 失败：' + j.msg);
    return j.data;
  };

  // ---------- 1. 解析知识库 ----------
  let kbId = values['kb-id'] || '';
  let kbName = values['kb-name'] || values.kb || '';
  if (!kbId) {
    if (!values.kb) {
      console.error('用法：--kb "库名" 或 --kb-id "<加密ID>"（后者可配 --kb-name 用于命名）');
      process.exit(1);
    }
    const d = await call('search_knowledge_base', { query: values.kb, cursor: '', limit: 20 });
    const list = d.info_list || [];
    const hits = list.filter((x) => (x.kb_name || x.name || '') === values.kb);
    if (hits.length === 0) {
      const fuzzy = list
        .filter((x) => (x.kb_name || x.name || '').includes(values.kb))
        .map((x) => (x.kb_name || x.name) + '（' + (x.kb_id || x.id) + '）');
      console.error('未找到名为「' + values.kb + '」的知识库。' + (fuzzy.length ? '包含匹配：\n  ' + fuzzy.join('\n  ') : ''));
      process.exit(1);
    }
    if (hits.length > 1) {
      console.error('找到多个同名知识库，请用 --kb-id 明确指定（推荐选"创建者=本人、角色=创建者"的那个）：');
      hits.forEach((x) =>
        console.error(
          '  ' +
            (x.kb_id || x.id) +
            ' ｜ 创建者: ' +
            (x.creator || '-') +
            ' ｜ 角色: ' +
            (x.role_type || '-') +
            ' ｜ 条目数: ' +
            (x.content_count || '-')
        )
      );
      process.exit(1);
    }
    kbId = hits[0].kb_id || hits[0].id;
    kbName = kbName || hits[0].kb_name || hits[0].name || '知识库';
  }
  if (!kbName) kbName = '知识库';

  // ---------- 2. 递归遍历 ----------
  const listFolder = async (folderId) => {
    let cursor = '';
    const all = [];
    for (let i = 0; i < 50; i++) {
      const body = { knowledge_base_id: kbId, cursor, limit: 50 };
      if (folderId) body.folder_id = folderId;
      const d = await call('get_knowledge_list', body);
      all.push(...(d.knowledge_list || []));
      if (d.is_end) break;
      cursor = d.next_cursor;
    }
    return all;
  };

  const rows = [];
  let itemCount = 0;
  let folderCount = 0;
  let seq = 0;
  const walk = async (folderId, loc, depth) => {
    if (depth > 5) return;
    const items = await listFolder(folderId);
    for (const it of items) {
      seq++;
      if (it.media_type === 99) {
        folderCount++;
        rows.push([seq, loc, 'FOLDER', it.title || '', it.media_id]);
      } else {
        itemCount++;
        rows.push([seq, loc, 'mt' + it.media_type, S.normTitle(it.title), it.media_id]);
      }
    }
    for (const it of items) {
      if (it.media_type === 99) {
        await walk(it.media_id, loc + ' / ' + (it.title || ''), depth + 1);
      }
    }
  };

  console.log('开始遍历「' + kbName + '」…');
  await walk(null, '根目录', 0);

  // ---------- 3. 输出 ----------
  const outDir = values.out || process.cwd();
  fs.mkdirSync(outDir, { recursive: true });
  const tag = values.tag ? '-' + values.tag : '';
  const fileName = S.sanitizeFileName(kbName) + '-全量清单-' + S.todayStr() + tag + '.csv';
  const outFile = path.join(outDir, fileName);
  S.writeCsv(outFile, ['序号', '位置', '类型', '标题', 'media_id'], rows);

  // 统计
  const byLoc = {};
  for (const r of rows) {
    if (r[2] === 'FOLDER') continue;
    byLoc[r[1]] = (byLoc[r[1]] || 0) + 1;
  }
  console.log('=== 完成 ===');
  console.log('内容条目: ' + itemCount + ' ｜ 文件夹: ' + folderCount);
  console.log('--- 各位置条目数 ---');
  for (const [k, v] of Object.entries(byLoc)) console.log(String(v).padStart(4) + ' │ ' + k);
  console.log('CSV: ' + outFile);
}

main().catch((e) => {
  console.error('失败：' + e.message);
  process.exit(1);
});
