#!/usr/bin/env node
// gen_migration_map.cjs — 生成存量迁移「操作地图」(md) + 「机器清单」(json)
//
// 用法：
//   node gen_migration_map.cjs --snapshot <快照CSV> --mapping <mapping.json> --config <config.json> --out <输出目录>
//
// 依据：《操作地图编制规范 v1》（references/operation-map-spec.md）
//   - mapping.json：{ "<media_id>": "<目标代号>", ... }（覆盖全部待迁条目）
//   - config.json ：kb_name / kb_id / date / targets(代号→{name,folder_id,note}) /
//                   target_order? / src_order? / skip? / cleanup_folders? /
//                   exclude_titles? / title_max? / title_cut?
const fs = require('fs');
const path = require('path');
const { parseArgs } = require('util');
const S = require(path.join(__dirname, '_shared.cjs'));

function buildDisplayTitles(items, max, cut) {
  const map = new Map();
  const short = (t, n) => (t.length > max ? t.slice(0, n) + '…' : t);
  for (const it of items) map.set(it.media_id, short(it.title, cut));
  const group = {};
  for (const it of items) {
    const key = map.get(it.media_id);
    (group[key] = group[key] || []).push(it);
  }
  for (const arr of Object.values(group)) {
    if (arr.length < 2) continue;
    for (const it of arr) {
      const full = it.title;
      let done = false;
      for (let n = cut; n <= full.length; n += 10) {
        const cand = short(full, n);
        let unique = true;
        for (const other of items) {
          if (other.media_id === it.media_id) continue;
          if (map.get(other.media_id) === cand) {
            unique = false;
            break;
          }
        }
        if (unique) {
          map.set(it.media_id, cand);
          done = true;
          break;
        }
      }
      if (!done) map.set(it.media_id, full);
    }
  }
  return map;
}

