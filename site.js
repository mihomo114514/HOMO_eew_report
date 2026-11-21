// HOMO_eew 推算紀錄網站：讀 data/ 的 JSON（HOMO_eew 程式上傳），列出事件、和中央氣象署對照、每一報。不用任何外部函式庫。
// 資料：data/years.json = ["2026", …]；data/{年}/index.json = 事件摘要陣列；data/{年}/{事件代號}.json = 事件記錄（homo-sidecar records.rs）

const TZ_OFFSET_MS = 8 * 3600 * 1000;
const pad = (n) => String(n).padStart(2, '0');
// 台灣時間 YYYY/MM/DD HH:MM:SS
function fmtTime(ms) {
  if (!Number.isFinite(ms)) return '—';
  const d = new Date(ms + TZ_OFFSET_MS);
  return `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
function km(lat1, lng1, lat2, lng2) {
  const r = Math.PI / 180;
  const x = Math.sin((lat2 - lat1) * r / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lng2 - lng1) * r / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(x));
}
const fix = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—');
async function getJson(path) {
  const r = await fetch(path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${path}：HTTP ${r.status}`);
  return r.json();
}
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v);
  }
  for (const c of children) if (c != null) e.append(c);
  return e;
}
const SVG = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}) {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}
function niceTicks(min, max, count = 5) {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

// 單一序列折線圖：points = [{x, y, low, label}]；truth = 真值（水平虛線）或 null
function lineChart(host, { points, truth, truthLabel, refClass = 'truth-line', yUnit, yMin, yFloorSpan = 1, xUnit = 's' }) {
  host.replaceChildren();
  const pts = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!pts.length) {
    host.append(el('div', { class: 'empty', text: '沒有資料' }));
    return;
  }
  const W = 520; const H = 230; const m = { l: 40, r: 56, t: 12, b: 30 };
  const xs = pts.map((p) => p.x); const ys = pts.map((p) => p.y).concat(Number.isFinite(truth) ? [truth] : []);
  const x0 = Math.min(0, ...xs); const x1 = Math.max(...xs, x0 + 1);
  let y0 = Math.min(...ys); let y1 = Math.max(...ys);
  if (Number.isFinite(yMin)) y0 = Math.min(yMin, y0);
  if (y1 - y0 < yFloorSpan) { const c = (y0 + y1) / 2; y0 = Number.isFinite(yMin) ? Math.max(yMin, c - yFloorSpan / 2) : c - yFloorSpan / 2; y1 = y0 + yFloorSpan; }
  const padY = (y1 - y0) * 0.08; y1 += padY; if (!Number.isFinite(yMin) || y0 - padY >= yMin) y0 -= padY;
  const X = (v) => m.l + (v - x0) / (x1 - x0) * (W - m.l - m.r);
  const Y = (v) => H - m.b - (v - y0) / (y1 - y0) * (H - m.t - m.b);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  const grid = svg('g', { class: 'grid' }); const axis = svg('g', { class: 'axis' });
  for (const t of niceTicks(y0, y1)) {
    grid.append(svg('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t) }));
    const tx = svg('text', { x: m.l - 6, y: Y(t) + 4, 'text-anchor': 'end' }); tx.textContent = `${+t.toFixed(2)}`; axis.append(tx);
  }
  for (const t of niceTicks(x0, x1, 6)) {
    const tx = svg('text', { x: X(t), y: H - m.b + 16, 'text-anchor': 'middle' }); tx.textContent = `${+t.toFixed(1)}`; axis.append(tx);
  }
  const xl = svg('text', { x: W - m.r, y: H - 2, 'text-anchor': 'end' }); xl.textContent = `第一個觸發後（${xUnit}）`; axis.append(xl);
  const yl = svg('text', { x: m.l - 6, y: m.t - 2, 'text-anchor': 'end' }); yl.textContent = yUnit; axis.append(yl);
  root.append(grid, axis);
  if (Number.isFinite(truth)) {
    root.append(svg('line', { class: refClass, x1: m.l, x2: W - m.r, y1: Y(truth), y2: Y(truth) }));
    const t = svg('text', { class: 'truth-label', x: W - m.r + 4, y: Y(truth) + 4 }); t.textContent = truthLabel; root.append(t);
  }
  root.append(svg('path', { class: 'series-line', d: pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join('') }));
  for (const p of pts) root.append(svg('circle', { class: `series-dot${p.low ? ' low' : ''}`, cx: X(p.x), cy: Y(p.y), r: 4 }));
  // 最後一點直接標數值
  const last = pts[pts.length - 1];
  const end = svg('text', { class: 'end-label', x: X(last.x) + 7, y: Y(last.y) - 7 }); end.textContent = `${+last.y.toFixed(1)}`;
  if (!Number.isFinite(truth) || Math.abs(Y(last.y) - Y(truth)) > 12) root.append(end);
  // 懸停：十字線＋提示，命中範圍是整個繪圖區（找最近的報）
  const cross = svg('line', { class: 'crosshair', y1: m.t, y2: H - m.b, visibility: 'hidden' });
  const hit = svg('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' });
  root.append(cross, hit);
  const tip = document.getElementById('tooltip');
  hit.addEventListener('pointermove', (e) => {
    const box = root.getBoundingClientRect();
    const sx = (e.clientX - box.left) / box.width * W;
    const p = pts.reduce((a, b) => (Math.abs(X(b.x) - sx) < Math.abs(X(a.x) - sx) ? b : a));
    cross.setAttribute('x1', X(p.x)); cross.setAttribute('x2', X(p.x)); cross.setAttribute('visibility', 'visible');
    tip.textContent = p.label;
    tip.style.display = 'block';
    tip.style.left = `${Math.min(e.clientX + 12, window.innerWidth - tip.offsetWidth - 8)}px`;
    tip.style.top = `${e.clientY + 12}px`;
  });
  hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); tip.style.display = 'none'; });
  host.append(root);
}

