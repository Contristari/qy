/* 轻盈计划 · 女版 —— 手机端单页应用
   目标：不是“变轻”，是“腿型变好、体力变好、周期变顺”。
   数据全部保存在本机 localStorage，不上传任何服务器。 */
(() => {
  'use strict';

  // ---------------- 配置 ----------------
  const CFG = {
    totalDays: 129,          // 2026-10-19 → 2027-02-24
    startDate: '2026-10-19',
    startWeight: 65.0,       // 130 斤
    goalWeight: 58.0,        // 116 斤（主要目标：围度和线条）
    visibleWeight: 55.0,     // 110 斤（能看到的目标，不硬追）
    cupMl: 250,
    waterGoal: 8,
    kcalMaintain: 1950,      // 维持热量（估算）
    kcalTarget: 1500,        // 目标摄入
  };
  const PLAN_END = (() => {
    const d = new Date(CFG.startDate + 'T00:00:00');
    d.setDate(d.getDate() + CFG.totalDays - 1);
    return d;
  })();

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => { const p = new URLSearchParams(location.search); return p.get('date') || ymd(new Date()); };
  const parseYmd = (s) => new Date(s + 'T00:00:00');
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const diffDays = (a, b) => Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate()) - new Date(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);
  const dayIndex = (key) => diffDays(parseYmd(CFG.startDate), parseYmd(key)); // 10-19 -> 0
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------------- 存储 ----------------
  // 说明：手机浏览器打开本地文件时，localStorage 可能不可用（部分内核会拒绝）。
  // 这里做三级降级：localStorage → sessionStorage → 内存；并在写入失败时给出明确提示。
  const MEM = {};
  function pickStore() {
    const tryStore = (s) => { try { const k = '__js_probe__'; s.setItem(k, '1'); s.removeItem(k); return s; } catch (e) { return null; } };
    try { if (typeof localStorage !== 'undefined' && localStorage) { const s = tryStore(localStorage); if (s) return { s, kind: 'local' }; } } catch (e) { /* 忽略 */ }
    try { if (typeof sessionStorage !== 'undefined' && sessionStorage) { const s = tryStore(sessionStorage); if (s) return { s, kind: 'session' }; } } catch (e) { /* 忽略 */ }
    return { s: null, kind: 'memory' };
  }
  const STORE = pickStore();
  const LS = {
    get(k, d) {
      try {
        const raw = STORE.s ? STORE.s.getItem(k) : MEM[k];
        if (raw == null) return d;
        const parsed = JSON.parse(raw);
        return parsed == null ? d : parsed;
      } catch (e) {
        // 数据坏了：先备份原文，保证不丢，再按空数据处理
        try { const bad = STORE.s ? STORE.s.getItem(k) : MEM[k]; if (bad) MEM['her_broken_' + k] = bad; } catch (e2) { /* 忽略 */ }
        return d;
      }
    },
    set(k, v) {
      const raw = JSON.stringify(v);
      if (!STORE.s) { MEM[k] = raw; return; }
      try { STORE.s.setItem(k, raw); } catch (e) {
        MEM[k] = raw;
        if (!LS._warned) { LS._warned = true; toast('这个浏览器不允许保存，记录只在本页有效；请用「导出备份」保存'); }
      }
    },
  };
  let DAYS = LS.get('her_js_days', {});     // { 'YYYY-MM-DD': {water, meals, walk, train, screen, sleep, snack, ...} }
  let WEIGHTS = LS.get('her_js_weights', []); // [{d:'YYYY-MM-DD', w, waist, hip}]
  let SETTINGS = Object.assign({
    sound: true, vibrate: true, notifOn: false,
    sitEvery: 45, snackBudget: 1, waterGoal: CFG.waterGoal, kegelDaily: 3,
  }, LS.get('her_js_settings', {}));
  let LAST_SAVE = LS.get('her_js_lastsave', 0);
  const save = () => { LS.set('her_js_days', DAYS); LS.set('her_js_weights', WEIGHTS); LS.set('her_js_settings', SETTINGS); LAST_SAVE = Date.now(); LS.set('her_js_lastsave', LAST_SAVE); };
  function day(key, create) {
    if (!DAYS[key] && create) DAYS[key] = { water: [], meals: {}, snack: 0, walk: false, train: false, screen: null, sleep: null, note: '' };
    return DAYS[key];
  }

  // ---------------- 日历模型：起床早一点但允许赖床，训练挪到晚饭后 ----------------
  const PLAN = [
    { t: '08:00', title: '起床 · 第一杯温水', why: '她早上起不来，先喝水再开窗帘，别一睁眼就刷手机', goto: 'water' },
    { t: '08:10', title: '3 分钟唤醒拉伸', why: '腿后侧 + 髋前侧，专治久坐的腰酸', goto: 'plan' },
    { t: '09:00', title: '早餐', why: '豆浆/燕麦 + 鸡蛋 + 一份水果（乳糖不耐不喝牛奶）', goto: 'meals' },
    { t: '09:20', title: '补铁小动作', why: '早餐配一个猕猴桃或半杯橙汁，帮铁吸收', goto: 'meals' },
    { t: '10:00', title: '第 2 杯水', why: '手机闹钟提醒', goto: 'water' },
    { t: '11:00', title: '第 3 杯水', why: '喝完这杯，午饭前不喝奶茶', goto: 'water' },
    { t: '11:30', title: '第 4 杯水', why: '饭前半小时，饱腹感更强', goto: 'water' },
    { t: '12:00', title: '午餐', why: '先菜后肉再饭；米饭一小碗，红肉优先（补铁）', goto: 'meals' },
    { t: '12:30', title: '饭后散步 10 分钟', why: '不用走快，走够时间就行', goto: 'move' },
    { t: '14:00', title: '起来动一动', why: '她久坐跷二郎腿，每小时必须起来一次', goto: 'today' },
    { t: '14:30', title: '下午加餐 + 第 5 杯水', why: '想吃甜的用无糖酸奶 + 水果代替', goto: 'water' },
    { t: '16:00', title: '第 6 杯水（淡茶也行）', why: '茶她更容易接受', goto: 'water' },
    { t: '17:30', title: '第 7 杯水', why: '下班前喝完，别拖到晚上', goto: 'water' },
    { t: '19:00', title: '晚餐', why: '先菜后肉再饭；米饭半碗，19:30 前离桌', goto: 'meals' },
    { t: '19:40', title: '晚饭后散步 15 分钟', why: '能说话的速度，不要喘', goto: 'move' },
    { t: '20:20', title: '居家轻训练 20 分钟', why: '塑形A/B 或舒展，瑜伽垫上做，不出大汗', goto: 'plan' },
    { t: '21:00', title: '第 8 杯水 · 厨房关门', why: '21:00 后不再吃正餐', goto: 'water' },
    { t: '21:30', title: '睡前放松 + 盘腿', why: '放松大腿内侧，别把二郎腿带到床上', goto: 'plan' },
    { t: '22:00', title: '手机放到客厅充电', why: '刷剧的 1 小时是甜食的高危时段', goto: 'today' },
    { t: '22:30', title: '刷牙 = 今天不再进食', why: '想吃就喝水、离开厨房', goto: 'today' },
    { t: '23:00', title: '上床', why: '她早上睡不醒，先把上床时间稳住', goto: 'today' },
  ];
  const CHECKINS = new Set(['water', 'walk', 'train', 'closed', 'stretch']);
  const CUP_TARGET = [3, 5, 7, 8]; // 达成 4/6/8 杯时的标记

  // ---------------- 统计 ----------------
  function waterCount(key) { const d = DAYS[key]; return d && d.water ? d.water.length : 0; }
  function protein(key) { const d = DAYS[key]; return d && d.meals ? Object.values(d.meals).filter(Boolean).length : 0; }
  function habitScore(key) {
    const d = DAYS[key]; if (!d) return 0;
    return clamp(Math.round(
      clamp(waterCount(key) / CFG.waterGoal, 0, 1) * 40 +
      clamp(protein(key) / 3, 0, 1) * 15 +
      (d.walk ? 15 : 0) + (d.train ? 15 : 0) + (d.sleep ? 10 : 0) +
      (d.screen != null ? (d.screen <= 7 ? 5 : 0) : 0)
    ), 0, 100);
  }
  function allKeys() {
    const out = [];
    for (let i = 0; i < CFG.totalDays; i++) out.push(ymd(addDays(parseYmd(CFG.startDate), i)));
    return out;
  }
  function currentWeight() {
    const ws = WEIGHTS.filter((x) => x && x.w).sort((a, b) => (a.d < b.d ? -1 : 1));
    return ws.length ? ws[ws.length - 1].w : CFG.startWeight;
  }
  function weeklyAvgWeight(endKey) {
    const end = parseYmd(endKey); const vals = [];
    for (let i = 6; i >= 0; i--) { const k = ymd(addDays(end, -i)); if (DAYS[k] && DAYS[k].w) vals.push(DAYS[k].w); }
    if (!vals.length) return null;
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
  }
  function streak() {
    let n = 0; const t = today();
    for (let i = 0; i < CFG.totalDays; i++) {
      const k = ymd(addDays(parseYmd(t), -i));
      const d = DAYS[k];
      const hit = d && (waterCount(k) > 0 || d.walk || protein(k) > 0);
      if (hit) n++; else if (i > 0) break;
    }
    return n;
  }

  // ---------------- 通知/提醒 ----------------
  let lastAlarm = null;
  async function notify(title, body, tag) {
    if (!(SETTINGS.notifOn && typeof Notification !== 'undefined' && Notification && Notification.permission === 'granted')) return;
    try {
      if (navigator.serviceWorker) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg && reg.active) {
          reg.active.postMessage({ type: 'notify', title, body, tag });
          return;
        }
      }
      new Notification(title, { body, tag });
    } catch (e) { /* 通知失败不影响页面提醒 */ }
  }
  function beep() {
    if (!SETTINGS.sound) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext; const ctx = new AC();
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = 880; go();
      function go() { o.connect(g); g.connect(ctx.destination); g.gain.setValueAtTime(0.0001, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5); o.start(); o.stop(ctx.currentTime + 0.55); }
    } catch (e) { /* 未授权音频，忽略 */ }
  }
  function buzz() { if (SETTINGS.vibrate && navigator.vibrate) navigator.vibrate([180, 90, 180]); }
  function alarmBanner(text) {
    const b = $('#alarm');
    $('#alarmText').textContent = text;
    b.classList.add('show');
    beep(); buzz();
  }
  function tick() {
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const t = today();

    // 喝水闹钟（10:00/11:00/11:30/14:30/16:00/17:30/21:00）
    for (const p of PLAN) {
      if (p.goto !== 'water') continue;
      const [h, m] = p.t.split(':').map(Number);
      const pm = h * 60 + m;
      const id = t + ' ' + p.t;
      if (nowMin >= pm && nowMin < pm + 6 && lastAlarm !== id && waterCount(t) > 0 && waterCount(t) < CFG.waterGoal) {
        lastAlarm = id;
        alarmBanner(`该喝第 ${waterCount(t) + 1} 杯水了（${p.t} 提醒）`);
        notify('减脂打卡 · 喝水提醒', `该喝第 ${waterCount(t) + 1} 杯水了，现在就去喝一口`, 'water-' + t);
      }
    }
    // 饭后散步
    for (const [tm, label] of [['12:30', '午饭后散步 15 分钟'], ['19:40', '晚饭后散步 15–20 分钟']]) {
      const [h, m] = tm.split(':').map(Number); const pm = h * 60 + m; const id = t + ' walk ' + tm;
      const d = DAYS[t];
      if (nowMin >= pm && nowMin < pm + 6 && lastAlarm !== id && !(d && d.walk)) {
        lastAlarm = id; alarmBanner(`饭后散步时间：${label}`); notify('减脂打卡 · 散步提醒', label + '，起身走一走', 'walk-' + t);
      }
    }
    // 久坐提醒（9:00–18:00 每 N 分钟，每小时只提醒一次）
    if (SETTINGS.sitEvery > 0) {
      const st = 9 * 60, en = 18 * 60;
      if (nowMin >= st && nowMin < en) {
        const bucket = Math.floor((nowMin - st) / SETTINGS.sitEvery);
        const sitId = 'sit ' + t + ' ' + bucket;
        if (nowMin % SETTINGS.sitEvery < 2 && lastAlarm !== sitId) {
          lastAlarm = sitId;
          const lk = t + '|' + sitId;
          if (!(DAYS[t] && DAYS[t].breakLog && DAYS[t].breakLog[lk])) {
            alarmBanner('坐久了：起来走 30 秒（接水/上厕所/走廊一圈）');
            notify('减脂打卡 · 久坐提醒', '你已经坐了很久，起来走 30 秒', 'sit-' + t);
          }
        }
      }
    }
    renderNext();
    renderSit();
  }

  // ---------------- 渲染公共 ----------------
  function renderHeader() {
    const now = new Date();
    $('#dateLine').textContent = `${now.getMonth() + 1}月${now.getDate()}日 ${WEEK_CN[now.getDay()]}`;
    const di = dayIndex(today());
    const left = CFG.totalDays - di - 1;
    $('#dayLine').textContent = di >= 0
      ? `第 ${di + 1} / ${CFG.totalDays} 天${left >= 0 ? ` · 距收尾还有 ${left} 天` : ' · 已过计划期'}`
      : `计划 ${CFG.startDate} 开始`;
  }
  function daysLeft() {
    const left = diffDays(new Date(), PLAN_END);
    return Math.max(0, left);
  }
  function renderNext() {
    const now = new Date(); const nowMin = now.getHours() * 60 + now.getMinutes();
    let next = null, prev = null;
    for (const p of PLAN) {
      const [h, m] = p.t.split(':').map(Number); const pm = h * 60 + m;
      if (pm <= nowMin) prev = p;
      if (pm > nowMin && !next) next = p;
    }
    const d = DAYS[today()];
    let html = '';
    if (!next) {
      html = `<div class="next-title">今天日程已结束 🌙</div><div class="next-sub">记得 23:00 前上床，明天继续</div>`;
    } else {
      const diff = (next.t.split(':')[0] * 60 + Number(next.t.split(':')[1])) - nowMin;
      html = `<div class="next-time"><span class="big">${next.t}</span><span class="in">${diff} 分钟后</span></div>
              <div class="next-title">${esc(next.title)}</div><div class="next-sub">${esc(next.why)}</div>
              <button class="btn ghost sm" data-goto="${next.goto}">现在处理 ›</button>`;
    }
    if (prev) html += `<div class="prev-line">上一项：${esc(prev.title)}（${prev.t}）</div>`;
    $('#nextCard').innerHTML = html;
  }
  function renderSit() {
    const d = DAYS[today()] || {};
    const n = d.breaks || 0;
    $('#sitCount').textContent = n;
    const el = $('#sitTip');
    if (!el) return;
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    const inOffice = nowMin >= 9 * 60 && nowMin < 18 * 60;
    el.textContent = inOffice ? `营业时间：每 ${SETTINGS.sitEvery} 分钟起身一次 ${n ? '，今天已起身 ' + n + ' 次' : '，今天还没起身过'}` : '非营业时间，可以专心训练和散步';
  }

  // ---------------- 页面：今日 ----------------
  // ================================================================
  //  页面：今天 —— 全 App 唯一能打卡的地方
  //  一条时间轴，从早到晚，点一下就算做完。其他页面都不带打卡按钮。
  // ================================================================
  function renderToday() {
    const t = today(); const d = DAYS[t] || {};
    const wc = waterCount(t);
    const goal = SETTINGS.kegelDaily || 3;
    const menu = todayMenu();
    const tasks = coachTasks();
    const doneN = tasks.filter((x) => x.done).length;
    const pct = Math.round((doneN / tasks.length) * 100);
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    const nextTask = tasks.find((x) => !x.done && (Number(x.at.split(':')[0]) * 60 + Number(x.at.split(':')[1])) >= nowMin - 20) || tasks.find((x) => !x.done);
    const rest = 23.5 - nowMin / 60;

    const R = 52, C = 2 * Math.PI * R;
    const dash = `stroke-dasharray:${C.toFixed(1)} ${C.toFixed(1)};stroke-dashoffset:${(C * (1 - pct / 100)).toFixed(1)}`;
    const envWarn = storageWarning();
    const ph = phaseNote();

    const html = `
      ${envWarn}
      ${ph.show ? `<div class="card phase-card ${ph.cls}"><div class="phase-title">${esc(ph.title)}</div><div class="phase-body">${ph.body}</div></div>` : `<div class="card phase-card phase-set"><div class="phase-body">还没设置经期。去「设置」页填一下上次月经开始日，之后会自动提醒你哪天该减量、哪天该补铁。</div></div>`}
      <div class="card today-head">
        <div class="th-ring">
          <svg viewBox="0 0 128 128" class="ring">
            <circle cx="64" cy="64" r="${R}" class="ring-bg"/>
            <circle cx="64" cy="64" r="${R}" class="ring-fg" style="${dash}"/>
          </svg>
          <div class="ring-center"><div class="ring-num sm">${doneN}<span>/${tasks.length}</span></div></div>
        </div>
        <div class="th-main">
          <div class="th-title">${doneN === 0 ? '今天还没开始' : doneN >= tasks.length ? '今天全做完了 🎉' : `还剩 ${tasks.length - doneN} 件`}</div>
          <div class="th-say">${coachLine(pct, rest, doneN, tasks.length)}</div>
        </div>
      </div>

      <div class="card water-bar">
        <div class="wb-top">
          <span class="wb-label">💧 喝水</span>
          <span class="wb-num">${wc}<span>/${CFG.waterGoal} 杯</span></span>
          <button class="btn primary wb-btn" id="drink">＋1 杯</button>
        </div>
        <div class="cups">${Array.from({ length: CFG.waterGoal }, (_, i) => `<button class="cup ${i < wc ? 'on' : ''}" data-cup="${i + 1}" aria-label="第${i + 1}杯">${i < wc ? '●' : '○'}</button>`).join('')}</div>
      </div>

      <div class="card">
        <div class="card-title">今天的安排 <span class="muted">点一下 = 完成</span></div>
        <div class="coach-list">
          ${tasks.map((x) => `
            <button class="coach-item ${x.done ? 'done' : ''} ${x.overdue ? 'late' : ''} ${nextTask && nextTask.id === x.id ? 'now' : ''}" data-coach="${x.id}">
              <span class="ci-time">${x.at}</span>
              <span class="ci-main"><b>${esc(x.title)}</b><em>${esc(x.detail)}</em></span>
              <span class="ci-check">${x.done ? '✓' : (x.overdue ? '!' : '○')}</span>
            </button>`).join('')}
        </div>
      </div>

      <div class="card">
        <div class="card-title">今天吃什么 <span class="muted">完整 7 天在「食谱」页</span></div>
        <div class="menu-day">
          <div class="md-row"><span class="md-tag">早 9:00</span><span>${esc(menu.b)}</span></div>
          <div class="md-row"><span class="md-tag">午 12:00</span><span>${esc(menu.l)}</span></div>
          <div class="md-row"><span class="md-tag">加 14:30</span><span>无糖酸奶 + 坚果 10g（或 1 个煮蛋）</span></div>
          <div class="md-row"><span class="md-tag">晚 19:00</span><span>${esc(menu.d)}</span></div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">空腹体重</div>
        <div class="row">
          <input class="input big-input" id="todayWeight" type="number" inputmode="decimal" step="0.1" placeholder="今早多少" value="${d.w && d.w.w != null ? d.w.w : ''}">
          <span class="unit">kg</span>
          <button class="btn primary" id="saveWeight">保存</button>
        </div>
        <div class="muted small-tip">早上排空后称。${d.w && d.w.w ? '已记录 ' + d.w.w + ' kg。' : ''}只记数字，别纠结。</div>
      </div>
    `;
    $('#todayBody').innerHTML = html;

    $('#drink').onclick = () => addWater(1);
    $$('#todayBody [data-cup]').forEach((b) => (b.onclick = () => setWater(Number(b.dataset.cup))));
    $$('#todayBody [data-coach]').forEach((b) => (b.onclick = () => coachDo(b.dataset.coach)));
    $('#saveWeight').onclick = () => {
      const v = parseFloat($('#todayWeight').value);
      if (!isFinite(v) || v < 40 || v > 120) return toast('请输入 40–120 之间的体重');
      const dayObj = day(today(), true); dayObj.w = { w: Math.round(v * 10) / 10 };
      WEIGHTS = WEIGHTS.filter((x) => x.d !== today());
      WEIGHTS.push({ d: today(), w: Math.round(v * 10) / 10, waist: null, hip: null });
      save(); toast('体重已记录'); renderToday();
    };
  }
  // 运行环境自检：把你说的“微信打开 / 文件打开 / 网址打开”的真实差别摆到界面上
  function storageWarning() {
    const ua = navigator.userAgent || '';
    const inWeChat = /MicroMessenger/i.test(ua);
    const isFile = location.protocol === 'file:';
    const problems = [];
    if (inWeChat) problems.push('你现在是在<b>微信</b>里打开的。微信内置浏览器不保存数据：<b>退出再进，今天的打卡会消失</b>。');
    if (isFile) problems.push('这是<b>直接打开的文件</b>。部分浏览器（含微信）不允许它保存数据，<b>关掉就没了</b>。');
    if (STORE.kind === 'memory') problems.push('实测：这个浏览器<b>拒绝保存</b>，记录只在本页有效。');
    else if (STORE.kind === 'session') problems.push('实测：这个浏览器只保存到<b>关掉页面为止</b>。');
    if (!problems.length) return '';
    return `<div class="card env-warn">
      <div class="ew-title">⚠️ 这样打开，数据会丢</div>
      <div class="ew-body">${problems.map((p) => '· ' + p).join('<br>')}</div>
      <div class="ew-fix">正确做法：把文件用 <b>Chrome / Edge</b> 打开（不是微信里），或把它放到 https 网址上。现在这个环境先看内容可以，别当真记录。</div>
    </div>`;
  }

  // 环境自检面板：设置页顶部直接显示当前是什么环境
  function envPanel() {
    const ua = navigator.userAgent || '';
    const inWeChat = /MicroMessenger/i.test(ua);
    const isFile = location.protocol === 'file:';
    const isHttps = location.protocol === 'https:';
    const kindText = { local: '可以长期保存 ✅', session: '只保存到关页面 ⚠️', memory: '完全不保存 ❌' }[STORE.kind];
    const rows = [
      ['打开方式', inWeChat ? '微信内置浏览器' : (isFile ? '本地文件' : (isHttps ? 'HTTPS 网址' : '局域网 http 网址'))],
      ['数据保存', kindText],
      ['能装到桌面', inWeChat ? '不能（微信不支持）' : (isHttps ? '能 ✅' : '只能加书签快捷方式')],
      ['后台通知', inWeChat ? '不能（微信里）' : (isHttps ? '可以尝试' : '基本不行')],
      ['离线可用', isFile ? '本来就离线' : (isHttps && !inWeChat ? '可以（装好后）' : '不行')],
    ];
    const bad = STORE.kind !== 'local' || inWeChat;
    return `<div class="card">
      <div class="card-title">当前运行环境</div>
      <div class="env-list">${rows.map(([k, v]) => `<div class="env-row"><span>${k}</span><b class="${/✅/.test(v) ? 'ok' : (/❌|不能|基本不行|⚠️/.test(v) ? 'bad' : '')}">${v}</b></div>`).join('')}</div>
      ${bad ? '<div class="warn">这个环境记录会丢。想让数据真的存住，见下面的「装到手机」。</div>' : '<div class="ok-banner">这个环境是稳的，可以放心记录。</div>'}
    </div>`;
  }

  function addWater(n) {
    const dayObj = day(today(), true);
    const target = clamp(dayObj.water.length + n, 0, 16);
    if (target > dayObj.water.length) {
      while (dayObj.water.length < target) dayObj.water.push(Date.now());
    } else {
      dayObj.water.length = target;
    }
    save(); renderToday();
    const wc = dayObj.water.length;
    if (CUP_TARGET.includes(wc)) { beep(); buzz(); toast(`第 ${wc} 杯达成 ${['💧', '💧💧', '💧💧💧', '🎉'][CUP_TARGET.indexOf(wc)]}`); }
  }
  function setWater(n) {
    const dayObj = day(today(), true);
    const cur = (dayObj.water || []).length;
    // 点已亮的那一杯 = 取消它（把杯数退回到它前面）
    const len = clamp(n === cur ? n - 1 : n, 0, 16);
    dayObj.water = Array.from({ length: len }, () => Date.now());
    save(); renderToday();
    if (len !== n) toast(`已撤销，回到 ${len} 杯`);
  }
  function quickToggle(key) {
    const t = today(); const dayObj = day(t, true);
    if (key === 'walk') { dayObj.walk = !dayObj.walk; if (dayObj.walk) { buzz(); toast('散步完成，记下了 👍'); } }
    if (key === 'kegel') {
      dayObj.kegel = (dayObj.kegel || 0) + 1;
      const goal = SETTINGS.kegelDaily || 3;
      if (dayObj.kegel >= goal) { dayObj.kegelDone = true; buzz(); toast('今天凯格尔完成 🔥'); }
      else toast(`凯格尔 ${dayObj.kegel}/${goal} 轮`);
    }
    if (key === 'train') { openSheet('train'); return; }
    if (key === 'meals') { openMeals(); return; }
    if (key === 'sleep') { openSheet('sleep'); return; }
    if (key === 'screen') { openSheet('screen'); return; }
    if (key === 'closed') { dayObj.closed = !dayObj.closed; }
    if (key === 'water') { openSheet('water'); return; }
    if (key === 'snack') { dayObj.snack = Math.max(0, (dayObj.snack || 0) + 1); }
    save(); renderToday();
  }

  // ---------------- 底部面板 ----------------
  function openSheet(kind) {
    const t = today(); const d = DAYS[t] || {};
    const map = {
      move: {
        title: '饭后散步', body: `
          <p class="muted">饭后 15–20 分钟，速度：能说话但不能唱歌。这是全天最划算的一次运动。</p>
          <button class="btn ${(d.walk ? 'ghost' : 'primary')}" id="walkSheetBtn" style="width:100%">${d.walk ? '✓ 今天已走过，点一下取消' : '我走了，打卡'}</button>
          <p class="muted small-tip">不想出门也行：屋里原地踏步 10 分钟，或者跟着做一遍舒展。</p>`,
        bind: () => { $('#walkSheetBtn').onclick = () => { const dayObj = day(t, true); dayObj.walk = !dayObj.walk; save(); closeSheet(); toast(dayObj.walk ? '散步完成 👍' : '已取消'); }; },
      },
      closed: {
        title: '关厨房：今天不再吃东西', body: `
          <p class="muted">21:00 后不吃正餐，21:30 刷牙就算“关门”。做到就点下面。</p>
          <button class="btn ${(d.closed ? 'ghost' : 'primary')}" id="closedBtn" style="width:100%">${d.closed ? '✓ 已做到，取消勾选' : '我刷牙了，今天不再进食'}</button>
          <p class="muted small-tip">还饿的话：热水一杯、无糖茶、1 个煮蛋（低伤害版），不算破戒。</p>`,
        bind: () => { $('#closedBtn').onclick = () => { const dayObj = day(t, true); dayObj.closed = !dayObj.closed; save(); closeSheet(); toast(dayObj.closed ? '关厨房完成 🌙' : '已取消'); }; },
      },
      snackNow: {
        title: '想吃零食了？先走这三步', body: `
          <p class="muted">按顺序做，做完还是想吃，就吃“低伤害版”，记一次账就行，不用自责。</p>
          <div class="steps-box">
            <ol>
              <li><b>先喝一大杯水</b>（250ml），等 3 分钟</li>
              <li><b>站起来离开厨房/饭桌</b>，走动 1 分钟</li>
              <li><b>刷牙</b>——刷完牙，大部分时候就不想吃了</li>
            </ol>
          </div>
          <div class="row" style="margin-top:12px">
            <button class="btn ghost" id="noSnack">忍住了，记 0</button>
            <button class="btn primary" id="yesSnack">吃了，记 1 次</button>
          </div>
          <p class="muted small-tip">低伤害版：无糖酸奶 100g、1 个煮蛋、黄瓜番茄、无糖茶。这些吃一次不会毁掉一天。</p>`,
        bind: () => {
          $('#noSnack').onclick = () => {
            const dayObj = day(t, true); dayObj.snackLogged = true; save();
            closeSheet(); toast('忍住一次 👏 记下了');
          };
          $('#yesSnack').onclick = () => {
            const dayObj = day(t, true); dayObj.snack = (dayObj.snack || 0) + 1; dayObj.snackLogged = true; save(); closeSheet(); toast('记下了，下一餐照常吃'); renderToday();
          };
        },
      },
      train: {
        title: '今天练哪一项', body: `
          <p class="muted">六选一就行，做完在“训练”页打勾。盆底肌每天都可以做，不占训练时间。</p>
          ${[['A', '塑形A · 臀腿（假胯宽）', '蚌式 / 侧抬腿 / 臀桥 · 20 分钟'],
            ['B', '塑形B · 骨盆核心', '臀中肌 / 死虫式 / 鸟狗式 · 20 分钟'],
            ['C', '舒展 · 久坐酸痛', '腰酸腿胀时做，全是拉伸 · 15 分钟'],
            ['F', '大腿内侧 · 专项', '夹枕头 / 侧卧内收 · 10 分钟'],
            ['D', '走路 · 轻有氧', '饭后慢走，不喘 · 每天'],
            ['E', '盆底肌 · 女性版', '每天 3 轮，坐着就能做 · 久坐必练']].map(([k, name, sub]) => {
            const p = trainProgress(k);
            return `<button class="meal-row ${p.done ? 'done' : ''}" data-pick="${k}">
              <span><b>${name}</b><br><span class="muted">${sub}</span></span>
              <span class="tick">${p.done ? '✓' : '›'}</span></button>`;
          }).join('')}`,
        bind: () => $$('[data-pick]').forEach((b) => (b.onclick = () => {
          const k = b.dataset.pick;
          closeSheet();
          // 跳到训练页并滚到「所有训练」那块，选中对应标签
          switchTab('plan', { scrollTop: 0 });
          setTimeout(() => {
            const tb = $$('[data-traink]').find((x) => x.dataset.traink === k);
            if (tb) tb.click();
            goToTabElement('plan', '#trainTabs', 30);
          }, 30);
        })),
      },
      water: {
        title: '喝水', body: `
          <p class="muted">在下面点一次“喝了一杯”，或用时间表提醒自己。凉白开、矿泉水、淡茶都算。</p>
          <div class="row"><button class="btn primary" id="wAdd">＋ 喝了一杯（${CFG.cupMl}ml）</button><button class="btn ghost" id="wDel">－ 记错了</button></div>
          <div class="plan-list">${PLAN.filter((p) => p.goto === 'water').map((p) => `<div class="pl-row"><span class="pl-t">${p.t}</span><span>${esc(p.title)}</span><span class="pl-w">${esc(p.why)}</span></div>`).join('')}</div>`,
        bind: () => { $('#wAdd').onclick = () => { addWater(1); openSheet('water'); }; $('#wDel').onclick = () => { addWater(-1); openSheet('water'); }; },
      },
      meals: {
        title: '三餐蛋白 · 今天吃了哪些', body: `
          <p class="muted">每餐 1 掌心蛋白：蛋、豆浆、牛奶、鱼、鸡、牛肉、豆腐。吃到了就点一下打勾。</p>
          ${[['b', '早餐 09:00', '鸡蛋 / 无糖豆浆 / 牛奶'], ['l', '午餐 12:00', '肉 150g / 鱼 / 豆腐'], ['d', '晚餐 19:00', '鱼 / 鸡 / 瘦肉 / 豆腐']].map(([k, label, tip]) => `
            <button class="meal-row ${d.meals && d.meals[k] ? 'done' : ''}" data-meal="${k}">
              <span><b>${label}</b><br><span class="muted">${tip}</span></span><span class="tick">${d.meals && d.meals[k] ? '✓' : '○'}</span>
            </button>`).join('')}
          <p class="muted small-tip">主食：午餐米饭一小碗，晚餐半碗；先吃菜和肉，再吃饭。</p>`,
        bind: () => $$('.meal-row').forEach((b) => (b.onclick = () => {
          const dayObj = day(t, true); dayObj.meals = dayObj.meals || {}; dayObj.meals[b.dataset.meal] = !dayObj.meals[b.dataset.meal]; save(); openSheet('meals'); renderToday();
        })),
      },
      sleep: {
        title: '睡眠', body: `
          <p class="muted">22:00 手机放客厅，23:00 上床。昨晚几点睡？</p>
          <div class="chips">${['22:30 前', '23:00', '23:30', '00:00 后'].map((x) => `<button class="chip ${d.sleep === x ? 'on' : ''}" data-sleep="${x}">${x}</button>`).join('')}</div>
          <p class="muted small-tip">起床仍然累：西宁海拔高，睡醒疲惫很常见；如果打鼾、白天困，建议查一下睡眠呼吸。</p>`,
        bind: () => $$('[data-sleep]').forEach((b) => (b.onclick = () => { const dayObj = day(t, true); dayObj.sleep = b.dataset.sleep; save(); openSheet('sleep'); renderToday(); })),
      },
      screen: {
        title: '屏幕时间', body: `
          <p class="muted">从手机“屏幕使用时间”里看一眼，今天大概多少小时？目标 ≤7 小时。</p>
          <div class="chips">${[4, 5, 6, 7, 8, 9, 10, 11, 12].map((x) => `<button class="chip ${d.screen === x ? 'on' : ''}" data-screen="${x}">${x}h</button>`).join('')}</div>
          <p class="muted small-tip">坐着刷手机的时间，改成“站着刷”或“边走边听”，同样的内容消耗多 20–30 卡/小时。</p>`,
        bind: () => $$('[data-screen]').forEach((b) => (b.onclick = () => { const dayObj = day(t, true); dayObj.screen = Number(b.dataset.screen); save(); openSheet('screen'); renderToday(); })),
      },
    };
    const m = map[kind];
    if (!m) return;
    const sheet = $('#sheet');
    sheet.innerHTML = `
      <div class="sheet-mask" data-close></div>
      <div class="sheet-body">
        <div class="sheet-head"><b>${m.title}</b><button class="x" data-close>✕</button></div>
        ${m.body}
      </div>`;
    sheet.classList.add('show');
    $$('[data-close]', sheet).forEach((b) => (b.onclick = closeSheet));
    m.bind && m.bind();
  }
  function openMeals() { openSheet('meals'); }
  function closeSheet() {
    const had = $('#sheet').classList.contains('show');
    $('#sheet').classList.remove('show'); $('#sheet').innerHTML = '';
    if (!had) return;
    // 关掉面板后，把当前这一页重新渲染，保证数据同步（原来只刷新“今日”，别的页会显示旧数据）
    if (TAB_RENDER[activeTab]) TAB_RENDER[activeTab]();
  }

  // ---------------- 页面：进度 ----------------
  let chartMetric = 'w';
  function renderProgress() {
    const elapsed = clamp(diffDays(parseYmd(CFG.startDate), new Date()) + 1, 0, CFG.totalDays);
    const cw = currentWeight();
    const lost = Math.round((CFG.startWeight - cw) * 10) / 10;
    const toGoal = Math.max(0, Math.round((cw - CFG.goalWeight) * 10) / 10);
    const pct = clamp(((CFG.startWeight - cw) / (CFG.startWeight - CFG.goalWeight)) * 100, 0, 100);
    const st = streak();
    const scored = allKeys().filter((k) => DAYS[k]);
    const avg = scored.length ? Math.round(scored.reduce((a, k) => a + habitScore(k), 0) / scored.length) : 0;

    const R = 70, C = 2 * Math.PI * R;
    const draft = C * (1 - pct / 100);
    const days = daysLeft();
    function metricValue(k) {
      const d = DAYS[k];
      if (chartMetric === 'water') return d ? waterCount(k) : null;
      if (chartMetric === 'min') return d ? (d.walkMin || (d.walk ? 20 : 0)) + (d.train ? 20 : 0) : null;
      if (chartMetric === 'snack') return d ? (d.snack || 0) : null;
      if (chartMetric === 'thigh') { const r = WEIGHTS.find((x) => x.d === k); return r && r.thigh ? r.thigh : null; }
      return d && d.w ? d.w.w : null;
    }
    const vals = allKeys().map((k) => ({ k, v: metricValue(k) })).filter((x) => x.v != null);
    const target = chartMetric === 'w' ? CFG.goalWeight : chartMetric === 'water' ? CFG.waterGoal : null;

    const html = `
      <div class="card hero">
        <div class="ring-wrap">
          <svg viewBox="0 0 180 180" class="ring">
            <circle cx="90" cy="90" r="${R}" class="ring-bg"/>
            <circle cx="90" cy="90" r="${R}" class="ring-fg green" style="stroke-dasharray:${C.toFixed(1)} ${C.toFixed(1)};stroke-dashoffset:${draft.toFixed(1)}"/>
          </svg>
          <div class="ring-center">
            <div class="ring-num">${lost >= 0 ? '-' + Math.abs(lost) : '+' + Math.abs(lost)}<span> kg</span></div>
            <div class="ring-label">已减（主要看围度，不是这个数字）</div>
            <div class="ring-score">完成度 ${Math.round(pct)}%</div>
          </div>
        </div>
        <div class="hero-side">
          <div class="hero-tip">当前 ${cw} kg · 还差 ${toGoal} kg<br>距收尾还有 ${days} 天 · 连续打卡 ${st} 天</div>
          <div class="mini-grid">
            <div><b>${elapsed}</b><span>已过天数</span></div>
            <div><b>${avg}</b><span>平均习惯分</span></div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">这周的数字</div>
        <div class="stat3">
          <div><b>${weekSummary().days}</b><span>打卡天数</span></div>
          <div><b>${weekSummary().water}</b><span>周均喝水</span></div>
          <div><b>${weekSummary().walk}</b><span>散步天数</span></div>
        </div>
        <div class="stat3" style="margin-top:8px">
          <div><b>${weekSummary().kegel}</b><span>盆底肌天数</span></div>
          <div><b>${weekSummary().train}</b><span>训练天数</span></div>
          <div><b>${cw}</b><span>当前体重</span></div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">趋势</div>
        <div class="tabs" id="chartTabs">
          ${[['w', '体重'], ['thigh', '大腿围'], ['water', '喝水'], ['min', '运动分钟'], ['snack', '零食次数']].map(([k, l]) => `<button class="tab ${chartMetric === k ? 'on' : ''}" data-metric="${k}">${l}</button>`).join('')}
        </div>
        <div class="chart-box">${chartSVG(vals, target, chartMetric)}</div>
      </div>

      <div class="card">
        <div class="card-title">阶段目标</div>
        <div class="timeline">
          ${[
            ['第 1 周', '10/19', '先喝够水、饭后散步', lost >= 0],
            ['第 3 周', '11/08', '掉到 73.5kg 以下', cw <= 73.5],
            ['第 5 周', '11/22', '掉到 72.5kg 以下', cw <= 72.5],
            ['第 8 周', '12/13', '掉到 71.5kg 以下', cw <= 71.5],
            ['收尾', '12/30', '≤70kg（10 斤）', cw <= 70],
          ].map(([wk, dt, goal, ok]) => `<div class="tl ${ok ? 'ok' : ''}"><span class="dot">${ok ? '✓' : ''}</span><div><b>${wk}</b> <span class="muted">${dt}</span><br>${goal}</div></div>`).join('')}
        </div>
      </div>

      <div class="card">
        <div class="card-title">最近 7 天</div>
        <div class="week">
          ${Array.from({ length: 7 }, (_, i) => {
            const dt = addDays(new Date(), -(6 - i)); const k = ymd(dt); const d = DAYS[k];
            const s = habitScore(k);
            const done = d && (waterCount(k) > 0 || d.walk || protein(k) > 0);
            const color = !d ? 'empty' : s >= 70 ? 'good' : s >= 40 ? 'mid' : 'bad';
            return `<div class="wd ${color}"><span class="wd-d">${dt.getMonth() + 1}/${dt.getDate()}</span><span class="wd-s">${d ? s : (done ? '·' : '')}</span><span class="wd-w">${WEEK_CN[dt.getDay()].slice(1)}</span></div>`;
          }).join('')}
        </div>
        <div class="muted small-tip">格子里的数字是当天的“习惯分”（喝水 40 分 + 蛋白 15 + 散步 15 + 训练 15 + 睡眠 10 + 屏幕 5）。</div>
      </div>

      <div class="card">
        <div class="card-title">每周六 · 量围度 <span class="muted">比体重重要</span></div>
        <div class="week-inputs">
          <input class="input" id="wInput" type="number" step="0.1" placeholder="体重 kg" value="${weekInput('w')}">
          <input class="input" id="waistInput" type="number" step="0.5" placeholder="腰围 cm" value="${weekInput('waist')}">
          <input class="input" id="hipInput" type="number" step="0.5" placeholder="臀围 cm" value="${weekInput('hip')}">
        </div>
        <div class="week-inputs" style="margin-top:8px">
          <input class="input" id="thighInput" type="number" step="0.5" placeholder="大腿围 cm" value="${weekInput('thigh')}">
        </div>
        <div class="row"><button class="btn primary" id="saveWeek">保存本周测量</button></div>
        <div class="muted small-tip"><b>大腿围</b>是她的主要指标：量大腿最粗处（大腿根下方 3–5cm）。围度在掉、体重不动，是好事不是停滞。</div>
        <div class="muted small-tip">量围度都按同一位置、同一天、早上空腹。别在经期量——会肿 1–2cm。</div>
        <div class="history">${WEIGHTS.filter((x) => x.w).slice(-8).reverse().map((x) => `<div class="h-row"><span>${x.d.slice(5)}</span><span>${x.w} kg</span><span>${x.waist ? '腰 ' + x.waist : ''} ${x.hip ? '臀 ' + x.hip : ''} ${x.thigh ? '腿 ' + x.thigh : ''}</span></div>`).join('') || '<div class="muted">还没有记录</div>'}</div>
      </div>

      <div class="card">
        <button class="btn danger-outline" id="export">导出备份数据（JSON）</button>
        <label class="btn ghost file-btn">导入备份<input type="file" id="importFile" accept="application/json" hidden></label>
        <button class="btn ghost" id="clearAll">清空所有数据</button>
      </div>
    `;
    $('#progress').innerHTML = html;
    $$('#chartTabs .tab').forEach((b) => (b.onclick = () => { chartMetric = b.dataset.metric; renderProgress(); }));
    $('#saveWeek').onclick = () => {
      const w = parseFloat($('#wInput').value), waist = parseFloat($('#waistInput').value), hip = parseFloat($('#hipInput').value);
      const thighEl = $('#thighInput');
      const thigh = thighEl ? parseFloat(thighEl.value) : NaN;
      if (!isFinite(w)) return toast('请先填体重');
      const t = today();
      const dayObj = day(t, true); dayObj.w = { w: Math.round(w * 10) / 10 };
      let rec = WEIGHTS.find((x) => x.d === t);
      if (!rec) { rec = { d: t }; WEIGHTS.push(rec); }
      rec.w = Math.round(w * 10) / 10;
      rec.waist = isFinite(waist) ? waist : rec.waist || null;
      rec.hip = isFinite(hip) ? hip : rec.hip || null;
      rec.thigh = isFinite(thigh) ? thigh : rec.thigh || null;
      save(); toast('本周测量已保存'); renderProgress(); renderToday();
    };
    $('#export').onclick = () => {
      const data = { app: 'jiansu', v: 1, days: DAYS, weights: WEIGHTS, settings: SETTINGS };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `减脂打卡备份-${today()}.json`; a.click();
      toast('备份已导出');
    };
    $('#importFile').onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      const fr = new FileReader();
      fr.onload = () => {
        try {
          const data = JSON.parse(fr.result);
          if (!data.days) throw new Error('格式不对');
          DAYS = data.days; WEIGHTS = data.weights || []; SETTINGS = Object.assign(SETTINGS, data.settings || {});
          save(); toast('导入成功'); renderToday(); renderProgress();
        } catch (err) { toast('导入失败：文件格式不对'); }
      };
      fr.readAsText(f);
    };
    $('#clearAll').onclick = () => {
      if (!confirm('确定清空所有记录？建议先导出备份。')) return;
      DAYS = {}; WEIGHTS = []; save(); renderToday(); renderProgress(); toast('已清空');
    };
  }
  function weekInput(field) {
    const rec = WEIGHTS.find((x) => x.d === today()) || [];
    const v = rec[field];
    return v == null ? '' : v;
  }
  function chartSVG(vals, target, metric) {
    const W = 360, H = 170, P = { l: 34, r: 10, t: 14, b: 22 };
    if (!vals.length) return `<div class="chart-empty">还没有数据。<br>今天先点一次打卡，这里就会有线了。</div>`;
    const xs = vals.map((v) => dayIndex(v.k));
    const ys = vals.map((v) => v.v);
    let lo = Math.min(...ys, target != null ? target : Infinity);
    let hi = Math.max(...ys, target != null ? target : -Infinity);
    if (hi - lo < 1) { hi += 0.5; lo -= 0.5; }
    const padY = (hi - lo) * 0.12; lo -= padY; hi += padY;
    const first = Math.min(...xs), last = Math.max(...xs, CFG.totalDays - 1);
    const X = (i) => P.l + ((i - 0) / (CFG.totalDays - 1)) * (W - P.l - P.r);
    const Y = (v) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);
    const pts = vals.map((v) => `${X(dayIndex(v.k)).toFixed(1)},${Y(v.v).toFixed(1)}`).join(' ');
    const ticks = [lo + (hi - lo) * 0.15, (lo + hi) / 2, hi - (hi - lo) * 0.15];
    const yt = ticks.map((v) => `<text x="${P.l - 5}" y="${(Y(v) + 3).toFixed(1)}" class="ax">${Math.round(v * 10) / 10}</text>`).join('');
    const targetLine = target != null ? `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(target).toFixed(1)}" y2="${Y(target).toFixed(1)}" class="target-line"/><text x="${W - P.r}" y="${(Y(target) - 4).toFixed(1)}" class="ax teal right">目标 ${target}</text>` : '';
    const dots = vals.slice(-30).map((v) => `<circle cx="${X(dayIndex(v.k)).toFixed(1)}" cy="${Y(v.v).toFixed(1)}" r="2.6" class="dotc"/>`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" class="chart">
      ${yt}${targetLine}
      <polyline points="${pts}" class="line"/>
      ${dots}
      <text x="${P.l}" y="${H - 4}" class="ax">${parseYmd(CFG.startDate).getMonth() + 1}/${parseYmd(CFG.startDate).getDate()}</text>
      <text x="${W - P.r}" y="${H - 4}" class="ax right">${PLAN_END.getMonth() + 1}/${PLAN_END.getDate()}</text>
    </svg>`;
  }

  // ================================================================
  //  页面：计划 —— 只读。今天要做的事在「今天」页，这里只放“怎么做”。
  // ================================================================
  function renderPlan() {
    const t = today(); const d = DAYS[t] || {};
    const routine = routineFor(t);

    const html = `
      ${FROM_TAB === 'today' ? `<button class="btn ghost back-bar" id="backToToday">‹ 返回今天（刚才的位置）</button>` : ''}
      <div class="card routine-card">
        <div class="card-title">今天建议练 <span class="muted">按星期自动排</span></div>
        <div class="routine-name">${esc(routine.name)}</div>
        <div class="routine-why">${esc(routine.why)}</div>
        <button class="btn primary" id="startToday" style="width:100%;margin-top:12px">▶ 开始跟练（一步步带你做）</button>
      </div>

      <div class="card">
        <div class="card-title">所有训练 <span class="muted">点开看动作 / 单独跟练</span></div>
        <div class="tabs" id="trainTabs">
          <button class="tab" data-traink="A">塑形A·臀腿</button>
          <button class="tab" data-traink="B">塑形B·骨盆</button>
          <button class="tab" data-traink="C">舒展·久坐</button>
          <button class="tab" data-traink="E">盆底肌</button>
          <button class="tab" data-traink="D">走路·轻有氧</button>
          <button class="tab" data-traink="F">大腿内侧</button>
        </div>
        <div id="trainTip" class="muted small-tip"></div>
        <div id="trainList"></div>
        <div class="muted small-tip">这里只是“看”和“跟练”。练完的打卡会自动记到「今天」页。</div>
      </div>

      <div class="card">
        <div class="card-title">久坐怎么破 <span class="muted">顺手就能做</span></div>
        <ul class="bullets">
          <li>车停远 200–300 米，走过去 = 每天多走 600 步。</li>
          <li>刷手机改“站着刷”或“边走边听”，同样内容多消耗 30–50 卡。</li>
          <li>每小时起身 30 秒：接水、上厕所、走廊一圈。</li>
          <li>想练腿就在垫上做，别爬楼——她膝盖有旧伤。</li>
        </ul>
      </div>
    `;
    $('#plan').innerHTML = html;
    const idx = Object.keys(TRAIN).indexOf(routine.key);
    const first = $$('#trainTabs .tab')[idx >= 0 ? idx : 0];
    if (first) { first.classList.add('on'); renderTrain(routine.key); }
    $$('#trainTabs .tab').forEach((b) => (b.onclick = () => {
      $$('#trainTabs .tab').forEach((x) => x.classList.toggle('on', x === b));
      renderTrain(b.dataset.traink);
    }));
    const st = $('#startToday');
    if (st) st.onclick = () => startGuide(routine.key);
    const back = $('#backToToday');
    if (back) back.onclick = () => { FROM_TAB = null; switchTab('today'); };
  }
  // 训练目录：items = [动作, 组次, 怎么做, 向导秒数]
  // 原则：不跑、不跳、不爬楼（她爬山心慌 + 膝盖有旧伤），全部垫上或站姿轻训练。
  const TRAIN = {
    A: {
      name: '塑形A · 臀腿（假胯宽重点）', tip: '20 分钟，瑜伽垫上做。核心是练臀中肌 + 放松大腿内侧，不是练到腿酸。',
      items: [
        ['蚌式开合', '3 组 × 15 次/侧', '侧躺，膝盖弯 90°，脚跟并拢，像蚌壳一样把上侧膝盖打开。屁股外侧发力，不是用腰', 60],
        ['侧躺抬腿', '3 组 × 12 次/侧', '侧躺，下侧腿微弯，上侧腿伸直慢慢抬起到 45°，脚尖朝前不要朝上', 60],
        ['臀桥', '3 组 × 15 次', '仰卧屈膝，屁股夹紧抬起，最高点停 2 秒。她是练臀不是练腰，起来时腰别塌', 50],
        ['单腿臀桥', '2 组 × 10 次/侧', '一只脚抬起，另一只脚踩地顶起；不稳就先做双腿', 60],
        ['靠墙静蹲', '3 组 × 20 秒', '背贴墙，膝盖弯 60° 左右，膝盖不过脚尖。护膝又练腿，不伤关节', 30],
        ['大腿内侧放松', '每侧 60 秒', '坐姿脚心相对（蝴蝶式），膝盖自然下沉，别硬压', 120],
      ],
    },
    B: {
      name: '塑形B · 骨盆与核心', tip: '20 分钟。她跷二郎腿说明髋内旋、骨盆不稳，这套专门纠正。',
      items: [
        ['臀中肌侧抬（站姿）', '3 组 × 15 次/侧', '扶墙站立，一条腿向侧面抬起，身体别歪。这是假胯宽的核心动作', 60],
        ['蚌式（弹力带）', '3 组 × 15 次/侧', '膝盖上方套弹力带，打开时对抗阻力，慢开慢合', 60],
        ['死虫式', '3 组 × 10 次/侧', '仰卧，对侧手脚缓慢伸远，腰始终贴地。练核心不伤腰', 60],
        ['鸟狗式', '3 组 × 10 次/侧', '四点跪，对侧手腿同时伸出，腰不晃', 60],
        ['臀桥保持', '3 组 × 20 秒', '桥式顶起后停住，屁股一直夹紧', 30],
        ['髋屈肌拉伸', '每侧 45 秒', '弓步跪姿，后腿髋部往前送。久坐的人这里最紧', 90],
      ],
    },
    C: {
      name: '舒展 · 久坐酸痛', tip: '15 分钟，全是拉伸和放松。腰酸、腿胀、肩颈硬的时候做这套。',
      items: [
        ['猫牛式', '10 次', '四点跪，吸气塌腰抬头，呼气拱背低头，跟着呼吸慢慢来', 90],
        ['婴儿式', '60 秒', '跪坐，上身趴下去，手臂前伸，放松腰背', 60],
        ['仰卧扭转', '每侧 60 秒', '仰卧屈膝倒向一侧，头转向另一侧，肩膀贴地', 120],
        ['靠墙小腿拉伸', '每侧 45 秒', '脚跟踩地，身体前倾，感受小腿后侧拉开', 90],
        ['蝴蝶式', '90 秒', '脚心相对坐着，膝盖自然下沉，上身慢慢前倾', 90],
        ['颈侧拉伸', '每侧 30 秒', '手轻扶头部侧面，耳朵靠向肩膀，另一侧肩膀下沉', 60],
      ],
    },
    D: {
      name: '走路 · 轻有氧', tip: '不喘的走。她爬山会心慌，所以强度控制在“能正常说话”。',
      items: [
        ['午饭后走 10 分钟', '每天', '不用走快，走够时间就行', 600],
        ['晚饭后走 15 分钟', '每天', '能说话的速度，心率别飙', 900],
        ['周末慢走 30–40 分钟', '每周 1–2 次', '平地优先，别爬坡。感觉心慌就停下来站着歇', 1800],
      ],
    },
    E: {
      name: '盆底肌 · 女性版', tip: '盆底肌不是只有产后才练。她久坐 + 跷二郎腿，盆底容易松。每天 3 轮。',
      items: [
        ['找到盆底肌', '1 次', '想象“憋尿 + 提肛”，或想象电梯从 1 楼升到 3 楼。肚子、大腿、屁股都不能动', 60],
        ['快速收缩', '10 次', '收 1 秒、放 1 秒，快收快放', 30],
        ['持续收缩', '10 次', '收住 5 秒、放松 5 秒，全程正常呼吸', 90],
        ['配合呼吸的慢收', '10 次', '吸气放松、呼气收紧', 90],
      ],
    },
    F: {
      name: '大腿内侧 · 专项', tip: '10 分钟。她大腿内侧松软、走路磨腿，这套专门收紧内侧。',
      items: [
        ['侧卧内收抬腿', '3 组 × 12 次/侧', '侧躺，上侧腿屈膝踩在身前，下侧腿伸直慢慢抬起。大腿内侧发力', 60],
        ['夹枕头', '3 组 × 15 次', '仰卧屈膝，膝盖间夹一个枕头，用力夹紧 2 秒再放松', 45],
        ['宽距深蹲（扶椅）', '3 组 × 12 次', '双脚比肩宽，脚尖外展 30°，慢慢下蹲。膝盖别内扣', 50],
        ['蝴蝶式抖动', '90 秒', '脚心相对坐着，双手扶膝轻轻上下抖动，放松内侧', 90],
        ['拉伸内侧', '每侧 45 秒', '坐姿双腿打开，身体慢慢向一侧腿前倾', 90],
      ],
    },
  };
  const KEGEL_GOAL = 3; // 每天 3 轮

  function trainProgress(key) {
    const d = DAYS[today()] || {};
    if (key === 'E') {
      const n = (d.kegel || 0);
      return { done: n >= (SETTINGS.kegelDaily || KEGEL_GOAL) || !!d.kegelDone, text: `${n}/${SETTINGS.kegelDaily || KEGEL_GOAL} 轮` };
    }
    if (key === 'D') return { done: !!d.walk, text: d.walk ? '已走' : '待走' };
    const sets = d['sets_' + key] || 0;
    const total = TRAIN[key].items.length;
    return { done: !!d['done_' + key], text: `${sets}/${total} 个动作` };
  }

  function renderTrain(k) {
    if (!TRAIN[k]) k = 'A';
    const cfg = TRAIN[k];
    const d = DAYS[today()] || {};
    const tip = $('#trainTip');
    if (tip) tip.textContent = cfg.tip;

    if (k === 'E') {
      const n = d.kegel || 0;
      const goal = SETTINGS.kegelDaily || KEGEL_GOAL;
      $('#trainList').innerHTML = `
        <div class="steps-box" style="margin-top:4px">
          <div class="sb-t">找到那块肌肉</div>
          <p class="muted">想象“憋尿 + 提肛”，或想象电梯从 1 楼升到 3 楼。收紧时肚子、大腿、屁股都不能动，也不能憋气。</p>
          <div class="sb-t" style="margin-top:10px">一轮这么做（约 2 分钟）</div>
          <ol>
            <li><b>快速收缩</b>：收 1 秒、放 1 秒，做 10 次</li>
            <li><b>持续收缩</b>：收住 5 秒、放松 5 秒，做 10 次</li>
            <li>全程正常呼吸，做完放松</li>
          </ol>
        </div>
        <div class="kegel" style="margin-top:14px">
          <div class="kegel-num">${n}<span>/${goal} 轮</span></div>
          <div class="kegel-dots">${Array.from({ length: goal }, (_, i) => `<span class="kdot ${i < n ? 'on' : ''}"></span>`).join('')}</div>
          <button class="btn primary" id="kegelAdd">完成一轮（约 2 分钟）</button>
          ${n > 0 ? '<button class="btn ghost" id="kegelMinus" style="width:100%;margin-top:8px">－ 点错了，撤掉一轮</button>' : ''}
        </div>
        <div class="warn">别在真正上厕所时练——会导致尿不干净、增加感染风险。坐着、躺着、等红灯都能练。</div>`;
      $('#kegelAdd').onclick = () => {
        const dayObj = day(today(), true);
        dayObj.kegel = (dayObj.kegel || 0) + 1;
        if (dayObj.kegel >= goal) { dayObj.kegelDone = true; buzz(); toast('今天凯格尔做完了 ✓'); }
        save(); renderTrain('E'); renderToday();
      };
      const kgMinus = $('#kegelMinus');
      if (kgMinus) kgMinus.onclick = () => {
        const dayObj = day(today(), true);
        dayObj.kegel = Math.max(0, (dayObj.kegel || 0) - 1);
        dayObj.kegelDone = (dayObj.kegel || 0) >= goal;
        save(); renderTrain('E'); renderToday(); buzz(); toast(`已撤销一轮（${dayObj.kegel}/${goal}）`);
      };
      return;
    }

    if (k === 'D') {
      const done = !!d.walk;
      $('#trainList').innerHTML = `
        <div class="tr-row"><div class="pl-title">今天走路打卡</div></div>
        ${cfg.items.map(([a, b, c]) => `<div class="tr-row"><div><div class="pl-title">${a}</div><div class="pl-why">${b} · ${c}</div></div></div>`).join('')}
        <button class="btn ${done ? 'ghost' : 'primary'}" id="walkDone">${done ? '✓ 今天已走过' : '今天走够了，打卡'}</button>`;
      $('#walkDone').onclick = () => {
        const dayObj = day(today(), true); dayObj.walk = !dayObj.walk; save(); renderTrain('D'); renderToday();
        if (dayObj.walk) { buzz(); toast('走路打卡完成 👍'); }
      };
      return;
    }

    const sets = d['sets_' + k] || 0;
    const body = cfg.items.map(([a, b, c], i) => `
      <div class="tr-row">
        <button class="tr-check ${sets > i ? 'on' : ''}" data-setidx="${i}">${sets > i ? '✓' : i + 1}</button>
        <div><div class="pl-title">${a}</div><div class="pl-why">${b} · ${c}</div></div>
      </div>`).join('');
    const doneAll = !!d['done_' + k];
    const told = (SETTINGS.trainTipShown || {})[k];
    $('#trainList').innerHTML = body
      + `<div class="coach-row"><button class="btn coach" id="guideBtn">▶ 开始跟练（一步一步带你做）</button></div>`
      + `<button class="btn ${doneAll ? 'ghost' : 'primary'}" id="trainDone">${doneAll ? '✓ 这套今天已练完' : '整套做完，打卡'}</button>`
      + (told ? '' : `<div class="muted small-tip">第一次做？点“开始跟练”，它会一个动作一个动作带你做完。</div>`);
    $$('#trainList [data-setidx]').forEach((b) => (b.onclick = () => {
      const dayObj = day(today(), true); const i = Number(b.dataset.setidx);
      dayObj['sets_' + k] = dayObj['sets_' + k] === i + 1 ? i : i + 1;
      save(); renderTrain(k);
    }));
    $('#trainDone').onclick = () => {
      const dayObj = day(today(), true);
      dayObj['done_' + k] = !dayObj['done_' + k];
      if (dayObj['done_' + k]) {
        dayObj.train = true; dayObj.trainKind = k;
        buzz(); toast(`${cfg.name} 完成 💪`);
      } else if (!['A', 'B', 'C', 'E'].some((x) => dayObj['done_' + x])) {
        dayObj.train = false;
      }
      save(); renderTrain(k); renderToday();
    };
    const gb = $('#guideBtn');
    if (gb) gb.onclick = () => startGuide(k);
  }

  // ---------------- 跟练向导：一步一步计时带你做 ----------------
  let GUIDE = null, GUIDE_TIMER = null;
  function startGuide(k) {
    if (k === 'E') { switchTab('body'); return; }
    GUIDE = { k, idx: 0, left: trainerSecs(k, 0), running: false };
    renderGuide();
    GUIDE.running = true;
    scheduleGuideTick();
  }
  function trainerSecs(k, i) {
    const it = TRAIN[k].items[i];
    return (it && it[3]) || 45;
  }
  function scheduleGuideTick() {
    clearInterval(GUIDE_TIMER);
    GUIDE_TIMER = setInterval(() => {
      if (!GUIDE || !GUIDE.running) return;
      GUIDE.left -= 1;
      if (GUIDE.left <= 0) {
        // 这一项时间到
        const k = GUIDE.k; const i = GUIDE.idx;
        const dayObj = day(today(), true);
        dayObj['sets_' + k] = Math.max(dayObj['sets_' + k] || 0, i + 1);
        save();
        beep(); buzz();
        if (i + 1 >= TRAIN[k].items.length) {
          // 全部做完
          dayObj['done_' + k] = true; dayObj.train = true; dayObj.trainKind = k;
          save();
          clearInterval(GUIDE_TIMER); GUIDE = null;
          closeGuide();
          renderTrain(k); renderToday();
          toast('整套做完了，已自动打卡 🎉');
          switchTab('today');
          return;
        }
        GUIDE.idx = i + 1;
        GUIDE.left = trainerSecs(k, GUIDE.idx);
        GUIDE.running = false;
        renderGuide();
        return;
      }
      updateGuideClock();
    }, 1000);
  }
  function renderGuide() {
    if (!GUIDE) return;
    const k = GUIDE.k; const cfg = TRAIN[k]; const it = cfg.items[GUIDE.idx];
    const total = cfg.items.length;
    const el = $('#guide');
    el.innerHTML = `
      <div class="guide-wrap">
        <div class="guide-top">
          <span class="guide-name">${esc(cfg.name)}</span>
          <span class="guide-step">第 ${GUIDE.idx + 1} / ${total} 个动作</span>
          <button class="x" id="guideClose">✕</button>
        </div>
        <div class="guide-prog"><i style="width:${Math.round(((GUIDE.idx) / total) * 100)}%"></i></div>
        <div class="guide-act">${esc(it[0])}</div>
        <div class="guide-set">${esc(it[1])}</div>
        <div class="guide-how">${esc(it[2])}</div>
        <div class="guide-clock" id="guideClock">${fmtLeft(GUIDE.left)}</div>
        <div class="guide-btns">
          <button class="btn ghost" id="guidePrev">上一个</button>
          <button class="btn primary" id="guideNext">${GUIDE.idx + 1 >= total ? '完成整套' : '做完了，下一个'}</button>
        </div>
        <div class="guide-tip">${GUIDE.running ? '计时中…跟着做就好，做完点“下一个”' : '准备好了就点“下一个”，或直接开始计时'}</div>
      </div>`;
    el.classList.add('show');
    $('#guideClose').onclick = () => { clearInterval(GUIDE_TIMER); GUIDE = null; closeGuide(); };
    $('#guideNext').onclick = () => guideNext();
    $('#guidePrev').onclick = () => {
      if (GUIDE.idx > 0) { GUIDE.idx -= 1; GUIDE.left = trainerSecs(k, GUIDE.idx); GUIDE.running = false; renderGuide(); }
    };
  }
  function guideNext() {
    if (!GUIDE) return;
    const k = GUIDE.k; const i = GUIDE.idx;
    const dayObj = day(today(), true);
    dayObj['sets_' + k] = Math.max(dayObj['sets_' + k] || 0, i + 1);
    save(); beep(); buzz();
    if (i + 1 >= TRAIN[k].items.length) {
      dayObj['done_' + k] = true; dayObj.train = true; dayObj.trainKind = k;
      save(); clearInterval(GUIDE_TIMER); GUIDE = null; closeGuide();
      renderTrain(k); renderToday(); toast('整套做完了，已自动打卡 🎉'); switchTab('today');
      return;
    }
    GUIDE.idx = i + 1; GUIDE.left = trainerSecs(k, GUIDE.idx); GUIDE.running = false; renderGuide();
  }
  function updateGuideClock() {
    const c = $('#guideClock');
    if (c && GUIDE) c.textContent = fmtLeft(GUIDE.left);
  }
  function fmtLeft(s) { const m = Math.floor(Math.max(0, s) / 60); const ss = Math.max(0, s) % 60; return `${m}:${String(ss).padStart(2, '0')}`; }
  function closeGuide() { const el = $('#guide'); if (el) { el.classList.remove('show'); el.innerHTML = ''; } }

  // ---------------- 每日菜单（女性版：补铁、无乳糖、控糖，按星期轮换） ----------------
  // 注意：她乳糖不耐 → 奶类全部换成无糖酸奶/无乳糖奶/豆浆；
  // 她可能缺铁 → 每天至少 1 餐红肉或动物肝，并配维 C。
  const MENU = {
    1: { // 周一
      b: '无糖豆浆 300ml + 煮鸡蛋 2 个 + 杂粮馒头 1 个 + 半个橙子',
      l: '米饭 1 小碗 + 番茄炒蛋（2 个蛋）+ 清炒油麦菜',
      d: '米饭半碗 + 清蒸鱼 150g + 蒜蓉菠菜',
      tip: '周一最忙。菠菜 + 橙子是补铁组合，橙子的维 C 能让菠菜里的铁多吸收一倍。',
    },
    2: {
      b: '无糖酸奶 150g + 燕麦 40g + 煮鸡蛋 1 个 + 猕猴桃 1 个',
      l: '荞麦面 1 碗 + 卤牛肉 100g + 凉拌黄瓜',
      d: '小米粥 + 卤鸡腿（去皮）1 个 + 白灼上海青',
      tip: '酸奶代替牛奶（乳糖不耐）。牛肉是补铁最好的日常食物，每周至少 2 次。',
    },
    3: {
      b: '无糖豆浆 300ml + 玉米 1 根 + 煮鸡蛋 2 个',
      l: '米饭 1 小碗 + 青椒炒鸡胸（150g）+ 西红柿蛋汤',
      d: '米饭半碗 + 白灼虾 150g + 清炒西蓝花',
      tip: '鸡胸补铁不如红肉，所以今天午餐配了西红柿（维 C），晚餐虾补蛋白。',
    },
    4: {
      b: '牛肉面 1 碗（面减半、多要萝卜和牛肉、汤不喝完）',
      l: '米饭 1 小碗 + 冬瓜炖排骨（吃瘦的）+ 炒时蔬',
      d: '荞麦面半碗 + 番茄鸡蛋 + 一大份青菜',
      tip: '西宁人的早餐。牛肉面正好补铁，但面要减半、汤别喝完（盐多）。',
    },
    5: {
      b: '无糖酸奶 150g + 全麦面包 2 片 + 煮鸡蛋 1 个',
      l: '米饭 1 小碗 + 瘦牛肉炒芹菜 + 萝卜汤',
      d: '米饭半碗 + 香菇滑鸡 + 蒜蓉生菜',
      tip: '一周两次红肉打底。牛肉选瘦的，炒的时候少油。',
    },
    6: {
      b: '无糖豆浆 300ml + 荞麦馒头 1 个 + 煮鸡蛋 2 个 + 小番茄',
      l: '米饭 1 小碗 + 麻婆豆腐（少油）+ 清炒菜心',
      d: '杂粮粥 + 凉拌牛肉 100g + 凉拌菠菜',
      tip: '周末在家做饭，把下周的肉分装冷冻，省得临时点外卖。',
    },
    7: {
      b: '无糖酸奶 150g + 玉米 1 根 + 煮鸡蛋 1 个 + 核桃 2 个',
      l: '米饭 1 小碗 + 红烧鸡块（少糖少油）+ 清炒时蔬',
      d: '米饭半碗 + 清蒸鱼 + 蒜蓉油麦菜 + 紫菜蛋花汤',
      tip: '周日晚上把这周要吃的菜买齐，冰箱有菜就不会乱吃。',
    },
  };
  function todayMenu() {
    const dow = new Date(today() + 'T00:00:00').getDay(); // 0=周日
    return MENU[dow === 0 ? 7 : dow];
  }

  // ---------------- 周期（经期）模块 ----------------
  // 记录最近一次月经开始日 + 周期长度，自动推算经期、易疲劳期。
  function periodInfo() {
    const p = SETTINGS.period || null;
    if (!p || !p.lastStart) return null;
    const len = p.cycleLen || 28;
    const last = parseYmd(p.lastStart);
    const todayD = parseYmd(today());
    const since = diffDays(last, todayD);
    if (since < 0) return null;
    const day = (since % len) + 1;          // 周期第几天
    const luteral = len - 14;               // 黄体期开始
    const phase = day <= 5 ? '经期' : day <= luteral ? '卵泡期' : '黄体期';
    return { day, len, phase, since };
  }
  function phaseNote() {
    const p = periodInfo();
    if (!p) return { show: false };
    if (p.phase === '经期') {
      return {
        show: true, cls: 'phase-period', title: `经期 · 第 ${p.day} 天`,
        body: '这几天：训练改「舒展」或直接休息，不练臀腿；<b>补铁</b>（红肉、猪肝、菠菜 + 维 C）；<b>热敷</b>小腹；想躺着就躺着，别硬练。',
      };
    }
    if (p.phase === '黄体期') {
      return {
        show: true, cls: 'phase-luteal', title: `黄体期 · 第 ${p.day} 天`,
        body: '这两天容易<b>水肿、嘴馋、累</b>，秤上重 1–2 斤是水不是胖。<b>别称体重</b>；想吃甜的就吃水果或无糖酸奶；训练降一档。',
      };
    }
    return {
      show: true, cls: 'phase-follicular', title: `卵泡期 · 第 ${p.day} 天`,
      body: '这个阶段体力最好、掉秤最快，**最适合加一点训练强度**。好好吃蛋白，多补水。',
    };
  }

  // ---------------- 页面：教练（今天该干什么，一条一条） ----------------
  function coachTasks() {
    const t = today(); const d = DAYS[t] || {};
    const wc = waterCount(t); const p = protein(t);
    const goal = SETTINGS.kegelDaily || 3;
    const now = new Date(); const nowMin = now.getHours() * 60 + now.getMinutes();
    const at = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
    const menu = todayMenu();
    const per = periodInfo();
    const isPeriod = per && per.phase === '经期';
    const routine = routineFor(t);
    const list = [
      { id: 'water8', at: '08:00', title: '起床，喝第一杯温水', detail: '先喝水再开窗帘，别一睁眼就刷手机。', done: wc >= 1, goto: 'water' },
      { id: 'b', at: '09:00', title: '早餐：' + menu.b, detail: '豆浆/酸奶选无糖的，她是乳糖不耐，牛奶会胀气。', done: !!(d.meals && d.meals.b), goto: 'meals' },
      { id: 'iron', at: '09:20', title: '补铁搭配', detail: '配一个猕猴桃、橙子或半个西红柿——维 C 能让铁多吸收一倍。', done: d.ironDone === true, goto: 'meals' },
      { id: 'water10', at: '10:00', title: '第 2 杯水', detail: '现在放下手机，去接一杯。', done: wc >= 2, goto: 'water' },
      { id: 'water11', at: '11:00', title: '第 3 杯水', detail: '喝完这杯，午饭前不喝奶茶。', done: wc >= 3, goto: 'water' },
      { id: 'water1130', at: '11:30', title: '第 4 杯水（饭前）', detail: '饭前半小时喝完，午饭自然少吃。', done: wc >= 4, goto: 'water' },
      { id: 'l', at: '12:00', title: '午餐：' + menu.l, detail: '先菜 → 再肉 → 后饭，米饭一小碗。', done: !!(d.meals && d.meals.l), goto: 'meals' },
      { id: 'walk1', at: '12:30', title: '饭后走 10 分钟', detail: '不用走快，能说话的速度就行。', done: !!d.walk, goto: 'move' },
      { id: 'sit', at: '14:00', title: '起来动一动（别跷二郎腿）', detail: '站起来 30 秒，接水/上厕所/走廊一圈。坐着时双脚踩平地面。', done: d.sitBreaks > 0, goto: 'today' },
      { id: 'water1430', at: '14:30', title: '加餐 + 第 5 杯水', detail: '想吃甜的：无糖酸奶 + 水果。奶茶换成无糖茶。', done: wc >= 5, goto: 'water' },
      { id: 'water16', at: '16:00', title: '第 6 杯水（淡茶也行）', detail: '不加糖，别用奶茶凑数。', done: wc >= 6, goto: 'water' },
      { id: 'water1730', at: '17:30', title: '第 7 杯水', detail: '下班前喝完，别拖到晚上。', done: wc >= 7, goto: 'water' },
      { id: 'snack', at: '18:30', title: '零食记账', detail: '今天吃了几次甜的？想吃时先喝水 + 刷牙，还想吃再记。', done: d.snackLogged === true, goto: 'snack' },
      { id: 'd', at: '19:00', title: '晚餐：' + menu.d, detail: '米饭半碗，先菜后肉再饭；19:30 前离桌。', done: !!(d.meals && d.meals.d), goto: 'meals' },
      { id: 'walk2', at: '19:40', title: '晚饭后走 15 分钟', detail: '能说话的速度，不要喘。', done: !!d.walk, goto: 'move' },
      { id: 'train', at: '20:20', title: '训练：' + (isPeriod ? '经期改「舒展」' : routine.name), detail: isPeriod ? '经期这几天不练臀腿，做舒展或休息。' : routine.why, done: !!d.train, goto: 'train' },
      { id: 'kegel', at: '20:50', title: `盆底肌 ${goal} 轮`, detail: '收 1 秒放 1 秒 ×10，再收 5 秒放 5 秒 ×10。坐着就能做。', done: (d.kegel || 0) >= goal, goto: 'kegel' },
      { id: 'water21', at: '21:00', title: '第 8 杯水 · 厨房关门', detail: '21:00 以后不再吃正餐。', done: wc >= 8, goto: 'water' },
      { id: 'closed', at: '21:30', title: '刷牙，今天不再进食', detail: '想吃就喝水、离开厨房。', done: !!d.closed, goto: 'closed' },
      { id: 'screen', at: '22:00', title: '手机放到客厅充电', detail: '刷剧 1 小时是甜食的高危时段。', done: d.screen != null && d.screen <= 7, goto: 'screen' },
      { id: 'sleep', at: '23:00', title: '上床睡觉', detail: '她早上起不来，先把上床时间稳住。', done: d.sleep === '准时' || d.sleep === '23:00', goto: 'sleep' },
    ];
    for (const x of list) {
      const m = at(x.at);
      x.overdue = !x.done && nowMin > m + 30;
    }
    return list;
  }
  // 今天是哪套训练：周三舒展、周日走路；经期统一改舒展
  function routineFor(key) {
    const per = periodInfo();
    if (per && per.phase === '经期') {
      return { key: 'C', name: '经期 · 舒展放松', why: '经期不练臀腿、不练核心。做舒展或直接休息，热敷小腹。' };
    }
    const dow = new Date(key + 'T00:00:00').getDay();
    if (dow === 3) return { key: 'C', name: '舒展 · 久坐酸痛', why: '周三专门放松：腰酸、腿胀、肩颈硬的时候做这套。' };
    if (dow === 0) return { key: 'D', name: '走路 · 轻有氧', why: '休息日也要动：慢走 30–40 分钟，平地，别爬坡。' };
    if (dow === 5) return { key: 'F', name: '大腿内侧专项 10 分钟', why: '周五专攻大腿内侧，走路磨腿、内侧松软就练这个。' };
    const week = dayIndex(key) >= 0 ? Math.floor(dayIndex(key) / 7) : 0;
    const order = week < 2 ? ['E', 'A', 'C', 'B', 'F', 'C', 'D'] : ['A', 'E', 'B', 'F', 'A', 'C', 'D'];
    const k = order[dow === 0 ? 6 : dow - 1];
    const whyMap = {
      A: '塑形A 臀腿 20 分钟：练臀中肌 + 放松大腿内侧，专治假胯宽。',
      B: '塑形B 骨盆核心 20 分钟：纠正跷二郎腿带来的髋内旋。',
      C: '舒展 15 分钟：全是拉伸，腰酸腿胀的时候做。',
      D: '慢走 30 分钟：平地，不要爬坡，心慌就停下站着歇。',
      E: '盆底肌 3 轮：每天都能做，坐着躺着都行。',
      F: '大腿内侧专项 10 分钟：收紧内侧，改善走路磨腿。',
    };
    return { key: k, name: TRAIN[k].name, why: whyMap[k] };
  }
  function weekSummary() {
    let days = 0, waterSum = 0, waterDays = 0, walk = 0, kegel = 0, train = 0;
    const goal = SETTINGS.kegelDaily || 3;
    for (let i = 0; i < 7; i++) {
      const k = ymd(addDays(new Date(), -i));
      const d = DAYS[k];
      if (!d) continue;
      if (waterCount(k) > 0 || d.walk || (d.meals && Object.values(d.meals).some(Boolean))) days += 1;
      if (waterCount(k) > 0) { waterSum += waterCount(k); waterDays += 1; }
      if (d.walk) walk += 1;
      if ((d.kegel || 0) >= goal || d.kegelDone) kegel += 1;
      if (d.train) train += 1;
    }
    return { days, water: waterDays ? (waterSum / waterDays).toFixed(1) : '—', walk, kegel, train };
  }
  function coachLine(pct, rest, doneN, total) {
    if (pct >= 100) return '今天全部完成。明天同一时间继续，别加码——能坚持才是本事。';
    if (pct >= 60) return `还剩 ${total - doneN} 件，今天稳了。${rest > 1 ? `离睡觉还有 ${Math.round(rest)} 小时，把该做的做完。` : '快睡觉了，剩下的挑重要的做。'}`;
    if (pct >= 30) return `做了 ${doneN} 件，不错。${rest > 1 ? '现在补两件还不晚。' : '时间不多了，先把喝水和散步补上。'}`;
    return `才做了 ${doneN} 件。别一次想做完——先喝水，再站起来走 10 分钟，其他的自然会跟上。`;
  }
  function coachDo(id) {
    const t = today();
    const menu = todayMenu();
    const goal = SETTINGS.kegelDaily || 3;
    // 喝水类：直接 +1 杯，不弹面板（面板有专门的「＋1 杯」按钮）
  // 喝水任务：点一下 +1 杯；再点同一个已完成的 → 撤掉 1 杯
  if (/^water/.test(id)) {
    const dayObj = day(t, true);
    dayObj.water = dayObj.water || [];
    const task = coachTasks().find((x) => x.id === id);
    const wasDone = task ? task.done : false;
    if (wasDone) {
      dayObj.water.pop();
      save(); renderToday(); buzz();
      toast('已撤销一杯');
      return;
    }
    dayObj.water.push(Date.now());
    save(); renderToday(); beep(); buzz();
    const wc = dayObj.water.length;
    toast(wc >= CFG.waterGoal ? `第 ${wc} 杯，今天水量达标 🎉` : `第 ${wc} 杯，记下了（再点可撤销）`);
    return;
  }
  const dayObj = day(t, true);
  switch (id) {
    case 'b': dayObj.meals = dayObj.meals || {}; dayObj.meals.b = !dayObj.meals.b; break;
    case 'l': dayObj.meals = dayObj.meals || {}; dayObj.meals.l = !dayObj.meals.l; break;
    case 'd': dayObj.meals = dayObj.meals || {}; dayObj.meals.d = !dayObj.meals.d; break;
    case 'iron': dayObj.ironDone = !dayObj.ironDone; break;
    case 'sit': dayObj.sitBreaks = (dayObj.sitBreaks || 0) + 1; break;
    case 'walk1': case 'walk2': dayObj.walk = !dayObj.walk; break;
    case 'snack': openSheet('snackNow'); return;
    case 'train': {
      // 已完成 → 再点就是取消（不用跳去训练页）
      if (dayObj.train) {
        dayObj.train = false;
        ['A', 'B', 'C', 'D', 'E', 'F'].forEach((x) => { delete dayObj['done_' + x]; });
        save(); renderToday(); buzz(); toast('已取消训练打卡');
        return;
      }
      const k = routineFor(t).key;
      closeSheet();
      // 跳到训练页并直接滚到「所有训练」那块
      switchTab('plan', { scrollTop: 0 });
      setTimeout(() => {
        const tb = $$('[data-traink]').find((x) => x.dataset.traink === k);
        if (tb) tb.click();
        goToTabElement('plan', '#trainTabs', 30);
      }, 40);
      return;
    }
    case 'kegel': {
      // 已达标 → 再点就是减一轮
      if ((dayObj.kegel || 0) >= goal) {
        dayObj.kegel = Math.max(0, (dayObj.kegel || 0) - 1);
        dayObj.kegelDone = dayObj.kegel >= goal;
        save(); renderToday(); buzz(); toast(`已撤销一轮（${dayObj.kegel}/${goal}）`);
        return;
      }
      dayObj.kegel = (dayObj.kegel || 0) + 1;
      if (dayObj.kegel >= goal) dayObj.kegelDone = true;
      save(); renderToday(); beep(); buzz();
      toast(dayObj.kegel >= goal ? '今天凯格尔完成 🔥（再点可撤销）' : `凯格尔 ${dayObj.kegel}/${goal} 轮`);
      return;
    }
    case 'closed': openSheet('closed'); return;
    case 'screen': openSheet('screen'); return;
    case 'sleep': openSheet('sleep'); return;
    default: openSheet('water'); return; // 喝水类
  }
  save(); renderToday();
  beep(); buzz();
}

  // ---------------- 页面：身体（腿型/盆底/周期） ----------------
  function lookScore(key) {
    const d = DAYS[today()] || {};
    const parts = {
      kegel: { ok: (d.kegel || 0) >= (SETTINGS.kegelDaily || 3), w: 25 },
      aer: { ok: !!d.train || !!d.walk, w: 20 },
      sleep: { ok: d.sleep === '准时', w: 15 },
      water: { ok: waterCount(today()) >= 7, w: 10 },
      closed: { ok: !!d.closed, w: 10 },
      walk: { ok: !!d.walk, w: 10 },
      screen: { ok: d.screen != null && d.screen <= 7, w: 10 },
    };
    return parts[key] || { ok: false, w: 0 };
  }
  // ================================================================
  //  页面：身体 —— 只读。看状态 + 学做法，打卡统一在「今天」页
  // ================================================================
  // ================================================================
  //  页面：身体 —— 只放“怎么做”和“什么时候该看医生”，状态数字已去掉（和今天页重复）
  // ================================================================
  function renderBody() {
    const html = `
      <div class="card">
        <div class="card-title">她的腿为什么“看起来粗”</div>
        <div class="why-grid">
          <div><b>假胯宽</b><span>臀中肌没力 + 髋内旋，不是脂肪</span></div>
          <div><b>二郎腿</b><span>让髋内旋更严重，越坐越宽</span></div>
          <div><b>大腿内侧松</b><span>内收肌用得少，走路才磨腿</span></div>
          <div><b>久坐</b><span>髋屈肌紧绷，把骨盆拽歪</span></div>
        </div>
        <p class="muted small-tip">所以光减脂没用——瘦下来腿型还是那样。<b>练臀中肌 + 纠正坐姿 + 放松内侧</b>，这三件一起做，4–8 周能看出变化。</p>
      </div>

      <div class="card">
        <div class="card-title">她的腿，这 3 件事最管用</div>
        <ol class="steps">
          <li><b>坐着时双脚踩平地面</b>，膝盖与脚尖同向，忍不住就想跷的时候，把手机放远一点。</li>
          <li><b>每天蚌式 3 组</b>（训练页塑形A），这是假胯宽最直接的动作。</li>
          <li><b>每小时起身一次</b>，别连续坐 2 小时。久坐会让髋屈肌越来越紧。</li>
        </ol>
      </div>

      <div class="card">
        <div class="card-title">关于“爬山心慌”</div>
        <p class="muted">她说运动后心跳快要停下歇——<b>这可能正常，也可能不正常</b>，尤其她容易疲倦、早上睡不醒。</p>
        <ul class="bullets">
          <li><b>可能 1：高原缺氧。</b>西宁海拔 2260m，同样的运动心率会高 10–20 次/分。先做平地慢走，别爬坡。</li>
          <li><b>可能 2：缺铁性贫血。</b>女性很常见，会同时造成心慌、乏力、怕冷、睡不醒。<b>先查血常规 + 铁蛋白。</b></li>
          <li><b>可能 3：心脏或甲状腺问题。</b>如果静坐也心慌、或伴胸闷气短，别练，先就医。</li>
        </ul>
        <div class="warn">训练时如果出现：胸口压迫感、心慌停不下来、头晕、眼前发黑 —— <b>立刻停止，坐下休息，别硬撑</b>；反复出现就去医院心内科查心电图。</div>
      </div>

      <div class="card">
        <div class="card-title">经期怎么练、怎么吃</div>
        <ul class="bullets">
          <li><b>经期（第 1–5 天）</b>：不练臀腿、不练核心，改舒展或直接休息。热敷小腹，补铁（红肉、猪肝、菠菜 + 维 C）。</li>
          <li><b>黄体期（经前 1–2 周）</b>：容易水肿、嘴馋、累。<b>别称体重</b>，重 1–2 斤是水。想吃甜的就吃水果或无糖酸奶。</li>
          <li><b>卵泡期（经后到排卵）</b>：体力最好、掉秤最快，可以加一点强度。</li>
          <li>痛经严重到要吃止痛药、或影响上班，去妇科查一下（子宫内膜异位、子宫肌瘤都要排除）。</li>
        </ul>
      </div>

      <div class="card">
        <div class="card-title">两件要当心的事</div>
        <ul class="bullets">
          <li><b>别信“瘦腿针 / 溶脂针 / 减肥茶”</b>：很多没有正规批号，风险远大于收益。</li>
          <li><b>别节食到 1200 卡以下</b>：她会掉头发、月经紊乱、越减越累。1500 卡是底线。</li>
        </ul>
      </div>

      <div class="card">
        <div class="card-title">什么时候该去看医生</div>
        <ul class="bullets">
          <li><b>月经</b>：周期短于 21 天或长于 35 天、连续 3 个月不来、经量突然变很大</li>
          <li><b>心慌</b>：静坐也心慌、伴胸闷气短、运动后长时间缓不过来</li>
          <li><b>疲劳</b>：睡够了还是累、掉头发、怕冷（查血常规 + 甲功 + 铁蛋白）</li>
        </ul>
        <p class="muted small-tip">挂号方向：<b>妇科</b>（月经/痛经）、<b>内分泌科</b>（甲功/多囊）、<b>心内科</b>（心慌）。</p>
        <p class="muted small-tip"><b>以上是一般生活方式建议，不是诊断，也不能替代就医。</b></p>
      </div>
    `;
    $('#body').innerHTML = html;
  }

  // ================================================================
  //  页面：食谱 —— 7 天菜单，只读参考
  // ================================================================
  function renderFood() {
    const names = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    const todayDow = new Date(today() + 'T00:00:00').getDay();
    const todayIdx = todayDow === 0 ? 6 : todayDow - 1;
    const html = `
      <div class="card">
        <div class="card-title">一天怎么分配</div>
        <div class="menu-day">
          <div class="md-row"><span class="md-tag">早 9:00</span><span>蛋白 1 份 + 主食 1 掌心 + 蛋 1–2 个</span></div>
          <div class="md-row"><span class="md-tag">午 12:00</span><span>米饭 1 小碗 + 蛋白 150g + 蔬菜 2 拳头</span></div>
          <div class="md-row"><span class="md-tag">加 14:30</span><span>无糖酸奶 + 坚果 10g（或 1 个煮蛋）</span></div>
          <div class="md-row"><span class="md-tag">晚 19:00</span><span>米饭半碗 + 蛋白 150g + 蔬菜 2 拳头</span></div>
        </div>
        <div class="muted small-tip">不用称重、不用算卡路里。用手量：1 掌心 = 蛋白，1 拳头 = 蔬菜，1 小碗 = 主食。</div>
      </div>

      <div class="card">
        <div class="card-title">7 天菜单 <span class="muted">照着买、照着做</span></div>
        ${names.map((n, i) => {
          const m = MENU[i + 1];
          return `<div class="week-menu ${i === todayIdx ? 'on' : ''}">
            <div class="wm-head">${n}${i === todayIdx ? '<span class="wm-today">今天</span>' : ''}</div>
            <div class="wm-row"><span class="wm-t">早</span><span>${esc(m.b)}</span></div>
            <div class="wm-row"><span class="wm-t">午</span><span>${esc(m.l)}</span></div>
            <div class="wm-row"><span class="wm-t">晚</span><span>${esc(m.d)}</span></div>
            <div class="wm-tip">💡 ${esc(m.tip)}</div>
          </div>`;
        }).join('')}
      </div>

      <div class="card">
        <div class="card-title">周末买一次就够</div>
        <ul class="bullets">
          <li><b>蛋白</b>：鸡蛋 2 板、无糖豆浆、低脂牛奶、鸡胸/鸡腿、鱼、豆腐、瘦牛肉</li>
          <li><b>主食</b>：全麦面包、杂粮馒头、燕麦、玉米、荞麦面、大米、小米</li>
          <li><b>蔬菜</b>：菠菜、上海青、油麦菜、西蓝花、白萝卜、西红柿、黄瓜、菌菇</li>
          <li><b>加餐</b>：无糖酸奶、苹果、小番茄、原味坚果（小包装）</li>
          <li><b>喝水</b>：500ml 矿泉水 14 瓶 / 周（每天 2 瓶）</li>
        </ul>
      </div>

      <div class="card">
        <div class="card-title">外食与应酬</div>
        <ul class="bullets">
          <li>出门前先喝水 + 吃个蛋/酸奶，别饿着上桌。</li>
          <li>第一轮只夹菜和肉；主食 1/3–1/2 碗。</li>
          <li>酒最多 1–2 杯，别人敬酒先端茶。</li>
          <li>西宁本地：手抓羊肉选瘦的、拉面面减半多要萝卜、酿皮当主食配菜加倍。</li>
        </ul>
      </div>
    `;
    $('#food').innerHTML = html;
  }

  // ---------------- 导出手机日历提醒（不依赖电脑、不依赖本页开着） ----------------
  function icsTime(date, hh, mm) {
    const pad2 = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}T${pad2(hh)}${pad2(mm)}00`;
  }
  function buildICS() {
    const pad2 = (n) => String(n).padStart(2, '0');
    const stamp = (() => { const n = new Date(); return `${n.getUTCFullYear()}${pad2(n.getUTCMonth() + 1)}${pad2(n.getUTCDate())}T${pad2(n.getUTCHours())}${pad2(n.getUTCMinutes())}${pad2(n.getUTCSeconds())}Z`; })();
    const alarms = [
      { h: 8, m: 30, title: '起床 · 一杯凉白开', desc: '起床后先喝一杯常温水/凉白开，不用热开水。' },
      { h: 9, m: 0, title: '早餐：豆浆+鸡蛋+杂粮', desc: '豆浆无糖，先吃鸡蛋，面包换杂粮。' },
      { h: 9, m: 15, title: '桌上放 2 瓶矿泉水', desc: '看得见就会喝，不靠想起来。' },
      { h: 10, m: 0, title: '第 2 杯水', desc: '现在去喝一口，250ml。' },
      { h: 11, m: 0, title: '第 3 杯水', desc: '喝完这杯，午饭前不喝甜饮料。' },
      { h: 11, m: 30, title: '第 4 杯水（饭前）', desc: '饭前半小时喝水，饱腹感更强。' },
      { h: 12, m: 0, title: '午餐：先菜后肉再饭', desc: '米饭一小碗（熟 120g）。' },
      { h: 12, m: 30, title: '饭后散步 15 分钟', desc: '一天里最划算的一次运动，走起来。' },
      { h: 14, m: 30, title: '加餐 + 第 5 杯水', desc: '无糖酸奶 + 坚果 10g；把零食欲望挪到下午。' },
      { h: 16, m: 0, title: '第 6 杯水（淡茶也行）', desc: '茶你更容易接受。' },
      { h: 17, m: 30, title: '第 7 杯水', desc: '下班前喝完，别拖到晚上。' },
      { h: 19, m: 0, title: '晚餐：先菜后肉再饭', desc: '米饭半碗；19:30 前离开饭桌。' },
      { h: 19, m: 40, title: '饭后散步 15–20 分钟', desc: '速度：能说话但不能唱歌。' },
      { h: 20, m: 20, title: '居家轻训练 + 盆底肌', desc: '塑形A/B 或舒展；再补 1 轮盆底肌。' },
      { h: 21, m: 0, title: '第 8 杯水 · 厨房关门', desc: '21:00 后不再吃正餐。' },
      { h: 22, m: 0, title: '手机放到客厅充电', desc: '刷手机的 1 小时是零食高危时段。' },
      { h: 22, m: 30, title: '刷牙 = 今天不再进食', desc: '想吃就喝水、离开厨房。' },
      { h: 23, m: 0, title: '上床睡觉', desc: '比现在早 30 分钟；西宁海拔高更要睡够。' },
    ];
    const start = parseYmd(today());
    const days = 30;
    const lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//jiansu//cn//CN', 'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH', 'X-WR-CALNAME:减脂打卡提醒', 'X-WR-TIMEZONE:Asia/Shanghai',
    ];
    for (let i = 0; i < days; i++) {
      const dt = addDays(start, i);
      for (const a of alarms) {
        lines.push(
          'BEGIN:VEVENT',
          `UID:js-${dt.getFullYear()}${pad2(dt.getMonth() + 1)}${pad2(dt.getDate())}-${pad2(a.h)}${pad2(a.m)}@jiansu`,
          `DTSTAMP:${stamp}`,
          `DTSTART;TZID=Asia/Shanghai:${icsTime(dt, a.h, a.m)}`,
          `DTEND;TZID=Asia/Shanghai:${icsTime(dt, a.h, a.m + 5 >= 60 ? 59 : a.m + 5)}`,
          `SUMMARY:${a.title}`,
          `DESCRIPTION:${a.desc}`,
          'BEGIN:VALARM', 'TRIGGER:-PT0M', 'ACTION:DISPLAY', `DESCRIPTION:${a.title}`, 'END:VALARM',
          'END:VEVENT'
        );
      }
    }
    lines.push('END:VCALENDAR');
    // RFC 5545：单行不超过 75 字节（中文 1 字 3 字节），超了要折行，续行以空格开头
    const fold = (line) => {
      const enc = new TextEncoder();
      let out = '', cur = '', bytes = 0;
      for (const ch of line) {
        const b = enc.encode(ch).length;
        if (bytes + b > 73) { out += cur + '\r\n '; cur = ''; bytes = 1; }
        cur += ch; bytes += b;
      }
      return out + cur;
    };
    return lines.map(fold).join('\r\n');
  }
  function downloadICS() {
    const ics = buildICS();
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `减脂打卡-提醒-${today()}.ics`;
    a.click();
    toast('已生成日历文件，去“文件/下载”里点开导入');
  }

  // ---------------- 页面：提醒 ----------------
  function notifState() {
    if (typeof Notification === 'undefined' || !Notification) return 'unsupported';
    return Notification.permission;
  }
  function renderAlerts() {
    const perm = notifState();
    const isIPhone = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const isLocalFile = location.protocol === 'file:';
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    const html = `
      ${envPanel()}
      <div class="card">
        <div class="card-title">月经周期 <span class="muted">会自动调整训练和饮食</span></div>
        <p class="muted small-tip" style="margin-top:-4px">填最近一次月经开始的日子，之后 App 会自己算：经期减量、黄体期别称体重、卵泡期加练。</p>
        <div class="sw-row"><span>上次月经开始日</span><input type="date" class="input" id="periodStart" value="${(SETTINGS.period && SETTINGS.period.lastStart) || ''}" style="max-width:150px"></div>
        <div class="sw-row"><span>周期长度（天）</span><input type="number" class="input" id="periodLen" min="21" max="40" value="${(SETTINGS.period && SETTINGS.period.cycleLen) || 28}" style="max-width:90px"></div>
        <button class="btn primary" id="savePeriod" style="width:100%;margin-top:8px">保存周期</button>
        <div class="muted small-tip">不确定就填 28。周期不规律的人建议先去妇科看看，别自己算。</div>
      </div>
      <div class="card">
        <div class="card-title">① 让系统闹钟替你记着 <span class="muted">推荐，不依赖电脑</span></div>
        <p class="muted">导出一份日历文件，用手机系统日历打开导入（安卓点开会用“日历”打开；iPhone 会问是否添加到日历）。之后就由<b>系统日历/闹钟</b>到点响——不需要电脑、不需要这个页面开着。</p>
        <button class="btn primary" id="icsBtn">📅 导出 30 天提醒（导入手机日历）</button>
        <div class="muted small-tip">包含：8:30 起床、9:00 早餐、10/11/11:30 喝水、12:00 午餐、12:30 散步、14:30 加餐、16:00 喝水、17:30 喝水、19:00 晚餐、19:40 散步、20:30 训练+凯格尔、21:00 关厨房、22:00 手机离床、22:30 刷牙、23:00 上床。<br>30 天后想继续，再导一次即可。</div>
      </div>

      <div class="card">
        <div class="card-title">② 页面内提醒（打开这个页面时）</div>
        <p class="muted">这个页面开着的时候，到点会弹横幅 + 响 + 震动。可以放在桌上常亮——正好治“坐着刷手机”。</p>
        <div class="sw-row"><span>声音提醒</span><button class="switch ${SETTINGS.sound ? 'on' : ''}" data-sw="sound"></button></div>
        <div class="sw-row"><span>震动提醒</span><button class="switch ${SETTINGS.vibrate ? 'on' : ''}" data-sw="vibrate"></button></div>
        <div class="sw-row"><span>系统通知（横幅/锁屏）</span><button class="switch ${SETTINGS.notifOn ? 'on' : ''}" data-sw="notifOn"></button></div>
        <div class="muted small-tip">系统通知要：①系统允许通知 ②${isIPhone ? 'iPhone 用 Safari 添加到主屏幕后打开' : '安卓 Chrome 添加到主屏幕后打开'}，且页面在后台运行。${isLocalFile ? '<br><b>现在是本地文件打开的，系统通知多半用不了——用上面的日历方案最稳。</b>' : ''}</div>
        ${perm === 'denied' ? '<div class="warn">系统通知权限已被拒绝，请到 设置 → 浏览器/减脂打卡 → 通知 里打开。</div>' : ''}
      </div>

      <div class="card">
        <div class="card-title">久坐与零食设置</div>
        <div class="sw-row"><span>营业时间每 <b id="sitVal">${SETTINGS.sitEvery}</b> 分钟提醒起身</span><input type="range" min="0" max="90" step="15" value="${SETTINGS.sitEvery}" id="sitRange"></div>
        <div class="sw-row"><span>每天零食预算 <b id="snackVal">${SETTINGS.snackBudget}</b> 次</span><input type="range" min="0" max="3" step="1" value="${SETTINGS.snackBudget}" id="snackRange"></div>
        <div class="sw-row"><span>每天喝水目标 <b id="goalVal">${SETTINGS.waterGoal}</b> 杯</span><input type="range" min="6" max="10" step="1" value="${SETTINGS.waterGoal}" id="goalRange"></div>
        <div class="sw-row"><span>每天凯格尔 <b id="kegelVal">${SETTINGS.kegelDaily}</b> 轮</span><input type="range" min="1" max="5" step="1" value="${SETTINGS.kegelDaily}" id="kegelRange"></div>
      </div>

      <div class="card">
        <div class="card-title" id="installManual">装到手机桌面（看这里，别找错地方）</div>
        ${isLocalFile
          ? `<div class="warn">你现在是直接打开文件的。这种方式浏览器一般不给装。</div>
             <ol class="steps">
               <li>把 <b>减脂打卡.html</b> 传到手机（微信发给自己也行）</li>
               <li>在手机上用 <b>Chrome</b> 打开它</li>
               <li>点右上角 <b>⋮</b> →「<b>添加到主屏幕</b>」→ 添加</li>
               <li>之后从桌面图标打开，就是全屏的 App</li>
             </ol>`
          : `<div class="warn">走局域网地址（http://192.168...）时，浏览器<b>不允许</b>装成 App——这是浏览器的安全限制，不是你的问题，也不是这个 App 的问题。所以你不会看到“安装”图标。</div>
             <div class="sb-t" style="margin-top:12px">你有三个选择：</div>
             <ol class="steps">
               <li><b>直接加到桌面当书签</b>（最简单，也是大多数人用的）：浏览器菜单 →「添加到主屏幕」/「添加到桌面」→ 它就是个图标，点开就是这个页面。</li>
               <li><b>把文件传到手机上打开</b>（能全屏、能离线）：见上面那条，或把 减脂打卡.html 用微信发到手机。</li>
               <li><b>车机/电脑上想全屏</b>：浏览器按 F11。</li>
             </ol>`}
        <div class="muted small-tip">提醒不依赖“装没装”：设置页最上面的「导出 30 天提醒」，导入手机日历后就由系统闹钟负责，和浏览器无关。</div>
        <button class="btn primary" id="addHomeBtn" style="width:100%;margin-top:10px">不知道菜单在哪？点我</button>
      </div>

      <div class="card" style="display:none">
        <div class="card-title">旧安装入口（保留兼容）</div>
        <button class="btn primary" id="installBtn">📲 一键安装到桌面</button>
        <ol class="steps">
          ${isIPhone ? `<li>用 <b>Safari</b> 打开本页 → 点底部“分享” ⤴️</li><li>选“<b>添加到主屏幕</b>” → 添加</li>`
            : `<li>用 <b>Chrome / Edge</b> 打开本页</li><li>点右上角 ⋮ → “<b>添加到主屏幕 / 安装应用</b>”</li>`}
        </ol>
        ${standalone ? '<div class="ok-banner">已在桌面应用模式运行 ✓</div>' : ''}
      </div>

      <div class="card">
        <div class="card-title">数据与保存</div>
        <p class="muted small-tip">存储方式：<b>${{ local: '本机浏览器存储（换手机/清缓存会丢，请定期导出备份）', session: '仅本次会话（关掉就没了，请导出备份）', memory: '仅本页内存（关掉就没了！必须导出备份）' }[STORE.kind]}</b><br>自动保存：${LAST_SAVE ? new Date(LAST_SAVE).toLocaleString('zh-CN') : '—'}；“进度”页可导出备份文件。</p>
        <p class="muted small-tip">每周六导一次备份，两秒钟的事。</p>
        ${STORE.kind !== 'local' ? '<div class="warn">当前浏览器不允许长期保存数据（常见于直接打开本地文件）。记录关掉页面就会丢，请务必用「导出备份」。</div>' : ''}
      </div>
    `;
    $('#alerts').innerHTML = html;
    $$('[data-sw]').forEach((b) => (b.onclick = async () => {
      const k = b.dataset.sw;
      // 系统通知：先尝试申请权限；不支持/被拒也允许打开（页面内横幅照常工作，开关不该卡死）
      if (k === 'notifOn' && !SETTINGS.notifOn) {
        let granted = false;
        try { granted = await requestNotif(); } catch (e) { granted = false; }
        SETTINGS.notifOn = true; save();
        renderAlerts();
        toast(granted ? '系统通知已开' : '这个浏览器不支持系统通知，页面内的横幅提醒照常工作');
        return;
      }
      SETTINGS[k] = !SETTINGS[k]; save(); renderAlerts();
    }));
    $('#sitRange').oninput = (e) => { SETTINGS.sitEvery = Number(e.target.value); $('#sitVal').textContent = SETTINGS.sitEvery; save(); };
    $('#snackRange').oninput = (e) => { SETTINGS.snackBudget = Number(e.target.value); $('#snackVal').textContent = SETTINGS.snackBudget; save(); };
    $('#kegelRange').oninput = (e) => { SETTINGS.kegelDaily = Number(e.target.value); $('#kegelVal').textContent = SETTINGS.kegelDaily; save(); };
    $('#goalRange').oninput = (e) => { SETTINGS.waterGoal = Number(e.target.value); CFG.waterGoal = SETTINGS.waterGoal; $('#goalVal').textContent = SETTINGS.waterGoal; save(); };
    const icsBtn = $('#icsBtn');
    if (icsBtn) icsBtn.onclick = () => downloadICS();
    const savePeriodBtn = $('#savePeriod');
    if (savePeriodBtn) savePeriodBtn.onclick = () => {
      const start = $('#periodStart').value;
      const len = Number($('#periodLen').value) || 28;
      if (!start) { toast('先选一个日期'); return; }
      SETTINGS.period = { lastStart: start, cycleLen: Math.max(21, Math.min(40, len)) };
      save(); renderAlerts(); toast('已保存，今天页会跟着变');
    };
    const installBtnEl = $('#installBtn');
    if (installBtnEl) installBtnEl.onclick = async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const r = await deferredPrompt.userChoice;
        deferredPrompt = null;
        toast(r.outcome === 'accepted' ? '正在安装…' : '已取消，也可以按上面的步骤手动添加');
      } else {
        toast('用浏览器菜单里的“添加到主屏幕”即可');
      }
    };
    const addHomeBtn = $('#addHomeBtn');
    if (addHomeBtn) addHomeBtn.onclick = () => {
      toast('点右上角 ⋮ 菜单 →「添加到主屏幕」，就有一个图标了');
    };
  }
  async function requestNotif() {
    if (typeof Notification === 'undefined' || !Notification) { toast('这个浏览器不支持通知，请用 Chrome/Safari'); return false; }
    let perm = Notification.permission;
    if (perm !== 'granted') perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('需要在系统设置里允许通知'); renderAlerts(); return false; }
    // 注册 service worker，用于后台/锁屏通知
    try { if (navigator.serviceWorker) await navigator.serviceWorker.register('./sw.js'); } catch (e) { /* 忽略 */ }
    return true;
  }

  // ---------------- 导航 ----------------
  const TAB_RENDER = {
    today: () => renderToday(),
    progress: () => renderProgress(),
    plan: () => renderPlan(),
    food: () => renderFood(),
    body: () => renderBody(),
    alerts: () => renderAlerts(),
  };
  let activeTab = 'today';
  let FROM_TAB = null;   // 从哪个页面跳过来的（用于“返回”按钮）
  const TAB_SCROLL = {}; // 每个页面记住自己滚到哪了
  const DEMO_MODE = (() => { try { return new URLSearchParams(location.search).get('demo') === '1'; } catch (e) { return false; } })();
  function switchTab(tab, opt) {
    if (!TAB_RENDER[tab]) tab = 'today';
    const changed = activeTab !== tab;
    if (changed) TAB_SCROLL[activeTab] = window.scrollY || 0;
    const viaTabbar = opt && opt.viaTabbar;
    if (changed && !viaTabbar) FROM_TAB = (activeTab === 'today') ? 'today' : null;
    activeTab = tab;
    $$('.page').forEach((p) => p.classList.toggle('active', p.id === tab));
    $$('.tabbar .tb').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    TAB_RENDER[tab]();
    if (opt && opt.scrollTop != null) {
      window.scrollTo({ top: opt.scrollTop });
      TAB_SCROLL[tab] = opt.scrollTop;
    } else if (opt && opt.keepScroll) {
      // 保持当前滚动
    } else if (changed) {
      window.scrollTo({ top: TAB_SCROLL[tab] || 0 });
    }
  }
  // 跳到某个页面并滚到某个元素
  function goToTabElement(tab, selector, delay) {
    switchTab(tab, { scrollTop: 0 });
    setTimeout(() => {
      const el = $(selector);
      if (el && el.getBoundingClientRect) {
        const rect = el.getBoundingClientRect();
        const top = (window.scrollY || 0) + rect.top - 70;
        window.scrollTo({ top: Math.max(0, top) });
        TAB_SCROLL[tab] = Math.max(0, top);
      }
    }, delay || 60);
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; });

  // ---------------- 统一的跳转入口 ----------------
  // 规则：需要输入/选择的 → 弹面板；打勾类的 → 直接切换；换页面 → switchTab。
  function navigate(target) {
    if (!target) return;
    if (TAB_RENDER[target]) { switchTab(target); return; }
    if (target === 'water' || target === 'meals' || target === 'screen' || target === 'sleep') {
      openSheet(target); return;
    }
    if (target === 'move') {
      const dayObj = day(today(), true);
      dayObj.walk = !dayObj.walk; save(); TAB_RENDER[activeTab] && TAB_RENDER[activeTab]();
      toast(dayObj.walk ? '散步打卡完成 👍' : '已取消散步打卡');
      if (dayObj.walk) buzz();
      return;
    }
    if (target === 'closed') { openSheet('closed'); return; }
    if (target === 'kegel') {
      switchTab('plan');
      setTimeout(() => { const tb = $$('[data-traink]').find((x) => x.dataset.traink === 'E'); if (tb) tb.click(); }, 30);
      return;
    }
    if (target === 'train') { openSheet('train'); return; }
    // 兜底：回教练页，绝不落到空白
    switchTab('coach');
  }

  // ---------------- 启动 ----------------
  function boot() {
    // 设置水目标
    CFG.waterGoal = SETTINGS.waterGoal || CFG.waterGoal;
    // 模拟/调试：?demo=1 生成示例数据，方便查看效果
    if (DEMO_MODE && !LS.get('her_js_demo_done', false)) {
      const t = parseYmd(today());
      for (let i = 20; i >= 1; i--) {
        const dt = addDays(t, -i); const k = ymd(dt);
        if (k < CFG.startDate) continue;
        const w = Math.round((75 - (20 - i) * 0.07 - Math.random() * 0.3) * 10) / 10;
        DAYS[k] = { water: Array.from({ length: 4 + Math.round(Math.random() * 4) }, () => Date.now()), meals: { b: true, l: true, d: Math.random() > 0.3 }, snack: Math.round(Math.random() * 2), walk: Math.random() > 0.25, train: Math.random() > 0.45, screen: 8 + Math.round(Math.random() * 3), sleep: ['23:00', '23:30', '00:00 后'][Math.round(Math.random() * 2)], closed: Math.random() > 0.4, w: { w } };
        WEIGHTS.push({ d: k, w, waist: 90 - Math.round((20 - i) * 0.15), hip: 98 });
      }
      const k = today();
      DAYS[k] = { water: [Date.now(), Date.now(), Date.now()], meals: { b: true }, snack: 0, walk: false, train: false, screen: null, sleep: null, closed: false };
      save(); LS.set('her_js_demo_done', true);
    }
    renderHeader();
    switchTab('coach');
    $('#alarm .close-alarm').onclick = () => $('#alarm').classList.remove('show');
    $('#sitBtn').onclick = () => {
      const t = today(); const d = day(t, true);
      const now = new Date(); const nowMin = now.getHours() * 60 + now.getMinutes();
      d.breaks = (d.breaks || 0) + 1;
      const bucket = SETTINGS.sitEvery > 0 && nowMin >= 9 * 60 && nowMin < 18 * 60 ? Math.floor((nowMin - 9 * 60) / SETTINGS.sitEvery) : null;
      if (bucket != null) { d.breakLog = d.breakLog || {}; d.breakLog[t + '|sit ' + t + ' ' + bucket] = 1; }
      save(); renderSit(); buzz(); toast(`第 ${d.breaks} 次起身，做得好 👍`);
    };
    $('#todayBody').addEventListener('click', (e) => {
      const g = e.target.closest('[data-goto]');
      if (g) navigate(g.dataset.goto);
    });
    $('#alarm .go-alarm').onclick = () => { $('#alarm').classList.remove('show'); switchTab('today'); };
    $$('.tabbar .tb').forEach((b) => (b.onclick = () => switchTab(b.dataset.tab, { viaTabbar: true })));
    renderNext(); renderSit();
    setInterval(tick, 20000);
    setInterval(renderHeader, 60000);
    // 每 30 秒把页面状态保存一次（防误关）
    setInterval(save, 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { renderHeader(); tick(); } save(); });
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  // 接收 service worker 发来的“去喝水”等按钮消息
  if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      const d = e.data || {};
      if (d.type === 'drink') { addWater(1); toast('记下了一杯水 💧'); }
      if (d.type === 'open') { switchTab('today'); }
      if (d.type === 'standup') { const b = $('#sitBtn'); if (b) b.click(); }
    });
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
