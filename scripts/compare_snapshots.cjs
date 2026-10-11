#!/usr/bin/env node
// compare_snapshots.cjs — 迁移前后快照比对（守恒核验）
//
// 用法：
//   node compare_snapshots.cjs --before <迁移前CSV> --after <迁移后CSV> [--expect <期望JSON>] [--out <报告md>]
//
// 期望 JSON（可选）：{ "根目录 / 01-行业趋势与研究": 49, ... }（位置全称 → 期望条数）
// 输出：① 集合比对（丢失/新增）② 位置变化统计 ③ after 各位置计数 ④ 期望核对
const fs = require('fs');
const path = require('path');
const { parseArgs } = require('util');
const S = require(path.join(__dirname, '_shared.cjs'));

function readItems(file) {
  const rows = S.parseCsv(fs.readFileSync(file, 'utf8')).slice(1);
  return rows
    .filter((r) => r[2] !== 'FOLDER')
    .map((r) => ({ loc: r[1], title: S.normTitle(r[3]), media_id: r[4] }));
}

async function main() {
  const { values } = parseArgs({
    options: {
      before: { type: 'string' },
      after: { type: 'string' },
      expect: { type: 'string' },
      out: { type: 'string' },
    },
  });
  if (!values.before || !values.after) {
    console.error('用法：--before <迁移前CSV> --after <迁移后CSV> [--expect <期望JSON>] [--out <报告md>]');
    process.exit(1);
  }

  const B = readItems(values.before);
  const A = readItems(values.after);
  const bMap = new Map(B.map((i) => [i.media_id, i]));
  const aMap = new Map(A.map((i) => [i.media_id, i]));

  const out = [];
  const log = (s) => {
    console.log(s);
    out.push(s);
  };

  log('===== 快照比对（迁移前 ↔ 迁移后） =====');
  log('迁移前: ' + B.length + ' 条 ｜ 迁移后: ' + A.length + ' 条');
  log('');

  // 1) 集合比对
  const onlyB = B.filter((i) => !aMap.has(i.media_id));
  const onlyA = A.filter((i) => !bMap.has(i.media_id));
  log('[1] 集合比对');
  log((onlyB.length === 0 ? '✅' : '❌') + ' 丢失（仅迁移前有）: ' + onlyB.length);
  onlyB.slice(0, 20).forEach((i) => log('    - ' + i.loc + ' ｜ ' + i.title));
  log((onlyA.length === 0 ? '✅' : '❌') + ' 新增（仅迁移后有）: ' + onlyA.length);
  onlyA.slice(0, 20).forEach((i) => log('    + ' + i.loc + ' ｜ ' + i.title));

  // 2) 位置变化
  const moved = [];
  const unmoved = [];
  for (const i of B) {
    const a = aMap.get(i.media_id);
    if (!a) continue;
    if (a.loc !== i.loc) moved.push({ from: i.loc, to: a.loc, title: i.title });
    else unmoved.push(i);
  }
  log('');
  log('[2] 位置变化');
  log('已移动: ' + moved.length + ' 条');
  log('未移动: ' + unmoved.length + ' 条（含本就保留的 README 等）');
  unmoved.slice(0, 20).forEach((i) => log('    · ' + i.loc + ' ｜ ' + i.title));
  if (unmoved.length > 20) log('    …（其余 ' + (unmoved.length - 20) + ' 条略）');

  // 3) after 位置计数
  log('');
  log('[3] 迁移后各位置条目数');
  const byLoc = {};
  for (const i of A) byLoc[i.loc] = (byLoc[i.loc] || 0) + 1;
  const locs = Object.keys(byLoc).sort();
  for (const l of locs) log('    ' + String(byLoc[l]).padStart(4) + ' │ ' + l);

  // 4) 期望核对
  if (values.expect) {
    const expect = JSON.parse(fs.readFileSync(values.expect, 'utf8'));
    log('');
    log('[4] 期望核对');
    let allOk = true;
    for (const [loc, n] of Object.entries(expect)) {
      const actual = byLoc[loc] || 0;
      const ok = actual === n;
      if (!ok) allOk = false;
      log((ok ? '✅' : '❌') + ' ' + loc + '：期望 ' + n + '，实际 ' + actual);
    }
    log(allOk ? '✅ 期望全部吻合' : '❌ 存在不吻合项（见上）');
  }

  log('');
  log('===== 守恒自查 =====');
  log('① 总量不变：迁移前 ' + B.length + ' ✕ 迁移后 ' + A.length + (B.length === A.length ? ' ✅' : '（差异见 [1]）'));
  log('② 各目标数 = 去向统计：请对照操作地图「去向统计」核对 [3]');
  log('③ 源位置清零：请检查源位置在 [3] 中是否已清零/仅余保留项');

  if (values.out) {
    fs.writeFileSync(values.out, '# 快照比对报告\n\n```\n' + out.join('\n') + '\n```\n', 'utf8');
    console.log('\n报告已存：' + values.out);
  }
}

main().catch((e) => {
  console.error('失败：' + e.message);
  process.exit(1);
});