// ── 首頁 ──
async function renderIndex() {
  const tabs = document.getElementById('years');
  const body = document.getElementById('rows');
  const status = document.getElementById('status');
  let years;
  try { years = await getJson('data/years.json'); } catch (e) { status.textContent = '還沒有資料'; return; }
  years.sort().reverse();
  const show = async (year) => {
    for (const b of tabs.children) b.setAttribute('aria-pressed', String(b.dataset.year === year));
    status.textContent = '載入中…';
    let list = [];
    try { list = await getJson(`data/${year}/index.json`); } catch (e) { status.textContent = String(e.message); return; }
    // 管理介面隱藏的事件（hidden: true）不列出；檔案還在，網址直接開仍看得到
    list = list.filter((e) => !e.hidden);
    list.sort((a, b) => (b.firstTriggerMs ?? 0) - (a.firstTriggerMs ?? 0));
    body.replaceChildren(...list.map((ev) => {
      const f = ev.final || {}; const t = ev.truth;
      const err = t && Number.isFinite(f.lat) ? km(f.lat, f.lng, t.lat, t.lng) : null;
      const link = el('a', { href: `event.html?y=${encodeURIComponent(year)}&id=${encodeURIComponent(ev.eventId)}`, text: fmtTime(f.originMs ?? ev.firstTriggerMs) });
      return el('tr', {},
        el('td', {}, link),
        el('td', { text: t ? t.location || '' : `${fix(f.lat, 2)}, ${fix(f.lng, 2)}` }),
        el('td', { class: 'r', text: Number.isFinite(f.magnitude) ? `M ${fix(f.magnitude)}` : '—' }),
        el('td', { class: 'r', text: Number.isFinite(f.depth) ? `${Math.round(f.depth)} km` : '—' }),
        el('td', { class: 'r', text: String(ev.reports ?? '—') }),
        el('td', { class: 'r', text: t ? `M ${fix(t.magnitude)}・${fix(t.depth)} km` : '' }, t ? null : el('span', { class: 'tag', text: '無中央氣象署報告' })),
        el('td', { class: 'r', text: err === null ? '—' : `${fix(err)} km` }),
        el('td', {}, ev.cancelled ? el('span', { class: 'tag', text: '已取消' }) : null,
          ev.rebuilt ? el('span', { class: 'tag', title: '用目前版本的程式，拿當時存下的測站資料事後重算；不是當時即時發出的結果', text: '事後重算' }) : null)
      );
    }));
    status.textContent = list.length ? `${year} 年共 ${list.length} 場` : `${year} 年還沒有事件`;
  };
  tabs.replaceChildren(...years.map((y) => {
    const b = el('button', { type: 'button', text: y, 'aria-pressed': 'false' });
    b.dataset.year = y;
    b.addEventListener('click', () => show(y));
    return b;
  }));
  if (years.length) show(years[0]);
}

