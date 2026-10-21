import { calculateItems, money } from './money.js';

const $ = (s, root = document) => root.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const paths = {
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18M8 16h2M14 16h2"/>',
  settings: '<path d="m9 3 1-1h4l1 1 1 3 3 1 2 3-1 3-2 2-1 4-3 2-3-1-2-2-4-1-2-3 1-3 2-2 1-4z"/><circle cx="12" cy="12" r="3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  arrow: '<path d="m9 5 7 7-7 7"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M5 16v5h14v-5"/>',
  check: '<path d="m5 12 4 4L19 6"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>', edit: '<path d="m16 3 5 5L9 20l-6 1 1-6zM13 6l5 5"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.file}</svg>`;
document.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon));
const statusLabels = { pending: '待回复', won: '已成交', lost: '未成交' };
const pill = status => `<span class="pill ${status}">${statusLabels[status]}</span>`;
const state = { page: 'quotes', filter: 'all', search: '', customerSearch: '', data: null };
const modal = $('#modal');
let draft = null, quoteEdit = null, customerReturn = null, restoreData = null;
let toastTimer;
function toast(message) {
  $('#toast').textContent = message; $('#toast').classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4000);
}
async function api(url, method = 'GET', body) {
  const res = await fetch(url, { method, headers: { 'X-Requested-With': 'merchant-quotes', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '操作失败，请重试');
  return data;
}
async function refresh() {
  state.data = await api('/api/bootstrap');
  $('#merchant-name').textContent = state.data.merchant.name;
  $('#merchant-avatar').textContent = state.data.merchant.name[0];
  render();
}
function heading(title, desc, action = '', label = '', eyebrow = 'YOUR BUSINESS, SIMPLIFIED') {
  return `<div class="eyebrow">${eyebrow}</div><div class="page-heading"><div><h1>${title}</h1><p>${desc}</p></div>${action ? `<button class="button primary" data-action="${action}">${icon('plus')}${label}</button>` : ''}</div>`;
}
function empty(title, desc, action = '', label = '') {
  return `<div class="empty-state">${icon('file')}<strong>${title}</strong><p>${desc}</p>${action ? `<button class="button primary" data-action="${action}">${icon('plus')}${label}</button>` : ''}</div>`;
}
function render() {
  const valid = ['quotes', 'customers', 'followups', 'settings'];
  state.page = valid.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'quotes';
  document.querySelectorAll('[data-nav]').forEach(el => el.classList.toggle('active', el.dataset.nav === state.page));
  $('#page-label').textContent = { quotes: '报价单', customers: '客户管理', followups: '跟进日程', settings: '商家设置' }[state.page];
  ({ quotes: renderQuotes, customers: renderCustomers, followups: renderFollowups, settings: renderSettings })[state.page]();
}
function renderQuotes() {
  const { quotes, today } = state.data;
  const pending = quotes.filter(q => q.status === 'pending');
  const won = quotes.filter(q => q.status === 'won');
  const due = pending.filter(q => q.nextFollowUp && q.nextFollowUp <= today);
  $('#main').innerHTML = heading('每一份报价，都向前一步。', '清晰报价，及时跟进。让每一次合作更简单。', 'new-quote', '新建报价') +
    `<section class="stats" aria-label="报价概览">
      <div class="stat"><div class="stat-label">${icon('clock')}待回复金额</div><div class="stat-value">${money(pending.reduce((s, q) => s + q.totalCents, 0))}</div><div class="stat-caption">${pending.length} 份报价，等待好消息</div></div>
      <div class="stat"><div class="stat-label">${icon('check')}已成交金额</div><div class="stat-value">${money(won.reduce((s, q) => s + q.totalCents, 0))}</div><div class="stat-caption">${won.length} 份报价，合作已达成</div></div>
      <div class="stat highlight"><div class="stat-label">${icon('calendar')}今日待跟进</div><div class="stat-value">${due.length}<small>位客户</small></div><div class="stat-caption">${due.length ? '一个及时的问候，离成交更近' : '今日跟进已安排妥当'}</div></div>
    </section>
    <section class="panel" aria-label="报价列表"><div class="panel-heading"><h2>我的报价单 <span class="count">${quotes.length}</span></h2><label class="search">${icon('search')}<input id="quote-search" aria-label="搜索报价" placeholder="搜索客户、报价名称或编号" value="${esc(state.search)}"></label></div>
    <div class="filters" role="group" aria-label="按状态筛选">${['all', 'pending', 'won', 'lost'].map(s => `<button class="filter ${state.filter === s ? 'active' : ''}" data-action="filter" data-filter="${s}">${s === 'all' ? '全部报价' : statusLabels[s]}<span>${s === 'all' ? quotes.length : quotes.filter(q => q.status === s).length}</span></button>`).join('')}</div>
    <div id="quote-results"></div></section>
    <div class="quiet-callout">${icon('info')}首次启动内置 5 组虚构客户与报价，可用于演示。报价记录会自动保存。</div>`;
  renderQuoteList();
}
function renderQuoteList() {
  const search = state.search.toLocaleLowerCase();
  const list = state.data.quotes.filter(q => (state.filter === 'all' || q.status === state.filter) && [q.title, q.number, q.customerSnapshot.name].some(v => v.toLocaleLowerCase().includes(search)));
  $('#quote-results').innerHTML = list.length ?
    `<div class="quote-table-header"><span>报价 / 客户</span><span>报价金额</span><span>状态</span><span>下次跟进</span><span></span></div>${list.map(q => `<button class="quote-row" data-action="detail" data-id="${q.id}" aria-label="查看 ${esc(q.title)}">
      <span class="quote-name"><span class="document-icon">${icon('file')}</span><span><strong>${esc(q.title)}</strong><span class="quote-subtitle"><span>${esc(q.customerSnapshot.name)}</span><span class="number">${q.number}</span></span></span></span>
      <span class="quote-amount">${money(q.totalCents)}</span><span class="quote-status">${pill(q.status)}</span><span class="quote-date ${q.status === 'pending' && q.nextFollowUp && q.nextFollowUp <= state.data.today ? 'overdue' : ''}">${q.nextFollowUp ? `${q.nextFollowUp}${q.status === 'pending' && q.nextFollowUp < state.data.today ? ' · 已到期' : ''}` : '未安排'}</span><span class="quote-arrow">${icon('arrow')}</span></button>`).join('')}
      <div class="panel-bottom"><span>共 ${list.length} 份报价 · 已自动保存</span><span>点击报价，查看详情与跟进</span></div>` : empty('这里还没有报价', state.search ? '换个关键词，或查看其他状态。' : '从第一份清晰的报价，开始下一笔好生意。', 'new-quote', '新建报价');
}
function renderCustomers() {
  $('#main').innerHTML = heading('记住客户，也记住信任。', '每一次联系，都从了解客户开始。', 'new-customer', '新增客户', 'GOOD CONNECTIONS, GOOD BUSINESS') +
    `<div class="panel-heading"><h2>全部客户 <span class="count">${state.data.customers.length}</span></h2><label class="search">${icon('search')}<input id="customer-search" aria-label="搜索客户" placeholder="搜索名称、联系人或电话" value="${esc(state.customerSearch)}"></label></div><div id="customer-results"></div>`;
  renderCustomerList();
}
function renderCustomerList() {
  const search = state.customerSearch.toLocaleLowerCase();
  const list = state.data.customers.filter(c => [c.name, c.contact, c.phone, c.email].some(v => v.toLocaleLowerCase().includes(search)));
  $('#customer-results').innerHTML = list.length ? `<div class="customer-grid">${list.map(c => `<article class="customer-card"><div class="customer-top"><span class="avatar">${esc(c.name[0])}</span><div><h3>${esc(c.name)}</h3><small>${state.data.quotes.filter(q => q.customerId === c.id).length} 份报价</small></div></div><p>联系人 · ${esc(c.contact || '未填写')}</p><p>电话 · ${esc(c.phone || '未填写')}</p><p>${esc(c.address || '地址待完善')}</p><div class="customer-actions"><button class="button text" data-action="edit-customer" data-id="${c.id}">${icon('edit')}编辑客户</button><button class="button text" data-action="customer-quote" data-id="${c.id}">为他报价 ${icon('arrow')}</button></div></article>`).join('')}</div>` : empty('暂无匹配客户', '添加客户，保存联系方式并为他报价。', 'new-customer', '新增客户');
}
function renderFollowups() {
  const list = state.data.quotes.filter(q => q.status === 'pending').sort((a, b) => (a.nextFollowUp || '9999').localeCompare(b.nextFollowUp || '9999'));
  $('#main').innerHTML = heading('及时跟进，让合作发生。', '待回复的报价，按下次跟进日期排列。', '', '', 'A LITTLE FOLLOW-UP GOES A LONG WAY') +
    `<section class="panel"><div class="panel-heading"><h2>待跟进报价 <span class="count">${list.length}</span></h2><span class="form-hint">含已到期与未安排的报价</span></div>${list.length ? list.map(q => `<article class="followup-row"><div class="date-block">${q.nextFollowUp ? `${q.nextFollowUp.slice(5, 7)} 月<strong>${q.nextFollowUp.slice(8)}</strong>` : '等待<strong>安排</strong>'}</div><div class="followup-content"><h3>${esc(q.customerSnapshot.name)} · ${esc(q.title)}</h3><p>${money(q.totalCents)} ${q.nextFollowUp && q.nextFollowUp <= state.data.today ? '· 现在可以联系客户了' : ''}</p></div><button class="button" data-action="detail" data-id="${q.id}">记录跟进 ${icon('arrow')}</button></article>`).join('') : empty('所有跟进已完成', '新的待回复报价会出现在这里。')}</section>`;
}
const field = (name, label, value = '', options = {}) => `<div class="form-field ${options.full ? 'full' : ''}"><label for="${name}">${label}${options.required ? '<span class="required">*</span>' : ''}</label>${options.area ? `<textarea id="${name}" name="${name}" maxlength="${options.max || 400}">${esc(value)}</textarea>` : `<input id="${name}" name="${name}" value="${esc(value)}" type="${options.type || 'text'}" ${options.required ? 'required' : ''} maxlength="${options.max || 60}" ${options.placeholder ? `placeholder="${esc(options.placeholder)}"` : ''}>`}</div>`;
function renderSettings() {
  const m = state.data.merchant;
  $('#main').innerHTML = heading('属于你的商家工作台。', '完善商家信息，给客户一份更专业的报价。', '', '', 'MADE FOR YOUR BUSINESS') + `<div class="settings-grid"><section class="settings-card"><h2>报价方信息</h2><p>将显示在新报价的 PDF 中。已有报价保留原始信息。</p><form id="merchant-form"><div class="form-error" role="alert"></div><div class="form-grid">${field('name', '商家名称', m.name, { required: true, full: true })}${field('contact', '联系人', m.contact, { max: 40 })}${field('phone', '联系电话', m.phone, { type: 'tel', max: 40 })}${field('address', '商家地址', m.address, { full: true, max: 160 })}${field('terms', '默认合作条款', m.terms, { full: true, area: true, max: 300 })}</div><button class="button primary settings-submit" type="submit">保存商家信息</button></form></section><div><section class="settings-card"><h2>数据备份与恢复</h2><p>导出客户、报价、跟进记录和商家信息。请定期把备份保存在其他设备。</p><div class="backup-actions"><button class="button" data-action="backup">${icon('download')}导出备份</button><button class="button" data-action="choose-restore">恢复备份</button></div><input id="restore-file" type="file" accept=".json,application/json" hidden><div class="form-hint">恢复会替换现有数据。系统会先校验文件，并在服务端保留一份恢复前备份。支持本工具导出的 JSON 文件，最大 8 MB。</div></section><section class="settings-card"><h2>访问与数据</h2><div class="security-state">${icon('check')} ${state.data.passwordProtected ? '已启用商家访问密码' : '当前为本机演示模式'}</div><p>单商家版本，数据保存到服务端 SQLite。局域网或正式试用时，请按部署说明设置访问密码与 HTTPS。</p><div class="form-hint">所有内置示例均为虚构信息。无 AI API、支付、统计追踪或第三方数据连接。</div></section></div></div>`;
}
function openModal(title, subtitle, content, footer = '') {
  modal.innerHTML = `<header class="modal-header"><div><h2 id="modal-title">${title}</h2>${subtitle ? `<small>${esc(subtitle)}</small>` : ''}</div><button class="icon-button" data-action="close" aria-label="关闭">${icon('close')}</button></header>${content}${footer ? `<footer class="modal-footer">${footer}</footer>` : ''}`;
  if (!modal.open) modal.showModal();
  document.body.classList.add('modal-open');
  modal.scrollTop = 0;
}
function closeModal() { modal.close(); }
modal.addEventListener('close', () => document.body.classList.remove('modal-open'));
function showCustomer(id, returnToQuote = false) {
  customerReturn = returnToQuote ? { ...quoteEdit, input: readQuoteForm() } : null;
  const c = state.data.customers.find(c => c.id === id) || {};
  openModal(id ? '编辑客户' : '新增客户', '清晰的客户信息，是合作的第一步。', `<form id="customer-form" data-id="${id || ''}"><div class="modal-body"><div class="form-error" role="alert"></div><div class="form-grid">${field('name', '客户 / 公司名称', c.name, { required: true, full: true, placeholder: '如：山野咖啡' })}${field('contact', '联系人', c.contact, { max: 40 })}${field('phone', '联系电话', c.phone, { type: 'tel', max: 40 })}${field('email', '邮箱', c.email, { type: 'email', max: 120, full: true })}${field('address', '地址', c.address, { full: true, max: 160 })}${field('notes', '客户备注', c.notes, { full: true, area: true })}</div></div><footer class="modal-footer"><button class="button" type="button" data-action="close">取消</button><button class="button primary" type="submit">保存客户</button></footer></form>`);
}
function addDays(date, count) { return new Date(Date.parse(`${date}T12:00:00Z`) + count * 86400000).toISOString().slice(0, 10); }
function showQuoteForm(id, customerId, input) {
  const old = id ? state.data.quotes.find(q => q.id === id) : null;
  quoteEdit = { id: old?.id || null, version: old?.version };
  draft = input || (old ? { ...old, items: old.items.map(i => ({ ...i })) } : { customerId: customerId || state.data.customers[0]?.id || '', title: '', quoteDate: state.data.today, validUntil: addDays(state.data.today, 14), nextFollowUp: '', notes: '', items: [{ name: '', quantity: '1', unit: '项', unitPrice: '' }] });
  openModal(old ? '编辑报价' : '新建报价', old?.number || '把价值讲清楚，把合作向前推一步。', `<form id="quote-form"><div class="modal-body"><div class="form-error" role="alert"></div><div class="form-grid"><div class="form-field full"><div class="customer-select-label"><label for="customerId">报价客户 <span class="required">*</span></label><button type="button" data-action="inline-customer">+ 新增客户</button></div><select id="customerId" name="customerId" required><option value="">请选择客户</option>${state.data.customers.map(c => `<option value="${c.id}" ${draft.customerId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>${field('title', '报价名称', draft.title, { full: true, required: true, max: 80, placeholder: '如：门店品牌升级方案' })}${field('quoteDate', '报价日期', draft.quoteDate, { type: 'date', required: true })}${field('validUntil', '有效期至', draft.validUntil, { type: 'date', required: true })}</div><div class="section-heading"><h3>商品与服务</h3><small>数量 × 单价，自动计算</small></div><div id="line-items"></div><button class="button text" data-action="add-item" type="button">${icon('plus')}添加一项</button><div class="total-strip"><span>报价合计（人民币）</span><strong id="quote-total" aria-live="polite">¥0.00</strong></div><div class="form-grid">${field('nextFollowUp', '下次跟进日期', draft.nextFollowUp, { type: 'date', full: true })}${field('notes', '报价说明', draft.notes, { full: true, area: true, max: 600 })}</div><p class="form-hint">单价保留 2 位小数，数量支持 3 位小数。逐项四舍五入到分后汇总。</p></div><footer class="modal-footer"><button class="button" type="button" data-action="close">取消</button><button class="button primary" type="submit">${old ? '保存修改' : '保存报价'}</button></footer></form>`);
  renderLineItems();
}
function renderLineItems() {
  $('#line-items').innerHTML = draft.items.map((it, i) => `<section class="line-item" data-index="${i}"><div class="line-item-top"><span class="item-label">${String(i + 1).padStart(2, '0')}</span><input name="item-name" aria-label="第 ${i + 1} 项名称" placeholder="商品或服务名称" maxlength="80" value="${esc(it.name)}" required><button class="icon-button" data-action="remove-item" data-index="${i}" type="button" aria-label="删除第 ${i + 1} 项">${icon('close')}</button></div><div class="line-item-values"><div><label for="qty-${i}">数量</label><input id="qty-${i}" name="quantity" inputmode="decimal" maxlength="12" value="${esc(it.quantity)}" required></div><div><label for="unit-${i}">单位</label><input id="unit-${i}" name="unit" maxlength="10" value="${esc(it.unit)}"></div><div><label for="price-${i}">单价（元）</label><input id="price-${i}" name="unitPrice" inputmode="decimal" maxlength="12" value="${esc(it.unitPrice)}" placeholder="0.00" required></div><output class="line-amount" aria-label="第 ${i + 1} 项金额">—</output></div></section>`).join('');
  updateTotals();
}
function readQuoteForm() {
  const form = $('#quote-form');
  const f = Object.fromEntries(new FormData(form));
  return { customerId: f.customerId, title: f.title, quoteDate: f.quoteDate, validUntil: f.validUntil, nextFollowUp: f.nextFollowUp, notes: f.notes, items: [...form.querySelectorAll('.line-item')].map(row => ({ name: $('[name=item-name]', row).value, quantity: $('[name=quantity]', row).value, unit: $('[name=unit]', row).value, unitPrice: $('[name=unitPrice]', row).value })) };
}
function updateTotals() {
  const input = readQuoteForm();
  input.items.forEach((it, i) => {
    try { $(`.line-item[data-index="${i}"] output`).textContent = money(calculateItems([it]).totalCents); }
    catch { $(`.line-item[data-index="${i}"] output`).textContent = '—'; }
  });
  try { $('#quote-total').textContent = money(calculateItems(input.items).totalCents); }
  catch { $('#quote-total').textContent = '待完善'; }
}
function showDetail(id) {
  const q = state.data.quotes.find(q => q.id === id), c = q.customerSnapshot;
  openModal('报价详情', '一份清晰的报价，一次用心的合作。', `<div class="modal-body"><div class="detail-meta"><span class="detail-number">${q.number}</span>${pill(q.status)}</div><h3 class="detail-title">${esc(q.title)}</h3><div class="detail-parties"><div><label>报价客户</label><strong>${esc(c.name)}</strong><p>${esc([c.contact, c.phone, c.address].filter(Boolean).join('\n'))}</p></div><div><label>报价商家</label><strong>${esc(q.merchantSnapshot.name)}</strong><p>${esc([q.merchantSnapshot.contact, q.merchantSnapshot.phone].filter(Boolean).join('\n'))}</p></div></div><div class="detail-dates"><span>报价日期 ${q.quoteDate}</span><span>有效期至 ${q.validUntil}</span></div>${q.items.map(it => `<div class="detail-item"><div><strong>${esc(it.name)}</strong><small>${esc(it.quantity)} ${esc(it.unit)} × ¥${esc(it.unitPrice)}</small></div><span class="amount">${money(it.amountCents)}</span></div>`).join('')}<div class="total-strip"><span>报价合计（人民币）</span><strong>${money(q.totalCents)}</strong></div>${q.notes ? `<div class="detail-note">${esc(q.notes)}</div>` : ''}<div class="section-heading"><h3>跟进这份报价</h3><small>记录进展，不错过合作</small></div><form id="followup-form" class="followup-form" data-id="${q.id}"><div class="form-error" role="alert"></div><div class="form-grid"><div class="form-field"><label for="status">报价状态</label><select name="status" id="status">${Object.entries(statusLabels).map(([value, label]) => `<option value="${value}" ${q.status === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div>${field('nextFollowUp', '下次跟进', q.nextFollowUp, { type: 'date' })}${field('note', '本次跟进记录', '', { full: true, area: true, max: 300 })}</div><button class="button primary settings-submit" type="submit">保存跟进</button></form>${q.followUps.length ? `<div class="followup-history">${q.followUps.map(f => `<div class="history-entry">${statusLabels[f.status]} <small>· ${new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'short' }).format(new Date(f.at))}${f.nextFollowUp ? ` · 下次 ${f.nextFollowUp}` : ''}</small>${f.note ? `<p>${esc(f.note)}</p>` : ''}</div>`).join('')}</div>` : ''}</div>`, `<button class="button" data-action="edit-quote" data-id="${q.id}">${icon('edit')}编辑报价</button><button class="button primary" data-action="pdf" data-id="${q.id}">${icon('download')}导出中文 PDF</button>`);
}
async function download(url, filename) {
  const response = await fetch(url);
  if (!response.ok) { const error = await response.json(); throw new Error(error.error || '下载失败'); }
  const objectUrl = URL.createObjectURL(await response.blob());
  const a = document.createElement('a'); a.href = objectUrl; a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
}
function formError(form, message) { const el = $('.form-error', form); el.textContent = message; el.classList.add('visible'); el.scrollIntoView({ block: 'center' }); }
document.addEventListener('input', event => {
  if (event.target.id === 'quote-search') { state.search = event.target.value; renderQuoteList(); }
  else if (event.target.id === 'customer-search') { state.customerSearch = event.target.value; renderCustomerList(); }
  else if (event.target.closest('.line-item')) updateTotals();
});
document.addEventListener('submit', async event => {
  const form = event.target;
  if (!['customer-form', 'quote-form', 'merchant-form', 'followup-form'].includes(form.id)) return;
  event.preventDefault();
  const button = $('button[type=submit]', form); button.disabled = true;
  try {
    if (form.id === 'customer-form') {
      const id = form.dataset.id, returnInfo = customerReturn;
      const c = await api(`/api/customers${id ? `/${id}` : ''}`, id ? 'PUT' : 'POST', Object.fromEntries(new FormData(form)));
      await refresh();
      if (returnInfo) showQuoteForm(returnInfo.id, c.id, { ...returnInfo.input, customerId: c.id }); else closeModal();
      toast('客户已保存');
    } else if (form.id === 'quote-form') {
      const input = readQuoteForm(); calculateItems(input.items);
      const q = await api(`/api/quotes${quoteEdit.id ? `/${quoteEdit.id}` : ''}`, quoteEdit.id ? 'PUT' : 'POST', { ...input, ...(quoteEdit.id ? { version: quoteEdit.version } : {}) });
      await refresh(); showDetail(q.id); toast('报价已保存，可以导出 PDF');
    } else if (form.id === 'merchant-form') {
      await api('/api/merchant', 'PUT', Object.fromEntries(new FormData(form))); await refresh(); toast('商家信息已保存');
    } else {
      const q = await api(`/api/quotes/${form.dataset.id}/follow-up`, 'PATCH', Object.fromEntries(new FormData(form)));
      await refresh(); showDetail(q.id); toast('跟进记录已保存');
    }
  } catch (error) { formError(form, error.message); }
  finally { button.disabled = false; }
});
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]'); if (!button || button.disabled) return;
  const { action, id } = button.dataset;
  try {
    if (action === 'new-quote') showQuoteForm();
    else if (action === 'new-customer') showCustomer();
    else if (action === 'edit-customer') showCustomer(id);
    else if (action === 'inline-customer') showCustomer(null, true);
    else if (action === 'customer-quote') showQuoteForm(null, id);
    else if (action === 'detail') showDetail(id);
    else if (action === 'edit-quote') showQuoteForm(id);
    else if (action === 'close') closeModal();
    else if (action === 'filter') { state.filter = button.dataset.filter; renderQuotes(); }
    else if (action === 'add-item' || action === 'remove-item') {
      draft = readQuoteForm();
      if (action === 'add-item') {
        if (draft.items.length >= 100) return toast('一份报价最多 100 项');
        draft.items.push({ name: '', quantity: '1', unit: '项', unitPrice: '' });
      } else {
        if (draft.items.length === 1) return toast('请至少保留一项商品或服务');
        draft.items.splice(Number(button.dataset.index), 1);
      }
      renderLineItems();
    } else if (action === 'pdf' || action === 'backup') {
      button.disabled = true;
      if (action === 'pdf') { const q = state.data.quotes.find(q => q.id === id); toast('正在生成中文 PDF…'); await download(`/api/quotes/${id}/pdf`, `${q.number}-${q.customerSnapshot.name}.pdf`); }
      else await download('/api/backup', `merchant-quotes-${state.data.today}.json`);
      toast(action === 'pdf' ? 'PDF 已生成，请在浏览器下载中查看' : '备份已导出');
    } else if (action === 'choose-restore') $('#restore-file').click();
    else if (action === 'confirm-restore') {
      button.disabled = true;
      const result = await api('/api/restore', 'POST', restoreData);
      restoreData = null; closeModal(); await refresh(); toast(`恢复完成：${result.customers} 位客户、${result.quotes} 份报价`);
    } else if (action === 'retry') await refresh();
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
});
document.addEventListener('change', async event => {
  if (event.target.id !== 'restore-file') return;
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 8 * 1024 * 1024) throw new Error('备份不能超过 8 MB');
    const b = JSON.parse(await file.text());
    if (b.format !== 'merchant-quotes' || b.schemaVersion !== 1 || !Array.isArray(b.customers) || !Array.isArray(b.quotes)) throw new Error('请选择本工具导出的有效备份文件');
    restoreData = b;
    openModal('恢复数据备份', '请确认本次恢复的范围。', `<div class="modal-body"><div class="notice">此操作会替换当前全部客户、报价和商家设置。系统会在校验通过后，自动保留一份恢复前备份。</div><div class="restore-summary">文件：${esc(file.name)}<br>商家：${esc(b.merchant?.name)}<br>包含：${b.customers.length} 位客户 / ${b.quotes.length} 份报价</div><p class="form-hint">请仅恢复你有权使用的商家数据。服务端将再次完整校验备份。</p></div>`, '<button class="button" data-action="close">取消</button><button class="button primary" data-action="confirm-restore">确认替换并恢复</button>');
  } catch (error) { toast(error instanceof SyntaxError ? '文件不是有效的 JSON 备份' : error.message); }
  event.target.value = '';
});
window.addEventListener('hashchange', () => { if (state.data) render(); });
refresh().catch(() => { $('#main').innerHTML = empty('暂时无法连接服务', '请确认服务已启动，然后重新加载。', 'retry', '重新连接'); });
