/* PBC 资料清单跟踪看板 —— 应用逻辑
 * 纯前端，无依赖；数据保存在浏览器 localStorage。
 * 这是演示版本，随包数据全部为虚构，不含任何真实客户信息。
 */
(function () {
  'use strict';

  const KEY = 'pbc-tracker-v1';

  const STATUS = {
    pending: '待提供',
    partial: '部分提供',
    received: '已提供',
    verified: '已核验',
    waived: '无需提供',
  };
  const BOARD_ORDER = ['pending', 'partial', 'received', 'verified', 'waived'];
  const DONE = ['received', 'verified', 'waived'];

  const state = {
    items: [],
    view: 'table',
    q: '',
    status: '',
    owner: '',
    onlyOverdue: false,
    sort: { by: 'due', dir: 'asc' },
    followId: null,
  };

  /* ------------------------------------------------------------ 工具函数 */

  const pad = (n) => String(n).padStart(2, '0');

  function toISO(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function today() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function shiftDays(n) {
    const d = today();
    d.setDate(d.getDate() + n);
    return toISO(d);
  }

  function parseDate(iso) {
    if (!iso) return null;
    const d = new Date(iso + 'T00:00:00');
    return isNaN(d.getTime()) ? null : d;
  }

  /** 距承诺提供日的天数：负数=已逾期，0=今天到期 */
  function daysLeft(item) {
    const d = parseDate(item.due);
    if (!d) return null;
    return Math.round((d - today()) / 86400000);
  }

  function isDone(item) {
    return DONE.includes(item.status);
  }

  function isOverdue(item) {
    if (isDone(item)) return false;
    const n = daysLeft(item);
    return n !== null && n < 0;
  }

  function isSoon(item) {
    if (isDone(item)) return false;
    const n = daysLeft(item);
    return n !== null && n >= 0 && n <= 3;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, 2200);
  }

  function download(filename, content, type) {
    const blob = new Blob([content], { type: type || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ------------------------------------------------------------ 种子数据
   * 格式：[资料名称, 审计领域, 责任人, 请求日偏移, 承诺日偏移, 状态, 优先级, 份数, 备注]
   * 偏移相对"今天"，保证打开时就有逾期/临期样本可演示。
   */
  const SEED = [
    ['银行开户清单及全部银行账户清单', '货币资金', '王芳（出纳）', -18, -6, 'pending', '高', 0, '客户称原件在集团总部，尚未盖章'],
    ['全部银行账户对账单及余额调节表', '货币资金', '王芳（出纳）', -18, -3, 'partial', '高', 8, '已收 1-10 月，11-12 月待补'],
    ['库存现金盘点表（12 月 31 日）', '货币资金', '王芳（出纳）', -12, -1, 'pending', '高', 0, '需现场监盘后双方签字'],
    ['应收票据台账及票据影像', '应收票据', '李伟（成本会计）', -15, 0, 'partial', '中', 3, '背书信息待补录'],
    ['应收账款账龄分析表', '应收账款', '张敏（财务经理）', -15, -9, 'received', '高', 1, ''],
    ['应收账款函证回函（前二十大客户）', '应收账款', '张敏（财务经理）', -20, -12, 'partial', '高', 13, '已回函 13/20，2 家失联需替代程序'],
    ['坏账准备计提测算表及依据', '应收账款', '张敏（财务经理）', -14, 1, 'pending', '中', 0, ''],
    ['预付款项明细及期后到货凭证', '预付款项', '刘洋（报表会计）', -14, 2, 'pending', '中', 0, ''],
    ['其他应收款明细及性质说明', '其他应收款', '刘洋（报表会计）', -13, 3, 'pending', '中', 0, '含员工借款，需说明用途及还款计划'],
    ['存货盘点表及监盘记录', '存货', '李伟（成本会计）', -16, -6, 'received', '高', 2, '盘点差异 3 项待客户解释'],
    ['存货跌价准备计算表', '存货', '李伟（成本会计）', -12, 2, 'pending', '中', 0, ''],
    ['成本结转计算表及分摊逻辑说明', '营业成本', '李伟（成本会计）', -12, 9, 'pending', '高', 0, ''],
    ['固定资产明细表及折旧计提表', '固定资产', '刘洋（报表会计）', -14, -2, 'partial', '中', 1, '已收明细，折旧表在整理'],
    ['在建工程明细及转固依据', '在建工程', '赵磊（资金主管）', -11, 4, 'pending', '中', 0, ''],
    ['无形资产清单及摊销计算', '无形资产', '刘洋（报表会计）', -11, 5, 'pending', '低', 0, ''],
    ['长短期借款合同及利息计提表', '借款', '赵磊（资金主管）', -16, -3, 'partial', '高', 4, '合同已收，利息计提表待补'],
    ['关联方清单及关联交易明细', '关联方', '张敏（财务经理）', -18, -1, 'pending', '高', 0, '由集团层面统一提供'],
    ['收入确认政策及前十大客户合同', '营业收入', '张敏（财务经理）', -15, 0, 'partial', '高', 6, '已收 6 份合同，剩余待用印'],
    ['主要客户走访记录及访谈纪要', '营业收入', '陈静（税务会计）', -10, 6, 'pending', '低', 0, ''],
    ['职工薪酬明细及社保公积金缴纳凭证', '应付职工薪酬', '陈静（税务会计）', -13, -12, 'verified', '中', 12, '已与申报表核对一致'],
    ['应付账款明细及期后付款测试样本', '应付账款', '刘洋（报表会计）', -13, 5, 'partial', '中', 25, '样本凭证已提供 25 笔'],
    ['大额采购合同及验收单', '应付账款', '李伟（成本会计）', -12, 6, 'pending', '中', 0, ''],
    ['应交税费明细及全年纳税申报表', '应交税费', '陈静（税务会计）', -15, -9, 'received', '高', 14, ''],
    ['完税凭证及税务稽查、处罚情况说明', '应交税费', '陈静（税务会计）', -15, -9, 'received', '中', 1, ''],
    ['政府补助批文及会计处理说明', '其他收益', '陈静（税务会计）', -10, 7, 'pending', '低', 0, ''],
    ['担保、抵押及对外质押事项说明', '或有事项', '赵磊（资金主管）', -18, -2, 'pending', '高', 0, '需法务确认后出具'],
    ['未决诉讼及或有负债情况说明', '或有事项', '张敏（财务经理）', -18, 4, 'pending', '中', 0, ''],
    ['期后事项说明（截至审计报告日）', '期后事项', '张敏（财务经理）', -9, 8, 'pending', '中', 0, '现场结束前提供'],
    ['上年审计调整分录及本期处理说明', '期初余额', '刘洋（报表会计）', -16, -6, 'received', '高', 1, ''],
    ['管理层声明书（草稿）', '完成阶段', '张敏（财务经理）', -5, 10, 'pending', '高', 0, '待合伙人定稿后签署'],
    ['治理层沟通函及沟通记录', '完成阶段', '张敏（财务经理）', -5, 10, 'pending', '低', 0, ''],
    ['重大合同台账（含租赁、许可）', '租赁及合同', '赵磊（资金主管）', -11, -1, 'partial', '中', 2, '租赁合同已收 2 份'],
    ['外币账户及汇兑损益计算资料', '货币资金', '王芳（出纳）', -12, -5, 'waived', '低', 0, '客户无外币账户，已取得书面确认'],
  ];

  function buildSeed() {
    return SEED.map((row, i) => ({
      id: 'pbc-' + (i + 1),
      no: 'PBC-' + pad(i + 1),
      name: row[0],
      cat: row[1],
      owner: row[2],
      requested: shiftDays(row[3]),
      due: shiftDays(row[4]),
      status: row[5],
      priority: row[6],
      files: row[7],
      note: row[8],
      followups: [],
    }));
  }

  /* ------------------------------------------------------------ 持久化 */

  function load() {
    let stored = null;
    try {
      const raw = localStorage.getItem(KEY);
      stored = raw ? JSON.parse(raw) : null;
    } catch (e) {
      stored = null;
    }
    state.items = (stored && Array.isArray(stored) && stored.length) ? stored : buildSeed();
    if (!stored) save(true);
  }

  function save(quiet) {
    let ok = false;
    try {
      localStorage.setItem(KEY, JSON.stringify(state.items));
      ok = true;
    } catch (e) {
      ok = false;
    }
    const el = document.getElementById('lastSaved');
    if (el) {
      const t = new Date();
      el.textContent = `已保存 ${pad(t.getHours())}:${pad(t.getMinutes())}${ok ? '' : '（浏览器禁用了本地存储，改动仅本次有效）'}`;
    }
    if (!quiet && !ok) toast('本地存储不可用，本次改动不会保留');
  }

  /* ------------------------------------------------------------ 统计 */

  function stats() {
    const total = state.items.length;
    const waived = state.items.filter((i) => i.status === 'waived').length;
    const effective = total - waived;
    const provided = state.items.filter((i) => i.status === 'received' || i.status === 'verified').length;
    return {
      total,
      waived,
      effective,
      provided,
      rate: effective ? Math.round((provided / effective) * 1000) / 10 : 0,
      overdue: state.items.filter(isOverdue).length,
      soon: state.items.filter(isSoon).length,
      pending: state.items.filter((i) => i.status === 'pending').length,
    };
  }

  /* ------------------------------------------------------------ 筛选与排序 */

  function visibleItems() {
    const q = state.q.trim().toLowerCase();
    let list = state.items.filter((it) => {
      if (state.status && it.status !== state.status) return false;
      if (state.owner && it.owner !== state.owner) return false;
      if (state.onlyOverdue && !isOverdue(it)) return false;
      if (q) {
        const hay = [it.no, it.name, it.cat, it.owner, it.note, STATUS[it.status]]
          .join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const dir = state.sort.dir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      switch (state.sort.by) {
        case 'no':
          return dir * a.no.localeCompare(b.no, 'zh');
        case 'name':
          return dir * a.name.localeCompare(b.name, 'zh');
        case 'left': {
          const av = daysLeft(a), bv = daysLeft(b);
          return dir * ((av === null ? 9999 : av) - (bv === null ? 9999 : bv));
        }
        case 'due':
        default: {
          // 未完成的排前面（先催最要紧的），已完成沉底
          const ad = isDone(a) ? 1 : 0, bd = isDone(b) ? 1 : 0;
          if (ad !== bd) return ad - bd;
          return dir * ((parseDate(a.due) || 0) - (parseDate(b.due) || 0));
        }
      }
    });
    return list;
  }

  /* ------------------------------------------------------------ 渲染 */

  function renderKPI() {
    const s = stats();
    document.getElementById('kpiTotal').textContent = s.total;
    document.getElementById('kpiTotalHint').textContent = s.waived ? `其中 ${s.waived} 项无需提供` : '含无需提供';
    document.getElementById('kpiRate').textContent = s.rate.toFixed(1) + '%';
    document.getElementById('kpiRateHint').textContent = `${s.provided} / ${s.effective} 项已提供`;
    document.getElementById('kpiOverdue').textContent = s.overdue;
    document.getElementById('kpiSoon').textContent = s.soon;
    document.getElementById('kpiPending').textContent = s.pending;
  }

  function ownerOptions() {
    const owners = Array.from(new Set(state.items.map((i) => i.owner).filter(Boolean))).sort();
    const sel = document.getElementById('fOwner');
    const current = sel.value;
    sel.innerHTML = '<option value="">全部责任人</option>' +
      owners.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
    if (owners.includes(current)) sel.value = current;
  }

  function statusCell(it) {
    const colors = {
      pending: ['#f0f2f5', '#5b6675'],
      partial: ['#fdf3e2', '#a86a12'],
      received: ['#eaf0fa', '#1f3864'],
      verified: ['#e8f3ec', '#2f7d4f'],
      waived: ['#f0f2f5', '#97a1ad'],
    }[it.status] || ['#f0f2f5', '#5b6675'];
    const options = Object.entries(STATUS)
      .map(([k, v]) => `<option value="${k}"${k === it.status ? ' selected' : ''}>${v}</option>`)
      .join('');
    return `<select class="status-select" data-id="${it.id}"
      style="background:${colors[0]};color:${colors[1]}">${options}</select>`;
  }

  function leftCell(it) {
    if (isDone(it)) return `<span class="left done">已完成</span>`;
    const n = daysLeft(it);
    if (n === null) return '<span class="left">—</span>';
    if (n < 0) return `<span class="left over">逾期 ${-n} 天</span>`;
    if (n === 0) return '<span class="left soon">今天到期</span>';
    const cls = n <= 3 ? 'left soon' : 'left';
    return `<span class="${cls}">剩 ${n} 天</span>`;
  }

  function renderTable(list) {
    const body = document.getElementById('gridBody');
    body.innerHTML = list.map((it) => {
      const cls = isOverdue(it) ? 'overdue' : '';
      return `<tr class="${cls}" data-id="${it.id}">
        <td class="no">${esc(it.no)}</td>
        <td class="name">
          <span class="name-text">${esc(it.name)}</span>
          ${it.note ? `<span class="name-note">${esc(it.note)}</span>` : ''}
        </td>
        <td>${esc(it.cat || '—')}</td>
        <td>${esc(it.owner || '—')}</td>
        <td class="date">${esc(it.due || '—')}</td>
        <td>${leftCell(it)}</td>
        <td>${statusCell(it)}</td>
        <td><span class="prio ${esc(it.priority)}">${esc(it.priority)}</span></td>
        <td class="ops">
          <button class="btn" data-act="follow" data-id="${it.id}">催办</button>
          <button class="btn" data-act="edit" data-id="${it.id}">编辑</button>
          <button class="btn danger" data-act="del" data-id="${it.id}">删除</button>
        </td>
      </tr>`;
    }).join('');

    document.getElementById('emptyTip').hidden = list.length > 0;

    // 表头排序箭头
    document.querySelectorAll('#grid thead th.sortable').forEach((th) => {
      const key = th.dataset.sort;
      const mark = th.querySelector('.arrow');
      if (mark) mark.remove();
      if (state.sort.by === key) {
        th.insertAdjacentHTML('beforeend',
          `<span class="arrow">${state.sort.dir === 'asc' ? '▲' : '▼'}</span>`);
      }
    });
  }

  function renderBoard(list) {
    const board = document.getElementById('boardView');
    board.innerHTML = BOARD_ORDER.map((st) => {
      const items = list.filter((i) => i.status === st);
      const cards = items.map((it) => {
        const cls = isOverdue(it) ? 'overdue' : (isSoon(it) ? 'soon' : (st === 'verified' ? 'verified' : ''));
        const left = isDone(it) ? '已完成' : (daysLeft(it) < 0
          ? `逾期 ${-daysLeft(it)} 天`
          : (daysLeft(it) === 0 ? '今天到期' : `剩 ${daysLeft(it)} 天`));
        return `<div class="card ${cls}" data-id="${it.id}">
          <div class="t">${esc(it.name)}</div>
          <div class="m"><span>${esc(it.no)} · ${esc(it.owner || '未指定')}</span><span>${left}</span></div>
        </div>`;
      }).join('');
      return `<div class="col">
        <div class="col-head"><span>${STATUS[st]}</span><span class="count">${items.length}</span></div>
        <div class="col-body">${cards || '<div class="empty" style="padding:16px;font-size:11.5px">暂无</div>'}</div>
      </div>`;
    }).join('');
  }

  function render() {
    const list = visibleItems();
    renderKPI();
    if (state.view === 'table') {
      document.getElementById('tableView').hidden = false;
      document.getElementById('boardView').hidden = true;
      renderTable(list);
    } else {
      document.getElementById('tableView').hidden = true;
      document.getElementById('boardView').hidden = false;
      renderBoard(list);
    }
    ownerOptions();
  }

  /* ------------------------------------------------------------ 弹窗：编辑 */

  function openEdit(id) {
    const it = id ? state.items.find((i) => i.id === id) : null;
    document.getElementById('editTitle').textContent = it ? '编辑资料' : '新增资料';
    document.getElementById('fId').value = it ? it.id : '';
    document.getElementById('fName').value = it ? it.name : '';
    document.getElementById('fCat').value = it ? it.cat : '';
    document.getElementById('fOwner2').value = it ? it.owner : '';
    document.getElementById('fPriority').value = it ? it.priority : '中';
    document.getElementById('fRequested').value = it ? it.requested : shiftDays(0);
    document.getElementById('fDue').value = it ? it.due : shiftDays(7);
    document.getElementById('fStatus2').value = it ? it.status : 'pending';
    document.getElementById('fFiles').value = it ? it.files : 0;
    document.getElementById('fNote').value = it ? it.note : '';
    document.getElementById('modalEdit').hidden = false;
    setTimeout(() => document.getElementById('fName').focus(), 50);
  }

  function nextNo() {
    const nums = state.items
      .map((i) => parseInt(String(i.no).replace(/[^0-9]/g, ''), 10))
      .filter((n) => !isNaN(n));
    return 'PBC-' + pad((nums.length ? Math.max(...nums) : 0) + 1);
  }

  function submitEdit(e) {
    e.preventDefault();
    const id = document.getElementById('fId').value;
    const payload = {
      name: document.getElementById('fName').value.trim(),
      cat: document.getElementById('fCat').value.trim(),
      owner: document.getElementById('fOwner2').value.trim(),
      priority: document.getElementById('fPriority').value,
      requested: document.getElementById('fRequested').value,
      due: document.getElementById('fDue').value,
      status: document.getElementById('fStatus2').value,
      files: parseInt(document.getElementById('fFiles').value, 10) || 0,
      note: document.getElementById('fNote').value.trim(),
    };
    if (!payload.name) return;

    if (id) {
      const it = state.items.find((i) => i.id === id);
      Object.assign(it, payload);
    } else {
      state.items.push(Object.assign({
        id: 'pbc-' + Date.now(),
        no: nextNo(),
        followups: [],
      }, payload));
    }
    save();
    render();
    document.getElementById('modalEdit').hidden = true;
    toast(id ? '已保存修改' : '已新增一条资料');
  }

  /* ------------------------------------------------------------ 弹窗：催办 */

  function openFollow(id) {
    const it = state.items.find((i) => i.id === id);
    if (!it) return;
    state.followId = id;

    const n = daysLeft(it);
    let script;
    if (isDone(it)) {
      script = `【资料确认】${it.name}（${it.no}）已收到，感谢配合。`;
    } else if (n < 0) {
      script = `【资料催办】${it.name}（${it.no}）原承诺 ${it.due} 提供，目前已逾期 ${-n} 天。` +
        `烦请今日反馈预计提交时间，以便安排后续审计程序，谢谢。`;
    } else if (n === 0) {
      script = `【资料提醒】${it.name}（${it.no}）今天到期，烦请于今日提供，谢谢。`;
    } else {
      script = `【资料提醒】${it.name}（${it.no}）承诺 ${it.due} 提供（还有 ${n} 天）。` +
        `如遇困难请提前告知，谢谢配合。`;
    }
    if (it.followups.length) {
      script += `\n（此前已催办 ${it.followups.length} 次，最近一次：${it.followups[it.followups.length - 1].date}）`;
    }

    document.getElementById('followItem').textContent = `${it.no} · ${it.name}`;
    document.getElementById('followScript').textContent = script;
    document.getElementById('followNote').value = '';
    document.getElementById('followHistory').innerHTML = it.followups.length
      ? '催办记录：<br>' + it.followups.map((f) =>
          `· ${esc(f.date)}　${esc(f.note || '（无备注）')}`).join('<br>')
      : '暂无催办记录。';
    document.getElementById('modalFollow').hidden = false;
  }

  function saveFollow() {
    const it = state.items.find((i) => i.id === state.followId);
    if (!it) return;
    const note = document.getElementById('followNote').value.trim();
    const now = new Date();
    it.followups.push({
      date: `${toISO(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}`,
      note,
    });
    // 催办后若仍是"待提供"，自动转为"部分提供"提示跟进？不自动改状态，避免误记事实
    save();
    render();
    document.getElementById('modalFollow').hidden = true;
    toast(`已记录第 ${it.followups.length} 次催办`);
  }

  async function copyScript() {
    const text = document.getElementById('followScript').textContent;
    try {
      await navigator.clipboard.writeText(text);
      toast('话术已复制到剪贴板');
    } catch (e) {
      const range = document.createRange();
      range.selectNodeContents(document.getElementById('followScript'));
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      toast('已选中文本，请按 Ctrl/⌘ + C 复制');
    }
  }

  /* ------------------------------------------------------------ 导入导出 */

  function exportCSV() {
    const head = ['编号', '资料名称', '审计领域', '责任人', '请求日', '承诺日', '剩余天数', '状态', '优先级', '份数', '备注', '催办次数'];
    const rows = state.items.map((it) => {
      const n = daysLeft(it);
      return [
        it.no, it.name, it.cat, it.owner, it.requested, it.due,
        isDone(it) ? '' : (n === null ? '' : n),
        STATUS[it.status], it.priority, it.files, it.note, it.followups.length,
      ];
    });
    const csv = [head, ...rows]
      .map((r) => r.map((v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    download(`PBC资料清单_${toISO(new Date())}.csv`, '\ufeff' + csv, 'text/csv;charset=utf-8');
    toast('已导出 CSV');
  }

  function backup() {
    download(`PBC备份_${toISO(new Date())}.json`,
      JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), items: state.items }, null, 2),
      'application/json');
    toast('已导出备份文件');
  }

  function restore(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const items = Array.isArray(data) ? data : data.items;
        if (!Array.isArray(items) || !items.length) throw new Error('文件里没有资料记录');
        state.items = items.map((i) => Object.assign({ followups: [] }, i));
        save();
        render();
        toast(`已恢复 ${state.items.length} 条记录`);
      } catch (e) {
        toast('导入失败：' + e.message);
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  /* ------------------------------------------------------------ 事件绑定 */

  function bind() {
    document.getElementById('btnAdd').addEventListener('click', () => openEdit(null));
    document.getElementById('btnExport').addEventListener('click', exportCSV);
    document.getElementById('btnBackup').addEventListener('click', backup);
    document.getElementById('fileImport').addEventListener('change', (e) => {
      if (e.target.files[0]) restore(e.target.files[0]);
      e.target.value = '';
    });

    document.getElementById('btnCancelEdit').addEventListener('click', () => {
      document.getElementById('modalEdit').hidden = true;
    });
    document.getElementById('editForm').addEventListener('submit', submitEdit);
    document.getElementById('btnCancelFollow').addEventListener('click', () => {
      document.getElementById('modalFollow').hidden = true;
    });
    document.getElementById('btnSaveFollow').addEventListener('click', saveFollow);
    document.getElementById('btnCopy').addEventListener('click', copyScript);

    // 筛选
    document.getElementById('q').addEventListener('input', (e) => {
      state.q = e.target.value;
      render();
    });
    document.getElementById('fStatus').addEventListener('change', (e) => {
      state.status = e.target.value;
      render();
    });
    document.getElementById('fOwner').addEventListener('change', (e) => {
      state.owner = e.target.value;
      render();
    });
    document.getElementById('fOverdue').addEventListener('change', (e) => {
      state.onlyOverdue = e.target.checked;
      render();
    });

    // 视图切换
    document.getElementById('viewSwitch').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-view]');
      if (!btn) return;
      state.view = btn.dataset.view;
      document.querySelectorAll('#viewSwitch button')
        .forEach((b) => b.classList.toggle('active', b === btn));
      render();
    });

    // 表格内操作（事件委托）
    document.getElementById('gridBody').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const id = btn.dataset.id;
      const act = btn.dataset.act;
      if (act === 'follow') openFollow(id);
      if (act === 'edit') openEdit(id);
      if (act === 'del') {
        const it = state.items.find((i) => i.id === id);
        if (it && confirm(`确定删除「${it.name}」？此操作不可撤销。`)) {
          state.items = state.items.filter((i) => i.id !== id);
          save();
          render();
          toast('已删除');
        }
      }
    });

    document.getElementById('gridBody').addEventListener('change', (e) => {
      const sel = e.target.closest('select.status-select');
      if (!sel) return;
      const it = state.items.find((i) => i.id === sel.dataset.id);
      if (!it) return;
      it.status = sel.value;
      save();
      render();
    });

    // 表头排序
    document.querySelectorAll('#grid thead th.sortable').forEach((th) => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (state.sort.by === key) {
          state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          state.sort = { by: key, dir: 'asc' };
        }
        render();
      });
    });

    // 看板卡片点击编辑
    document.getElementById('boardView').addEventListener('click', (e) => {
      const card = e.target.closest('.card');
      if (card) openEdit(card.dataset.id);
    });

    // 弹窗遮罩点击关闭 / Esc
    document.querySelectorAll('.modal').forEach((m) => {
      m.addEventListener('click', (e) => {
        if (e.target === m) m.hidden = true;
      });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.getElementById('modalEdit').hidden = true;
        document.getElementById('modalFollow').hidden = true;
      }
    });
  }

  /* ------------------------------------------------------------ 启动 */

  function init() {
    load();
    bind();
    const first = state.items[0];
    const range = `${first ? first.requested : ''} ~ ${state.items[state.items.length - 1] ? state.items[state.items.length - 1].due : ''}`;
    document.getElementById('projectMeta').textContent =
      `启明科技 2025 年度财务报表审计 · 现场阶段　|　${state.items.length} 项资料　|　演示数据（虚构）`;
    render();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