async function main() {
  const { values } = parseArgs({
    options: {
      snapshot: { type: 'string' },
      mapping: { type: 'string' },
      config: { type: 'string' },
      out: { type: 'string' },
    },
  });
  if (!values.snapshot || !values.mapping || !values.config) {
    console.error('用法：--snapshot <CSV> --mapping <mapping.json> --config <config.json> [--out <目录>]');
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(values.config, 'utf8'));
  const mapping = JSON.parse(fs.readFileSync(values.mapping, 'utf8'));
  const rows = S.parseCsv(fs.readFileSync(values.snapshot, 'utf8')).slice(1);

  const items = rows
    .filter((r) => r[2] !== 'FOLDER')
    .map((r) => ({ seq: +r[0], loc: r[1], type: r[2], title: S.normTitle(r[3]), media_id: r[4] }));
  const folders = rows
    .filter((r) => r[2] === 'FOLDER')
    .map((r) => ({ loc: r[1], title: r[3], media_id: r[4] }));

  const kbName = config.kb_name || '知识库';
  const date = config.date || S.todayStr();
  const targets = config.targets || {};
  const excludeTitles = new Set(config.exclude_titles || ['00-README.md']);
  const skipList = config.skip || [];
  const skipIds = new Set(skipList.map((s) => s.media_id));

  // 待迁条目 = 非文件夹 − 排除标题 − skip
  const pending = items.filter((it) => !excludeTitles.has(it.title) && !skipIds.has(it.media_id));

  // ---- 校验 mapping 全覆盖 ----
  const pendingIds = new Set(pending.map((i) => i.media_id));
  const missing = pending.filter((i) => !mapping[i.media_id]);
  if (missing.length) {
    console.error('❌ mapping 缺少以下 ' + missing.length + ' 条（须全覆盖）：');
    missing.slice(0, 30).forEach((m) => console.error('  ' + m.media_id + ' ｜ ' + m.title));
    process.exit(1);
  }
  const extra = Object.keys(mapping).filter((k) => !pendingIds.has(k));
  if (extra.length) {
    console.error('❌ mapping 含 ' + extra.length + ' 条非待迁条目（多余或 media_id 有误）：');
    extra.slice(0, 30).forEach((k) => console.error('  ' + k));
    process.exit(1);
  }
  const validTargets = Object.keys(targets);
  const badTargets = [...new Set(Object.values(mapping))].filter((t) => !validTargets.includes(t));
  if (badTargets.length) {
    console.error('❌ mapping 含未知目标代号：' + badTargets.join(', ') + '（config.targets 中未定义）');
    process.exit(1);
  }
  console.log('✅ 校验通过：待迁 ' + pending.length + ' 条，目标 ' + validTargets.length + ' 个');

  // ---- 分组 ----
  const srcOrder =
    config.src_order ||
    [...new Set(pending.map((i) => i.loc))]; // 默认：按快照出现顺序
  const targetOrder = config.target_order || validTargets;

  const batches = [];
  let no = 0;
  for (const src of srcOrder) {
    const list = pending.filter((it) => it.loc === src);
    if (!list.length) continue;
    for (const tg of targetOrder) {
      const grp = list.filter((it) => mapping[it.media_id] === tg);
      if (!grp.length) continue;
      no++;
      batches.push({ no: String(no).padStart(2, '0'), src, target: tg, items: grp });
    }
  }
  const batchedIds = new Set(batches.flatMap((b) => b.items.map((i) => i.media_id)));
  const unbatched = pending.filter((i) => !batchedIds.has(i.media_id));
  if (unbatched.length) {
    console.error('❌ 以下条目未入批（源位置未列入 src_order）：');
    unbatched.slice(0, 20).forEach((m) => console.error('  ' + m.loc + ' ｜ ' + m.title));
    process.exit(1);
  }

  // ---- 显示标题（截断 + 唯一化）----
  const disp = buildDisplayTitles(
    pending,
    config.title_max || 60,
    config.title_cut || 30
  );

  // ---- 统计 ----
  const countBy = {};
  for (const it of pending) countBy[mapping[it.media_id]] = (countBy[mapping[it.media_id]] || 0) + 1;

  // ---- 生成 md ----
  const md = [];
  const tName = (t) => (targets[t] && targets[t].name) || t;
  md.push('# 「' + kbName + '」存量迁移 · 操作地图');
  md.push('');
  md.push('> 生成：' + date + ' ｜ 覆盖：' + pending.length + ' 条存量' + (skipList.length ? '（另有 ' + skipList.length + ' 条待处理）' : ''));
  md.push('> 用途：交由 ima copilot（或人工）按批次执行「移动」操作 ｜ 全部为「移动」，不涉及删除');
  md.push('> 交接材料：本地图（.md）＋ 机器清单 CSV（.csv）｜ ima 不支持上传 json 格式——JSON 版仅供编制方存档，无需上传');
  md.push('');
  md.push('---');
  md.push('');
  md.push('## 〇、执行说明');
  md.push('');
  md.push('**目标目录**');
  md.push('');
  md.push('| 代号 | 目标目录 | folder_id | 说明 |');
  md.push('| --- | --- | --- | --- |');
  for (const t of targetOrder) {
    const tg = targets[t] || {};
    md.push('| ' + t + ' | ' + (tg.name || t) + ' | ' + (tg.folder_id || '') + ' | ' + (tg.note || '') + ' |');
  }
  md.push('');
  md.push('**执行规则**');
  md.push('');
  md.push('1. 按批次顺序执行；每批操作：在【源位置】中找到下列条目 → 将其**移动**到【目标目录】；');
  md.push('2. 条目以库内显示标题为准；标题含“…”的为超长标题前缀，按前缀匹配；');
  md.push('3. 同名消歧：如遇完全同名条目，以源位置限定或 media_id 为准；');
  md.push('4. 跳过回执格式（如有）：`批次号｜条目标题（或 media_id）｜原因（缺失/多候选/其他）`；');
  md.push('5. 全部批次完成后，处理文末「收尾清单」（含需人工确认项）；');
  md.push('6. **执行回执（必需，请勿省略）**：全部批次完成后，请提供「执行回执」，须包含三项——① 各批次成功 / 跳过数；② 异常条目（按上条格式）；③ 执行后各目标目录的条目计数。回执将用于编制方独立核验。');
  md.push('');
  const statLine = targetOrder
    .filter((t) => countBy[t])
    .map((t) => tName(t) + ' → ' + countBy[t] + ' 条')
    .join(' ｜ ');
  md.push('**去向统计**：' + statLine + (skipList.length ? ' ｜ 待处理 → ' + skipList.length + ' 条' : ''));
  md.push('');
  md.push('**批次总览**：共 ' + batches.length + ' 批。');
  md.push('');
  md.push('---');
  md.push('');
  md.push('## 批次清单');
  md.push('');

  let lastSrc = '';
  for (const b of batches) {
    if (b.src !== lastSrc) {
      const totalHere = items.filter((i) => i.loc === b.src).length;
      const moveHere = pending.filter((i) => i.loc === b.src).length;
      const stayHere = totalHere - moveHere;
      md.push((lastSrc ? '\n---\n' : '') + '## 源位置：' + b.src + '（现存 ' + totalHere + ' 条：' + moveHere + ' 待迁' + (stayHere ? '＋' + stayHere + ' 不动' : '') + '）');
      md.push('');
      lastSrc = b.src;
    }
    const tg = targets[b.target] || {};
    md.push('### 批次 ' + b.no + ' ｜ → ' + b.target + '（' + (tg.name || b.target) + '）｜ ' + b.items.length + ' 条');
    md.push('');
    md.push('将以下 ' + b.items.length + ' 条内容**移动**到「' + (tg.name || b.target) + '」：');
    md.push('');
    b.items.forEach((it, i) => md.push(i + 1 + '. ' + (disp.get(it.media_id) || it.title)));
    md.push('');
  }

  md.push('---');
  md.push('');
  md.push('## 收尾清单（全部批次完成后处理，需人工确认）');
  md.push('');
  if (skipList.length) {
    md.push('**1. 待处理条目（' + skipList.length + ' 条）**：');
    md.push('');
    for (const s of skipList) {
      md.push('- [ ] ' + (s.title || s.media_id) + (s.reason ? '（' + s.reason + '）' : ''));
    }
    md.push('');
  }
  md.push('**' + (skipList.length ? 2 : 1) + '. 旧文件夹清理**——以下文件夹在内容迁移完成后将变为空壳，建议删除（客户端操作）：');
  md.push('');
  for (const f of config.cleanup_folders || []) md.push('- [ ] ' + f);
  md.push('');
  md.push('**' + (skipList.length ? 3 : 2) + '. 结果抽查**——按「去向统计」核对各目标目录条数。');
  md.push('');
  md.push('---');
  md.push('');
  md.push('*操作地图 ｜ 本 skill 自动生成 ｜ 条目与标题取自快照：' + path.basename(values.snapshot) + '*');
  md.push('');

  // ---- 生成机器清单 ----
  const srcIdOf = (src) => {
    if (src === '根目录') return '';
    const f = folders.find((x) => x.loc + ' / ' + x.title === src);
    return f ? f.media_id : '';
  };
  const ledger = {
    kb_id: config.kb_id || '',
    kb_name: kbName,
    generated_at: new Date().toLocaleString('sv-SE'),
    snapshot_file: path.basename(values.snapshot),
    targets: Object.fromEntries(targetOrder.map((t) => [t, { name: (targets[t] || {}).name || t, folder_id: (targets[t] || {}).folder_id || '' }])),
    batches: batches.map((b) => ({
      batch: parseInt(b.no, 10),
      src: b.src,
      src_id: srcIdOf(b.src),
      target: b.target,
      item_count: b.items.length,
      items: b.items.map((it) => ({ media_id: it.media_id, title: it.title })),
    })),
    total_items: pending.length,
  };

  // ---- 机器清单 CSV（交接标准格式：ima 不支持上传 json）----
  const csvRows = [];
  for (const b of batches) {
    const tg = targets[b.target] || {};
    for (const it of b.items) {
      csvRows.push([b.no, b.src, b.target, tg.name || b.target, tg.folder_id || '', it.media_id, it.title]);
    }
  }

  // ---- 写出 ----
  const outDir = values.out || process.cwd();
  fs.mkdirSync(outDir, { recursive: true });
  const base = S.sanitizeFileName(kbName);
  const mapFile = path.join(outDir, base + '-存量迁移-操作地图-' + date + '.md');
  const csvFile = path.join(outDir, base + '-迁移机器清单-' + date + '.csv');
  const jsonFile = path.join(outDir, base + '-迁移机器清单-' + date + '.json');
  fs.writeFileSync(mapFile, md.join('\n'), 'utf8');
  S.writeCsv(csvFile, ['批次', '源位置', '目标代号', '目标目录', 'folder_id', 'media_id', '标题'], csvRows);
  fs.writeFileSync(jsonFile, JSON.stringify(ledger, null, 2), 'utf8');

  console.log('✅ 已生成：');
  console.log('  地图     : ' + mapFile);
  console.log('  清单 CSV : ' + csvFile + '  ← 交接标准格式（可上传 ima）');
  console.log('  清单 JSON: ' + jsonFile + '（编制方存档，勿上传）');
  console.log('  批次     : ' + batches.length + ' 批 ｜ 待迁条目: ' + pending.length);
}

main().catch((e) => {
  console.error('失败：' + e.message);
  process.exit(1);
});