// ── 事件頁 ──
// PGA → 震度（與程式 intensityLabelForPga 相同）
function intensityOf(pga) {
  const v = Number(pga) || 0;
  const steps = [[0.8, '0'], [2.5, '1'], [8, '2'], [25, '3'], [80, '4'], [140, '5弱'], [250, '5強'], [400, '6弱'], [800, '6強']];
  for (const [lim, label] of steps) if (v < lim) return label;
  return '7';
}

// 穩定度：從第幾報起，之後每一報都在最終報附近（震央 5 km、深度 10 km、規模 0.3 內）。回傳那一報（沒有就 null）
const STABLE = { km: 5, depth: 10, mag: 0.3 };
function stableFrom(reps, fin) {
  const near = (r) => km(r.lat, r.lng, fin.lat, fin.lng) <= STABLE.km && Math.abs(r.depth - fin.depth) <= STABLE.depth
    && (!Number.isFinite(fin.magnitude) || !Number.isFinite(r.magnitude) || Math.abs(r.magnitude - fin.magnitude) <= STABLE.mag);
  let k = reps.length;
  while (k > 0 && near(reps[k - 1])) k -= 1;
  return k < reps.length ? reps[k] : null;
}

// 測站表（stations.json：[[代號, 縣市, 站名, 緯度, 經度], …]）
let stationTable = null;
async function stations() {
  if (!stationTable) {
    try { stationTable = new Map((await getJson('stations.json')).map(([id, area, name, lat, lon]) => [id, { area, name, lat, lon }])); }
    catch { stationTable = new Map(); }
  }
  return stationTable;
}

async function renderEvent() {
  const q = new URLSearchParams(location.search);
  const year = q.get('y'); const id = q.get('id');
  const title = document.getElementById('title');
  if (!year || !id || !/^[\w-]+$/.test(id) || !/^\d{4}$/.test(year)) { title.textContent = '找不到事件'; return; }
  let ev;
  try { ev = await getJson(`data/${year}/${id}.json`); } catch (e) { title.textContent = `找不到事件 ${id}`; return; }
  const reps = ev.reports || [];
  const fin = [...reps].reverse().find((r) => r.kind !== 'report') || reps[reps.length - 1] || {};
  const t = ev.truth;
  document.title = `${t?.location || id} · HOMO_eew 推算紀錄`;
  title.textContent = t?.location || `事件 ${id}`;
  document.getElementById('meta').textContent = `事件代號 ${id}・第一個觸發 ${fmtTime(ev.firstTriggerMs)}・共 ${reps.length} 報${ev.cancelled ? '・已取消' : ''}`
    + (ev.algo?.version ? `・推算版本 ${ev.algo.version}` : '')
    + (ev.rebuilt ? '・事後重算（用這個版本的程式，拿當時存下的測站資料重算，不是當時即時發出的結果）' : '');

  const st = await stations();
  const top = (ev.topStations || []).map(([id, pga]) => ({ id, pga, info: st.get(id) }));
  const dist = (x) => (x.info ? km(fin.lat, fin.lng, x.info.lat, x.info.lon) : NaN);
  const nearest = top.map(dist).filter(Number.isFinite).reduce((a, b) => Math.min(a, b), Infinity);
  const maxSt = top[0];
  // 沒有中央氣象署地名：用最近觸發站的縣市當標題（標明是推算）
  if (!t) {
    const near = top.filter((x) => x.info).sort((a, b) => dist(a) - dist(b))[0];
    const place = near ? `${near.info.area}附近（推算）` : '推算震央';
    title.textContent = place;
    document.title = `${place} · HOMO_eew 推算紀錄`;
  }
  const stable = stableFrom(reps, fin);
  const stableText = stable ? `第 ${stable.report} 報` : '—';
  const stableSub = stable ? `觸發後 ${fix(stable.sinceFirstS, 0)} 秒起，之後都在最終報附近` : '';

  // 摘要
  const stat = (label, value, sub) => el('div', { class: 'card stat' }, el('div', { class: 'label', text: label }), el('div', { class: 'value', text: value }), el('div', { class: 'sub', text: sub }));
  const first = reps[0] || {};
  const summary = document.getElementById('summary');
  if (t) {
    summary.replaceChildren(
      stat('震央誤差（最終報）', Number.isFinite(fin.lat) ? `${fix(km(fin.lat, fin.lng, t.lat, t.lng))} km` : '—', `${fix(fin.lat, 2)}, ${fix(fin.lng, 2)}｜CWA ${fix(t.lat, 2)}, ${fix(t.lng, 2)}`),
      stat('規模（最終報）', Number.isFinite(fin.magnitude) ? `M ${fix(fin.magnitude)}` : '—', `CWA M ${fix(t.magnitude)}（差 ${fix(fin.magnitude - t.magnitude)}）`),
      stat('深度（最終報）', Number.isFinite(fin.depth) ? `${Math.round(fin.depth)} km` : '—', `CWA ${fix(t.depth)} km（差 ${fix(fin.depth - t.depth, 0)} km）`),
      stat('第一報', Number.isFinite(first.dataMs) ? `發震後 ${fix((first.dataMs - t.originMs) / 1000, 0)} 秒` : '—', Number.isFinite(first.lat) ? `震央差 ${fix(km(first.lat, first.lng, t.lat, t.lng))} km` : ''),
      stat('穩定', stableText, stableSub)
    );
  } else {
    summary.replaceChildren(
      stat('最終推算', Number.isFinite(fin.magnitude) ? `M ${fix(fin.magnitude)}・${Math.round(fin.depth)} km` : `${Math.round(fin.depth)} km`, `${fix(fin.lat, 2)}, ${fix(fin.lng, 2)}・發震 ${fmtTime(fin.originMs)}`),
      stat('穩定', stableText, stableSub),
      stat('證據', `${fin.stations ?? '—'} 站`, `${Number.isFinite(nearest) ? `最近觸發站 ${fix(nearest)} km・` : ''}P ${fin.phaseP ?? '—'}・S ${fin.phaseS ?? '—'}`),
      stat('最大震度', maxSt ? intensityOf(maxSt.pga) : '—', maxSt ? `${maxSt.info ? `${maxSt.info.area} ${maxSt.info.name}` : maxSt.id} ${fix(maxSt.pga)} gal` : ''),
      stat('第一報', `觸發後 ${fix(first.sinceFirstS, 0)} 秒`, Number.isFinite(first.lat) ? `離最終報 ${fix(km(first.lat, first.lng, fin.lat, fin.lng))} km` : '')
    );
  }

  // 收斂圖：只有對得到中央氣象署的事件才畫（2026-11-22 使用者：小地震不用折線圖，每報列出就好）
  if (!t) {
    document.getElementById('conv').hidden = true;
    document.getElementById('th-epi').textContent = '離最終報 km';
  }
  // 有真值對真值（紅）；沒有真值時這段不顯示（保留對最終報的畫法，之後要再打開只改上面）
  const ref = t || { lat: fin.lat, lng: fin.lng, depth: fin.depth, magnitude: fin.magnitude };
  const refName = t ? 'CWA' : '最終';
  const refClass = t ? 'truth-line' : 'ref-line';
  if (!t) {
    document.getElementById('conv-title').textContent = '和最終報對照';
    const note = document.getElementById('conv-note');
    note.hidden = false;
    note.textContent = '這個事件沒有中央氣象署報告（通常是規模小、沒有發布），沒有真值可比；下面量的是推算多快穩定下來，不代表準確。';
    document.getElementById('legend-ref').textContent = '最終報';
    document.getElementById('legend-ref-swatch').className = 'swatch-ref';
    document.getElementById('t-epi').textContent = '離最終報的距離';
    document.getElementById('d-epi').textContent = '每一報的震央離最終報震央多遠';
    document.getElementById('d-mag').textContent = '每一報的規模，虛線是最終報';
    document.getElementById('d-depth').textContent = '每一報的深度，虛線是最終報';
  }
  const label = (r, extra) => `第 ${r.report} 報${r.kind === 'final' ? '（最終）' : r.kind === 'supplement' ? '（追加）' : ''}・觸發後 ${fix(r.sinceFirstS, 0)} 秒\n${extra}`;
  const pt = (r, y, extra, low = false) => ({ x: r.sinceFirstS, y, low, label: label(r, extra) });
  lineChart(document.getElementById('c-epi'), {
    points: reps.map((r) => { const d = km(r.lat, r.lng, ref.lat, ref.lng); return pt(r, d, `${t ? '震央誤差' : '離最終報'} ${fix(d)} km`); }), yUnit: 'km', yMin: 0, yFloorSpan: 5
  });
  lineChart(document.getElementById('c-mag'), {
    points: reps.map((r) => pt(r, r.magnitude, `M ${fix(r.magnitude)}${r.magLow ? '（低精度）' : ''}・${r.magStations ?? '—'} 站`, !!r.magLow)),
    truth: ref.magnitude, truthLabel: `${refName} ${fix(ref.magnitude)}`, refClass, yUnit: 'M', yFloorSpan: 1
  });
  lineChart(document.getElementById('c-depth'), {
    points: reps.map((r) => pt(r, r.depth, `深度 ${fix(r.depth, 0)} km`)),
    truth: ref.depth, truthLabel: `${refName} ${fix(ref.depth, t ? 1 : 0)}`, refClass, yUnit: 'km', yMin: 0, yFloorSpan: 10
  });
  lineChart(document.getElementById('c-st'), {
    points: reps.map((r) => pt(r, r.stations, `${r.stations} 站（P ${r.phaseP}・S ${r.phaseS}・O ${r.phaseO}）`)), yUnit: '站', yMin: 0, yFloorSpan: 5
  });

  // 測站觀測
  document.getElementById('st-rows').replaceChildren(...(top.length ? top.map((x) => el('tr', {},
    el('td', { text: x.info ? `${x.info.area} ${x.info.name}` : x.id }),
    el('td', { class: 'r', text: fix(dist(x)) }),
    el('td', { class: 'r', text: fix(x.pga, 2) }),
    el('td', { class: 'r', text: intensityOf(x.pga) })
  )) : [el('tr', {}, el('td', { colspan: '4', class: 'muted', text: '這筆記錄沒有測站資料（較早的版本）' }))]));

  // 每一報
  document.getElementById('rows').replaceChildren(...reps.map((r) => el('tr', {},
    el('td', { text: `${r.report}${r.kind === 'final' ? '（終）' : r.kind === 'supplement' ? `（追加 ${r.revision}）` : ''}` }),
    el('td', { class: 'r', text: fix(r.sinceFirstS, 0) }),
    // 發震後秒數：有中央氣象署用它的發震時間，沒有就用我們最終報的發震時間
    el('td', { class: 'r', text: fix((r.dataMs - (t ? t.originMs : fin.originMs)) / 1000, 0) }),
    el('td', { text: `${fix(r.lat, 2)}, ${fix(r.lng, 2)}` }),
    el('td', { class: 'r', text: t ? fix(km(r.lat, r.lng, t.lat, t.lng)) : fix(km(r.lat, r.lng, fin.lat, fin.lng)) }),
    el('td', { class: 'r', text: fix(r.depth, 0) }),
    el('td', { class: 'r', text: Number.isFinite(r.magnitude) ? `${fix(r.magnitude)}${r.magLow ? '（低）' : ''}` : '—' }),
    el('td', { class: 'r', text: String(r.stations) }),
    el('td', { class: 'r', text: `${r.phaseP}/${r.phaseS}/${r.phaseO}` }),
    el('td', { class: 'r', text: Number.isFinite(r.maxPga) ? fix(r.maxPga) : '—' })
  )));
}
