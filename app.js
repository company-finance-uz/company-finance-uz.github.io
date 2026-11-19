(() => {
"use strict";
/* ================= helpers ================= */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nf = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const money = (v, cur) => nf.format(Math.round((+v || 0) * 100) / 100) + (cur === "USD" ? " $" : "");
const parseNum = s => { if (typeof s === "number") return s; s = String(s || "").replace(/[\s ]/g, "").replace(",", "."); const v = parseFloat(s); return isFinite(v) ? v : NaN; };
const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const fmtDate = d => d ? d.slice(8, 10) + "." + d.slice(5, 7) + "." + d.slice(0, 4) : "";
const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const monthName = ym => { const [y, m] = ym.split("-"); return MONTHS[+m - 1] + " " + y; };
const initials = s => (s || "?").trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();

const STATUSES = [["lead", "Переговоры", "st-wait"], ["contract", "Договор подписан", "st-work"], ["work", "В работе", "st-work"], ["handover", "Сдача работ", "st-wait"], ["paid", "Оплачен", "st-done"], ["closed", "Закрыт", ""]];
const stName = s => (STATUSES.find(x => x[0] === s) || STATUSES[0])[1];
const stCls = s => (STATUSES.find(x => x[0] === s) || STATUSES[0])[2];
const DOCKINDS = ["Договор", "Счёт-фактура", "Доверенность", "Акт выполненных работ", "Доп. соглашение", "Другое"];
// Обязательные документы проекта и их статусы
const REQDOCS = ["Договор", "Счёт-фактура", "Доверенность", "Акт выполненных работ"];
const DOCDEF = { "Акт выполненных работ": "none" };
const DOCST = [["none", "Не нужен", ""], ["todo", "Нужно сделать", "st-debt"], ["ready", "Подготовлен", "st-wait"], ["sent", "Отправлен заказчику", "st-work"], ["signed", "Подписан, закрыт", "st-done"]];
const dsName = s => (DOCST.find(x => x[0] === s) || DOCST[1])[1];
const dsCls = s => (DOCST.find(x => x[0] === s) || DOCST[1])[2];
const ROLES = { owner: "Владелец", partner: "Партнёр", accountant: "Бухгалтер", pending: "Без доступа" };

/* ================= state ================= */
const cfg = window.APP_CONFIG || {};
const S = {
  sb: null, session: null, me: null,
  accounts: [], settings: null, projects: [], documents: [], ops: [], profiles: [],
  loaded: false, f: { month: "", account: "", project: "", cat: "", who: "", type: "", chain: "" }, cfMonth: ""
};
const isFull = () => S.me && (S.me.role === "owner" || S.me.role === "partner");
const isOwner = () => S.me && S.me.role === "owner";
const canWrite = () => S.me && S.me.role !== "pending";
const st = () => Object.assign({ opening_date: today(), usd_rate: 0, out_cats: [], in_cats: [], people: [], entities: ["МЧЖ ADVERT SOLUTION", "ЯТТ"] }, S.settings || {});
const accCur = name => (S.accounts.find(a => a.name === name) || {}).currency || "UZS";
const uzs = o => o.currency === "USD" ? (+o.amount || 0) * (+o.rate || 0) : (+o.amount || 0);
const inCur = (o, cur) => { if ((o.currency || "UZS") === cur) return +o.amount || 0; if (cur === "UZS") return uzs(o); const r = +st().usd_rate || +o.rate || 0; return r ? uzs(o) / r : 0; };
const pname = id => { const p = S.profiles.find(x => x.id === id); return p ? (p.full_name || p.email) : ""; };

function balances() {
  const b = {}, od = st().opening_date;
  S.accounts.forEach(a => b[a.name] = +a.opening || 0);
  for (const o of S.ops) {
    if (o.op_date < od) continue;
    const a = +o.amount || 0;
    if (o.type === "in") b[o.account] = (b[o.account] || 0) + a;
    else if (o.type === "out") b[o.account] = (b[o.account] || 0) - a;
    else { b[o.account] = (b[o.account] || 0) - a; b[o.to_account] = (b[o.to_account] || 0) + (o.amount_to != null ? +o.amount_to : a); }
  }
  return b;
}
function docState(p) {
  const d = (p && p.docs && typeof p.docs === "object") ? p.docs : {};
  return REQDOCS.map(k => Object.assign({ kind: k, status: DOCDEF[k] || "todo", no: "", date: "" }, d[k] || {}));
}
const addenda = p => Array.isArray(p && p.addenda) ? p.addenda : [];
const rid = () => Math.random().toString(36).slice(2, 9);
const itemsBase = p => Array.isArray(p && p.items) ? p.items : [];
// Товары с учётом доп. соглашений [0, upto)
function itemsAt(p, upto) {
  const list = itemsBase(p).map(x => Object.assign({}, x));
  addenda(p).slice(0, upto == null ? undefined : upto).forEach((a, ai) => (a.changes || []).forEach(c => {
    const tag = "доп. №" + (a.no || ai + 1), i = list.findIndex(x => x.id === c.id);
    if (i >= 0) { const old = list[i]; list[i] = Object.assign({}, old, c, { was: old.was || { qty: old.qty, price: old.price }, by: tag }); }
    else list.push(Object.assign({}, c, { added: tag }));
  }));
  return list;
}
const itemNet = x => (+x.qty || 0) * (+x.price || 0);
const itemGross = x => itemNet(x) * (1 + (x.vat == null ? 0 : +x.vat) / 100);
const r2 = v => Math.round(v * 100) / 100;
// Вид расхода проекта: goods — сам товар, other — прочее (такси, доставка…)
const costKind = (o, byId) => o.cost_type || (o.item_id && (!byId || byId[o.item_id]) ? "goods" : "other");
let costOpen = false; try { costOpen = localStorage.getItem("cf-cost-open") === "1"; } catch (e) {}
function contractTotal(p) {
  const its = itemsAt(p), extra = addenda(p).filter(a => !(a.changes || []).length).reduce((s, a) => s + (+a.delta || 0), 0);
  return its.length ? r2(its.reduce((s, x) => s + itemGross(x), 0)) + extra : (+p.contract_sum || 0) + extra;
}
function docSummary(p) {
  const l = docState(p).filter(x => x.status !== "none").concat(addenda(p).map(a => ({ kind: "Доп. соглашение" + (a.no ? " №" + a.no : ""), status: a.status || "todo" })));
  const done = l.filter(x => x.status === "signed");
  return { done: done.length, total: l.length, closed: l.length > 0 && done.length === l.length, missing: l.filter(x => x.status !== "signed").map(x => x.kind) };
}
function curStage(p) {
  const s = Array.isArray(p.stages) ? p.stages : [], n = s.find(x => !x.done);
  return n ? n.name : s.length ? "Все этапы выполнены" : "";
}
const docBadge = p => { const d = docSummary(p); return d.total ? `<span class="pill ${d.closed ? "st-done" : "st-debt"}" title="${d.closed ? "Все документы подписаны" : "Не закрыто: " + esc(d.missing.join(", "))}">${d.closed ? "Документы закрыты" : `Документы ${d.done}/${d.total}`}</span>` : ""; };
function projMoney(p) {
  const cur = p.currency || "UZS", ops = S.ops.filter(o => o.project_id === p.id);
  const received = ops.filter(o => o.type === "in").reduce((s, o) => s + inCur(o, cur), 0);
  const spent = ops.filter(o => o.type === "out").reduce((s, o) => s + inCur(o, cur), 0);
  const docs = S.documents.filter(d => d.project_id === p.id);
  const invoiced = docs.filter(d => d.kind === "Счёт-фактура").reduce((s, d) => s + (+d.amount || 0), 0);
  const items = itemsAt(p), contract = contractTotal(p);
  const base = itemsBase(p).length ? r2(itemsBase(p).reduce((s, x) => s + itemGross(x), 0)) : (+p.contract_sum || 0), add = contract - base;
  const outs = ops.filter(o => o.type === "out");
  const itemRows = items.map(x => Object.assign({}, x, { net: itemNet(x), gross: itemGross(x), goods: 0, other: 0 }));
  const byId = Object.fromEntries(itemRows.map(x => [x.id, x])), netTotal = itemRows.reduce((s, x) => s + x.net, 0);
  let otherCost = 0, otherShared = 0;
  for (const o of outs) {
    const a = inCur(o, cur), row = o.item_id && byId[o.item_id], kind = costKind(o, byId);
    if (kind === "goods" && row) { row.goods += a; continue; }
    otherCost += a;
    if (row) row.other += a;
    else if (itemRows.length) {
      otherShared += a; let left = a;
      itemRows.forEach((x, i) => { const part = i === itemRows.length - 1 ? left : Math.round(netTotal ? a * x.net / netTotal : a / itemRows.length); x.other += part; left -= part; });
    }
  }
  itemRows.forEach(x => { x.cost = x.goods + x.other; x.margin = x.net - x.cost; });
  const margin = netTotal - spent;
  return { items: itemRows, otherCost, otherShared, netTotal, margin, base, add, cur, received, spent, invoiced, contract, debt: Math.max(contract - received, 0), unpaidInv: Math.max(invoiced - received, 0), profit: received - spent, ops, docs };
}

/* ================= data ================= */
async function fetchAll(table, order) {
  let out = [], from = 0;
  for (;;) {
    let q = S.sb.from(table).select("*").range(from, from + 999);
    if (order) q = q.order(order, { ascending: true });
    const { data, error } = await q;
    if (error) throw error;
    out = out.concat(data);
    if (data.length < 1000) return out;
    from += 1000;
  }
}
const LOADERS = {
  accounts: async () => { S.accounts = await fetchAll("accounts", "sort"); },
  settings: async () => { const { data, error } = await S.sb.from("settings").select("*").maybeSingle(); if (error) throw error; S.settings = data; },
  projects: async () => { S.projects = await fetchAll("projects", "created_at"); },
  documents: async () => { S.documents = await fetchAll("documents", "created_at"); },
  ops: async () => { S.ops = await fetchAll("ops", "op_date"); },
  profiles: async () => { S.profiles = await fetchAll("profiles", "created_at"); const m = S.profiles.find(p => p.id === S.session.user.id); if (m) S.me = m; }
};
async function load(tables) {
  try { await Promise.all(tables.map(t => LOADERS[t]())); }
  catch (e) { toast(errText(e)); }
}
let pending = new Set(), ptimer;
function scheduleReload(t) { if (!LOADERS[t]) return; pending.add(t); clearTimeout(ptimer); ptimer = setTimeout(async () => { const ts = [...pending]; pending.clear(); await load(ts); render(); }, 250); }
async function afterWrite(...tables) { await load(tables); render(); }

const errText = e => {
  const m = (e && (e.message || e.error_description)) || "";
  if (/row-level security|permission denied/i.test(m)) return "Нет прав на это действие для вашей роли.";
  if (/Invalid login credentials/i.test(m)) return "Неверная почта или пароль.";
  if (/Email not confirmed/i.test(m)) return "Почта не подтверждена. Попросите владельца подтвердить пользователя.";
  if (/Password should be/i.test(m)) return "Пароль слишком короткий: минимум 6 символов.";
  if (/Failed to fetch|NetworkError/i.test(m)) return "Нет связи с сервером. Проверьте интернет.";
  if (/mime|type/i.test(m) && /not supported|invalid/i.test(m)) return "Этот тип файла не поддерживается. Загрузите PDF или фото.";
  return m ? "Ошибка: " + m : "Не удалось выполнить действие. Попробуйте ещё раз.";
};

/* ================= auth screens ================= */
function showLogin(mode = "login", msg = "") {
  $("#shell").hidden = true; const L = $("#login"); L.hidden = false;
  if (!cfg.SUPABASE_URL || /ВАШ-ПРОЕКТ/.test(cfg.SUPABASE_URL)) {
    L.innerHTML = `<div class="panel login-card"><h1>Сайт ещё не подключён</h1><p class="muted">Откройте файл <b>config.js</b> и вставьте адрес и ключ своего проекта Supabase (см. ИНСТРУКЦИЯ.md).</p></div>`; return;
  }
  const titles = { login: "Вход", reset: "Восстановить пароль", newpass: "Новый пароль" };
  L.innerHTML = `<form class="panel login-card" id="auth-form">
    <div><div class="eyebrow">Учёт МЧЖ и ЯТТ</div><h1>${titles[mode]}</h1></div>
    ${mode !== "newpass" ? `<label class="f">Почта<input type="email" id="a-email" autocomplete="username" required></label>` : ""}
    ${mode !== "reset" ? `<label class="f">${mode === "newpass" ? "Новый пароль" : "Пароль"}<input type="password" id="a-pass" autocomplete="${mode === "newpass" ? "new-password" : "current-password"}" required minlength="6"></label>` : ""}
    <div class="err" id="a-err">${esc(msg)}</div>
    <button class="btn primary" id="a-btn" style="justify-content:center">${mode === "login" ? "Войти" : mode === "reset" ? "Отправить ссылку на почту" : "Сохранить пароль"}</button>
    ${mode === "login" ? `<button type="button" class="btn" data-mode="reset" style="justify-content:center">Забыли пароль?</button><p class="muted" style="font-size:13px;margin:0">Аккаунт создаёт владелец. Если у вас его нет, обратитесь к нему.</p>` : ""}
    ${mode === "reset" ? `<button type="button" class="btn" data-mode="login" style="justify-content:center">Назад ко входу</button>` : ""}
  </form>`;
  L.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => showLogin(b.dataset.mode));
  $("#auth-form").onsubmit = async e => {
    e.preventDefault(); const btn = $("#a-btn"), err = $("#a-err"); err.textContent = ""; btn.disabled = true;
    try {
      if (mode === "login") {
        const { error } = await S.sb.auth.signInWithPassword({ email: $("#a-email").value.trim(), password: $("#a-pass").value });
        if (error) throw error;
      } else if (mode === "reset") {
        const { error } = await S.sb.auth.resetPasswordForEmail($("#a-email").value.trim(), { redirectTo: location.origin + location.pathname });
        if (error) throw error; err.style.color = "var(--in)"; err.textContent = "Ссылка отправлена. Проверьте почту.";
      } else {
        const { error } = await S.sb.auth.updateUser({ password: $("#a-pass").value });
        if (error) throw error; toast("Пароль сохранён"); recovering = false; S.loaded = false; start();
      }
    } catch (x) { err.style.color = ""; err.textContent = errText(x); }
    btn.disabled = false;
  };
}
function showPending() {
  $("#shell").hidden = true; const L = $("#login"); L.hidden = false;
  L.innerHTML = `<div class="panel login-card"><div class="eyebrow">Учёт МЧЖ и ЯТТ</div><h1>Доступ ещё не открыт</h1>
  <p class="muted">Вы вошли как <b>${esc(S.session.user.email)}</b>. Владелец должен назначить вам роль в разделе «Пользователи». После этого обновите страницу.</p>
  <div class="row"><button class="btn" id="p-reload">Обновить</button><button class="btn" id="p-out">Выйти</button></div></div>`;
  $("#p-reload").onclick = () => location.reload();
  $("#p-out").onclick = () => S.sb.auth.signOut();
}

/* ================= routing ================= */
const views = () => [["overview", "Главная"], ["projects", "Проекты"], ["ops", "Операции"], ["cashflow", "Cash flow"], ["accounts", "Счета"], ...(isOwner() ? [["users", "Пользователи"]] : [])];
const route = () => location.hash.slice(1) || "overview";
function navs() {
  const r = route(), cur = r.startsWith("project-") ? "projects" : r.startsWith("chain-") ? "ops" : r;
  const h = views().map(([k, t]) => `<a href="#${k}"${k === cur ? ' aria-current="page"' : ""}>${t}</a>`).join("");
  $("#tabs").innerHTML = h;
  $("#btabs").innerHTML = views().filter(v => v[0] !== "users").map(([k, t]) => `<a href="#${k}"${k === cur ? ' aria-current="page"' : ""}>${t}</a>`).join("");
  const nm = S.me.full_name || S.session.user.email;
  $("#me").innerHTML = `<button class="me-btn" data-act="me" aria-haspopup="true"><span class="avatar">${esc(initials(nm))}</span><span class="nm">${esc(nm)}</span></button>`;
}
window.addEventListener("hashchange", () => { closeMenu(); render(); window.scrollTo(0, 0); });

function render() {
  if (!S.loaded || !S.me) return;
  navs();
  $("#fab").hidden = !canWrite();
  const r = route();
  if (r.startsWith("project-")) return vProject(r.slice(8));
  if (r.startsWith("chain-")) return vChain(decodeURIComponent(r.slice(6)));
  ({ overview: vOverview, projects: vProjects, ops: vOps, cashflow: vCash, accounts: vAccounts, users: isOwner() ? vUsers : vOverview }[r] || vOverview)();
}

/* ================= views ================= */
const sortOps = (a, b) => (b.op_date || "").localeCompare(a.op_date || "") || (b.created_at || "").localeCompare(a.created_at || "");
const months = () => [...new Set(S.ops.map(o => (o.op_date || "").slice(0, 7)).filter(Boolean))].sort().reverse();

function vOverview() {
  const s = st(), b = balances(), ym = today().slice(0, 7);
  const mOps = S.ops.filter(o => (o.op_date || "").startsWith(ym));
  const mi = mOps.filter(o => o.type === "in").reduce((x, o) => x + uzs(o), 0), mo = mOps.filter(o => o.type === "out").reduce((x, o) => x + uzs(o), 0);
  const act = S.projects.filter(p => p.status !== "closed");
  let debt = 0; act.forEach(p => { const m = projMoney(p); debt += m.cur === "USD" ? m.debt * (+s.usd_rate || 0) : m.debt; });
  const total = S.accounts.reduce((x, a) => x + (a.currency === "USD" ? (b[a.name] || 0) * (+s.usd_rate || 0) : (b[a.name] || 0)), 0);
  const recent = [...S.ops].sort(sortOps).slice(0, 8);
  $("#app").innerHTML = `
  <div><div class="eyebrow">${esc(monthName(ym))}</div><h1>Главная</h1></div>
  <div class="grid kpis">
    <div class="kpi"><span class="eyebrow">Деньги на счетах</span><span class="v num">${money(total)}</span><span class="s">сум${s.usd_rate ? "" : " · доллары без курса не учтены"}</span></div>
    <div class="kpi"><span class="eyebrow">Пришло за месяц</span><span class="v num pos">${money(mi)}</span><span class="s">${mOps.filter(o => o.type === "in").length} поступлений</span></div>
    <div class="kpi"><span class="eyebrow">Ушло за месяц</span><span class="v num neg">${money(mo)}</span><span class="s">${mOps.filter(o => o.type === "out").length} расходов</span></div>
    <div class="kpi"><span class="eyebrow">Должны заказчики</span><span class="v num">${money(debt)}</span><span class="s">по ${act.length} активным проектам</span></div>
  </div>
  <section class="panel"><div class="panel-h"><h2>Остатки по счетам</h2><a class="btn small" href="#accounts">Счета</a></div>
    <div class="panel-b"><div class="grid accounts">${S.accounts.map(a => `<div class="acc"><span class="n">${esc(a.name)}</span><span class="v num ${(b[a.name] || 0) < 0 ? "neg" : ""}">${money(b[a.name], a.currency)}</span></div>`).join("")}</div>
    <p class="muted" style="margin:10px 0 0;font-size:13px">Начальные остатки на ${fmtDate(s.opening_date)} плюс операции после этой даты.</p></div></section>
  <div class="grid two">
    <section class="panel"><div class="panel-h"><h2>Проекты в работе</h2>${canWrite() ? '<button class="btn small" data-act="new-project">+ Проект</button>' : ""}</div>
      ${act.length ? act.map(projCard).join("") : `<div class="empty">Проектов пока нет.${canWrite() ? '<button class="btn primary" data-act="new-project">Добавить первый проект</button>' : ""}</div>`}</section>
    <section class="panel"><div class="panel-h"><h2>Последние операции</h2><a class="btn small" href="#ops">Все</a></div>
      ${recent.length ? opsTable(recent, true) : `<div class="empty">Операций пока нет. Нажмите «+», чтобы записать расход или оплату.</div>`}</section>
  </div>`;
}
function projCard(p) {
  const m = projMoney(p), pct = m.contract ? Math.min(100, m.received / m.contract * 100) : 0;
  return `<a class="proj" href="#project-${esc(p.id)}"><div class="row between"><span class="t">${esc(p.name)}</span><span class="pill ${stCls(p.status)}">${stName(p.status)}</span></div>
  <div class="row between muted" style="font-size:13px"><span>${esc([p.entity, p.client || "Заказчик не указан"].filter(Boolean).join(" · "))}</span><span class="num">${money(m.received, m.cur)} из ${money(m.contract, m.cur)}</span></div>
  <div class="bar"><i style="width:${pct.toFixed(1)}%"></i></div>
  <div class="row" style="gap:6px;font-size:13px">${docBadge(p)}${curStage(p) ? `<span class="muted">Этап: ${esc(curStage(p))}</span>` : ""}</div>
  ${m.debt > 0 ? `<span style="font-size:13px">Долг заказчика: <b class="num neg">${money(m.debt, m.cur)}</b></span>` : ""}</a>`;
}
function opsTable(list, compact) {
  const prj = id => (S.projects.find(p => p.id === id) || {}).name || "";
  return `<div class="tbl-wrap"><table><thead><tr><th>Дата</th><th>Операция</th>${compact ? "" : '<th class="hide-m">Счёт</th><th class="hide-m">Кто взял</th>'}<th class="r">Сумма</th></tr></thead><tbody>${list.map(o => {
    const sign = o.type === "in" ? "+" : o.type === "out" ? "−" : "";
    const title = o.type === "transfer" ? `${esc(o.account)} → ${esc(o.to_account)}` : esc(o.category || "Без категории");
    const pj = o.project_id && o.type === "out" && S.projects.find(p => p.id === o.project_id), its = pj ? itemsAt(pj) : [];
    const itn = its.length ? ((its.find(x => x.id === o.item_id) || {}).name || "") : "";
    const ckl = its.length ? (costKind(o, Object.fromEntries(its.map(x => [x.id, x]))) === "goods" && itn ? "товар: " + itn : "прочее: " + (itn || "на все товары")) : "";
    const sub = [o.counterparty, o.type !== "transfer" && compact ? o.account : "", prj(o.project_id), ckl, o.who && compact ? "взял: " + o.who : "", o.note].filter(Boolean).map(esc).join(" · ");
    return `<tr class="click oprow" data-op="${esc(o.id)}"><td class="num" style="font-size:13px">${fmtDate(o.op_date)}</td><td><div>${title}${o.chain ? ` <a href="#chain-${encodeURIComponent(o.chain)}" class="pill st-work" style="text-decoration:none" title="Цепочка денег">${esc(o.chain)}</a>` : ""}</div>${sub ? `<div class="meta">${sub}</div>` : ""}</td>${compact ? "" : `<td class="hide-m">${esc(o.account)}</td><td class="hide-m">${esc(o.who || "")}</td>`}<td class="r num ${o.type === "in" ? "pos" : o.type === "out" ? "neg" : ""}">${sign}${money(o.amount, o.currency)}</td></tr>`;
  }).join("")}</tbody></table></div>`;
}

function vChain(ch) {
  const list = S.ops.filter(o => o.chain === ch).sort((a, b) => (a.op_date || "").localeCompare(b.op_date || "") || (a.created_at || "").localeCompare(b.created_at || ""));
  const all = [...new Set(S.ops.map(o => o.chain).filter(Boolean))].sort();
  const steps = list.map(o => `<div class="stage"><span class="pill ${o.type === "in" ? "st-done" : o.type === "out" ? "st-debt" : "st-work"}">${o.type === "in" ? "приход" : o.type === "out" ? "расход" : "перевод"}</span><div style="flex:1;min-width:0"><b>${o.type === "transfer" ? esc(o.account) + " → " + esc(o.to_account) : esc(o.account) + (o.type === "in" ? " ← " : " → ") + esc(o.counterparty || o.category || "")}</b><div class="muted" style="font-size:12px">${fmtDate(o.op_date)}${o.who ? " · взял: " + esc(o.who) : ""}${o.note ? " · " + esc(o.note) : ""}</div></div><span class="num">${money(o.amount, o.currency)}${o.amount_to ? `<div class="muted" style="font-size:12px">дошло ${money(o.amount_to, o.currency)}</div>` : ""}</span></div>`).join("");
  $("#app").innerHTML = `<div><a href="#ops" class="muted" style="font-size:13px;text-decoration:none">← Операции</a></div>
  <div class="row between"><h1>Цепочка ${esc(ch)}</h1><select id="ch-pick" aria-label="Другая цепочка" style="padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:var(--surface)">${all.map(c => `<option${c === ch ? " selected" : ""}>${esc(c)}</option>`).join("")}</select></div>
  <p class="muted" style="margin:0">Путь одних и тех же денег по счетам, по порядку.</p>
  <section class="panel">${steps || '<div class="empty">В этой цепочке нет операций.</div>'}</section>`;
  $("#ch-pick").onchange = e => { location.hash = "chain-" + encodeURIComponent(e.target.value); };
}

function vProjects() {
  const list = [...S.projects].sort((a, b) => (a.status === "closed") - (b.status === "closed") || (b.created_at || "").localeCompare(a.created_at || ""));
  $("#app").innerHTML = `<div class="row between"><h1>Проекты</h1>${canWrite() ? '<button class="btn primary" data-act="new-project">+ Новый проект</button>' : ""}</div>
  <section class="panel">${list.length ? `<div class="tbl-wrap"><table><thead><tr><th>Проект</th><th>Статус и этап</th><th>Документы</th><th class="r">Договор</th><th class="r">Получено</th><th class="r">Долг</th><th class="r hide-m">Расходы</th><th class="r hide-m">Прибыль</th></tr></thead><tbody>${list.map(p => { const m = projMoney(p); return `<tr class="click" data-href="#project-${esc(p.id)}"><td><b>${esc(p.name)}</b><div class="muted" style="font-size:12px">${esc([p.entity, p.client].filter(Boolean).join(" · "))}</div></td><td><span class="pill ${stCls(p.status)}">${stName(p.status)}</span>${curStage(p) ? `<div class="muted" style="font-size:12px;margin-top:3px">${esc(curStage(p))}</div>` : ""}</td><td>${docBadge(p) || '<span class="muted">—</span>'}${docSummary(p).missing.length ? `<div class="muted" style="font-size:12px;margin-top:3px">нет: ${esc(docSummary(p).missing.join(", "))}</div>` : ""}</td><td class="r num">${money(m.contract, m.cur)}</td><td class="r num">${money(m.received, m.cur)}</td><td class="r num ${m.debt > 0 ? "neg" : ""}">${money(m.debt, m.cur)}</td><td class="r num hide-m">${money(m.spent, m.cur)}</td><td class="r num hide-m ${m.profit < 0 ? "neg" : ""}">${money(m.profit, m.cur)}</td></tr>`; }).join("")}</tbody></table></div>`
  : `<div class="empty"><b>Проектов пока нет</b>В проекте хранятся договор, счета-фактуры, этапы работ, оплаты заказчика и расходы.${canWrite() ? '<button class="btn primary" data-act="new-project">Добавить проект</button>' : ""}</div>`}</section>`;
}

function itemsPanel(p, m) {
  const c = m.cur, pct = (a, b) => b ? Math.round(a / b * 100) + "%" : "—";
  const chg = (x, f, fmt) => x.was && +x.was[f] !== +x[f] ? `<div class="muted" style="font-size:11px">было ${fmt(x.was[f])} · ${esc(x.by)}</div>` : "";
  if (!m.items.length) return `<section class="panel"><div class="panel-h"><h2>Товары по договору</h2>${canWrite() ? `<button class="btn small" data-act="edit-project" data-id="${esc(p.id)}">+ Добавить товары</button>` : ""}</div><div class="empty" style="padding:16px">Внесите товары из договора: наименование, кол-во и цену. Тогда сумма договора посчитается сама, а по каждому товару будет видна себестоимость и маржа.</div></section>`;
  const neg0 = v => `<td class="r num ${v ? "neg" : "muted"}">${money(v, c)}</td>`;
  const sub = x => costOpen ? `${neg0(x.goods)}${neg0(x.other)}` : "";
  const rows = m.items.map(x => `<tr><td><b>${esc(x.name)}</b>${x.added ? ` <span class="pill st-work">${esc(x.added)}</span>` : ""}</td>
    <td class="r num">${nf.format(+x.qty || 0)} ${esc(x.unit || "")}${chg(x, "qty", v => nf.format(+v || 0))}</td>
    <td class="r num hide-m">${money(+x.price || 0, c)}${chg(x, "price", v => money(+v || 0, c))}</td>
    <td class="r num">${money(x.gross, c)}</td>
    ${sub(x)}<td class="r num ${x.cost ? "neg" : "muted"}" style="${costOpen ? "font-weight:600" : ""}">${money(x.cost, c)}</td>
    <td class="r num ${x.margin < 0 ? "neg" : "pos"}">${money(x.margin, c)}</td>
    <td class="r num hide-m muted">${pct(x.margin, x.net)}</td></tr>`).join("");
  const tg = m.items.reduce((s2, x) => s2 + x.goods, 0), to = m.items.reduce((s2, x) => s2 + x.other, 0), tc = tg + to;
  const btn = `<button class="btn small costtg" data-act="toggle-cost" aria-expanded="${costOpen}" title="${costOpen ? "Свернуть" : "Показать: товар и прочее"}">${costOpen ? "−" : "+"}</button>`;
  return `<section class="panel"><div class="panel-h"><h2>Товары, себестоимость и маржа</h2>${canWrite() ? `<div class="row" style="gap:6px"><button class="btn small" data-act="edit-project" data-id="${esc(p.id)}">Товары</button><button class="btn small" data-act="new-add">+ Доп. соглашение</button></div>` : ""}</div>
  <div class="tbl-wrap"><table class="items"><thead><tr><th>Товар</th><th class="r">Кол-во</th><th class="r hide-m">Цена без НДС</th><th class="r">Сумма договора</th>
    ${costOpen ? `<th class="r">Себес: товар</th><th class="r">Прочее<div style="font-weight:400;text-transform:none;letter-spacing:0">такси, доставка</div></th>` : ""}
    <th class="r"><span class="row" style="gap:6px;justify-content:flex-end;flex-wrap:nowrap">${costOpen ? "Себес итого" : "Себестоимость"} ${btn}</span></th><th class="r">Маржа</th><th class="r hide-m">%</th></tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr><td>Итого</td><td></td><td class="hide-m"></td><td class="r num">${money(m.contract, c)}</td>${costOpen ? `<td class="r num neg">${money(tg, c)}</td><td class="r num neg">${money(to, c)}</td>` : ""}<td class="r num neg">${money(tc, c)}</td><td class="r num ${m.margin < 0 ? "neg" : "pos"}">${money(m.margin, c)}</td><td class="r num hide-m">${pct(m.margin, m.netTotal)}</td></tr></tfoot></table></div>
  <div class="panel-b muted" style="font-size:12px;border-top:1px solid var(--line)">Сумма договора — с НДС. Маржа = сумма без НДС (${money(m.netTotal, c)}) минус себестоимость. Себестоимость = сам товар + прочее (такси, доставка и т.п.). Прочее «на все товары» делится по доле товара в сумме${m.otherShared ? `: сейчас так разделено ${money(m.otherShared, c)}` : ""}.</div></section>`;
}
function vProject(id) {
  const p = S.projects.find(x => x.id === id);
  if (!p) { $("#app").innerHTML = `<div class="panel empty">Проект не найден. <a href="#projects">К списку проектов</a></div>`; return; }
  const m = projMoney(p), stages = Array.isArray(p.stages) ? p.stages : [];
  const ops = [...m.ops].sort(sortOps);
  const k = (l, v, cls = "", s = "") => `<div class="kpi"><span class="eyebrow">${l}</span><span class="v num ${cls}">${v}</span>${s ? `<span class="s">${s}</span>` : ""}</div>`;
  $("#app").innerHTML = `
  <div><a href="#projects" class="muted" style="font-size:13px;text-decoration:none">← Проекты</a></div>
  <div class="row between"><div><div class="row"><h1>${esc(p.name)}</h1><span class="pill ${stCls(p.status)}">${stName(p.status)}</span></div>
    <div class="muted" style="margin-top:4px">${p.entity ? `<b>${esc(p.entity)}</b> · ` : ""}${esc(p.client || "Заказчик не указан")}${p.contract_no ? ` · договор №${esc(p.contract_no)}` : ""}${p.contract_date ? ` от ${fmtDate(p.contract_date)}` : ""}${p.deadline ? ` · срок ${fmtDate(p.deadline)}` : ""}</div>
    <div class="row" style="gap:6px;margin-top:6px;font-size:13px">${docBadge(p)}${curStage(p) ? `<span class="pill">Этап: ${esc(curStage(p))}</span>` : ""}</div></div>
    ${canWrite() ? `<button class="btn" data-act="edit-project" data-id="${esc(p.id)}">Изменить</button>` : ""}</div>
  <div class="grid kpis">
    ${k("Сумма договора", money(m.contract, m.cur), "", addenda(p).length ? `основной ${money(m.base, m.cur)} ${m.add >= 0 ? "+" : "−"} доп. соглашения ${money(Math.abs(m.add), m.cur)}` : "")}
    ${k("Получено от заказчика", money(m.received, m.cur), "pos", m.contract ? Math.round(m.received / m.contract * 100) + "% договора" : "")}
    ${k("Долг заказчика", money(m.debt, m.cur), m.debt > 0 ? "neg" : "", m.invoiced ? `по счетам не оплачено ${money(m.unpaidInv, m.cur)}` : "счетов-фактур нет")}
    ${k("Расходы по проекту", money(m.spent, m.cur), "neg")}
    ${m.items.length ? k("Маржа по проекту", money(m.margin, m.cur), m.margin < 0 ? "neg" : "pos", `${m.netTotal ? Math.round(m.margin / m.netTotal * 100) : 0}% · без НДС минус расходы`) : ""}
    ${k("Прибыль сейчас", money(m.profit, m.cur), m.profit < 0 ? "neg" : "pos", "получено минус расходы")}
  </div>
  ${itemsPanel(p, m)}
  ${canWrite() ? `<div class="row"><button class="btn primary" data-act="new-op" data-type="in" data-project="${esc(p.id)}">+ Оплата от заказчика</button><button class="btn" data-act="new-op" data-type="out" data-project="${esc(p.id)}">+ Расход по проекту</button></div>` : ""}
  <div class="grid two">
    <section class="panel"><div class="panel-h"><h2>Оплаты и расходы</h2><span class="muted" style="font-size:13px">${ops.length} операций</span></div>
      ${ops.length ? opsTable(ops, true) : `<div class="empty">По проекту пока нет операций.</div>`}</section>
    <div class="grid" style="align-content:start">
      <section class="panel"><div class="panel-h"><h2>Документы проекта</h2>${(() => { const d = docSummary(p); return d.total ? `<span class="pill ${d.closed ? "st-done" : "st-debt"}">${d.closed ? "закрыты" : `закрыто ${d.done} из ${d.total}`}</span>` : ""; })()}</div>
        <div class="docs">${docState(p).map(x => { const files = m.docs.filter(d => d.kind === x.kind); return `<div class="doc"><div style="flex:1;min-width:0"><b>${esc(x.kind)}</b><div class="k">${[x.no ? "№" + esc(x.no) : "", x.date ? "от " + fmtDate(x.date) : ""].filter(Boolean).join(" ")}${files.length ? (x.no || x.date ? " · " : "") + files.map(f => `<a href="#" data-act="open-file" data-path="${esc(f.file_path)}">${esc(f.name || "файл")}</a>`).join(", ") : (x.status !== "none" ? (x.no || x.date ? " · " : "") + "файл не прикреплён" : "")}</div></div>
          ${canWrite() ? `<select data-docst="${esc(x.kind)}" aria-label="Статус: ${esc(x.kind)}" class="docst ${dsCls(x.status)}">${DOCST.map(o => `<option value="${o[0]}"${o[0] === x.status ? " selected" : ""}>${o[1]}</option>`).join("")}</select><button class="btn small" data-act="new-doc" data-kind="${esc(x.kind)}" title="Прикрепить файл" aria-label="Прикрепить файл: ${esc(x.kind)}">📎</button>` : `<span class="pill ${dsCls(x.status)}">${dsName(x.status)}</span>`}</div>`; }).join("")}</div>
      </section>
      <section class="panel"><div class="panel-h"><h2>Доп. соглашения</h2>${addenda(p).length ? `<span class="muted num" style="font-size:13px">${m.add >= 0 ? "+" : "−"}${money(Math.abs(m.add), m.cur)}</span>` : ""}</div>
        <div class="docs">${addenda(p).map((a, i) => { const files = m.docs.filter(d => d.kind === "Доп. соглашение" && a.no && (d.name || "").includes(a.no)); return `<div class="doc"><div style="flex:1;min-width:0"><b>№${esc(a.no || i + 1)}${a.date ? " от " + fmtDate(a.date) : ""}</b> ${(() => { const d = (a.changes || []).length ? r2(itemsAt(p, i + 1).reduce((s2, x) => s2 + itemGross(x), 0) - itemsAt(p, i).reduce((s2, x) => s2 + itemGross(x), 0)) : +a.delta || 0; return `<span class="num ${d < 0 ? "neg" : "pos"}">${d < 0 ? "−" : "+"}${money(Math.abs(d), m.cur)}</span>`; })()}<div class="k">${esc(a.note || "")}${(a.changes || []).length ? (a.note ? " · " : "") + (a.changes || []).length + " поз." : ""}${files.length ? " · " + files.map(f => `<a href="#" data-act="open-file" data-path="${esc(f.file_path)}">${esc(f.name || "файл")}</a>`).join(", ") : ""}</div></div>
          ${canWrite() ? `<select data-addst="${i}" aria-label="Статус доп. соглашения" class="docst ${dsCls(a.status || "todo")}">${DOCST.filter(o => o[0] !== "none").map(o => `<option value="${o[0]}"${o[0] === (a.status || "todo") ? " selected" : ""}>${o[1]}</option>`).join("")}</select><button class="btn small" data-act="new-doc" data-kind="Доп. соглашение" data-name="${esc("Доп. соглашение №" + (a.no || i + 1))}" aria-label="Прикрепить файл">📎</button><button class="btn small" data-act="edit-add" data-i="${i}" aria-label="Изменить доп. соглашение">✎</button><button class="btn small" data-act="del-add" data-i="${i}" aria-label="Удалить доп. соглашение">×</button>` : `<span class="pill ${dsCls(a.status || "todo")}">${dsName(a.status || "todo")}</span>`}</div>`; }).join("") || '<div class="empty" style="padding:16px">Доп. соглашений нет. Если увеличится товар или сумма, добавьте здесь — сумма договора и долг пересчитаются.</div>'}</div>
        ${canWrite() ? `<div class="panel-b" style="border-top:1px solid var(--line)"><button class="btn small" data-act="new-add">+ Доп. соглашение</button></div>` : ""}
      </section>
      <section class="panel"><div class="panel-h"><h2>Этапы работ</h2></div>
        <div>${stages.map((s, i) => `<div class="stage ${s.done ? "done" : ""}"><input type="checkbox" id="st-${i}" data-act="toggle-stage" data-i="${i}" ${s.done ? "checked" : ""} ${canWrite() ? "" : "disabled"}><label for="st-${i}" class="sn" style="flex:1">${esc(s.name)}</label>${s.due ? `<span class="muted num" style="font-size:12px">${fmtDate(s.due)}</span>` : ""}${canWrite() ? `<button class="btn small" data-act="del-stage" data-i="${i}" aria-label="Удалить этап">×</button>` : ""}</div>`).join("") || '<div class="empty" style="padding:16px">Этапов пока нет.</div>'}</div>
        ${canWrite() ? `<form class="panel-b row" id="stage-form" style="border-top:1px solid var(--line)"><input id="stage-name" placeholder="Новый этап, напр. «Дизайн макета»" style="flex:1;min-width:160px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--surface)"><input id="stage-due" type="date" style="padding:7px 8px;border:1px solid var(--line);border-radius:8px;background:var(--surface)"><button class="btn small">Добавить</button></form>` : ""}
      </section>
      <section class="panel"><div class="panel-h"><h2>Все файлы</h2>${canWrite() ? '<button class="btn small" data-act="new-doc">+ Файл</button>' : ""}</div>
        <div class="docs">${m.docs.map(d => `<div class="doc"><span class="ico">${esc(((d.file_path || "").split(".").pop() || "DOC").toUpperCase().slice(0, 4))}</span><div style="flex:1;min-width:0"><div style="overflow-wrap:anywhere">${d.file_path ? `<a href="#" data-act="open-file" data-path="${esc(d.file_path)}">${esc(d.name || d.kind)}</a>` : esc(d.name || d.kind)}</div><div class="k">${esc(d.kind)}${d.doc_date ? " · " + fmtDate(d.doc_date) : ""}${+d.amount ? ' · <span class="num">' + money(+d.amount, m.cur) + "</span>" : ""}${d.created_by ? " · " + esc(pname(d.created_by)) : ""}</div></div>${(isFull() || d.created_by === S.me.id) ? `<button class="btn small" data-act="del-doc" data-id="${esc(d.id)}" aria-label="Удалить документ">×</button>` : ""}</div>`).join("") || `<div class="empty" style="padding:16px">Договор, счета-фактуры и акты появятся здесь.</div>`}</div>
      </section>
      ${p.notes ? `<section class="panel"><div class="panel-h"><h2>Заметки</h2></div><div class="panel-b" style="white-space:pre-wrap">${esc(p.notes)}</div></section>` : ""}
    </div>
  </div>`;
  const sf = $("#stage-form");
  if (sf) sf.onsubmit = async e => { e.preventDefault(); const n = $("#stage-name").value.trim(); if (!n) return; await saveStages(p, [...stages, { name: n, due: $("#stage-due").value || "", done: false }]); };
}
async function saveDoc(p, kind, patch) {
  const docs = Object.assign({}, (p.docs && typeof p.docs === "object") ? p.docs : {});
  docs[kind] = Object.assign({}, docState(p).find(x => x.kind === kind), docs[kind] || {}, patch); delete docs[kind].kind;
  const { error } = await S.sb.from("projects").update({ docs }).eq("id", p.id); if (error) return toast(errText(error)); afterWrite("projects");
}
async function saveAddenda(p, list) {
  const contract_sum = contractTotal(Object.assign({}, p, { addenda: list }));
  const { error } = await S.sb.from("projects").update({ addenda: list, contract_sum }).eq("id", p.id); if (error) { toast(errText(error)); return false; } afterWrite("projects"); return true;
}
// Окно доп. соглашения: меняет кол-во и цену товаров или добавляет новые
function addModal(p, idx) {
  const editing = idx != null, a = editing ? addenda(p)[idx] : { no: String(addenda(p).length + 1), date: today(), status: "todo", note: "", changes: [] };
  const before = itemsAt(p, editing ? idx : undefined), hasItems = before.length > 0 || itemsBase(p).length > 0;
  const rows = before.map(x => { const c = (a.changes || []).find(z => z.id === x.id); return Object.assign({}, x, c || {}, { _orig: x }); });
  (a.changes || []).filter(c => !before.some(x => x.id === c.id)).forEach(c => rows.push(Object.assign({}, c, { _new: true })));
  const draw = () => {
    $("#ad-rows").innerHTML = rows.map((x, i) => `<input data-f="name" data-i="${i}" value="${esc(x.name || "")}" placeholder="Наименование" ${x._orig ? "readonly" : ""} aria-label="Наименование">
      <input data-f="qty" data-i="${i}" inputmode="decimal" value="${x.qty != null ? esc(nf.format(+x.qty)) : ""}" placeholder="кол-во" aria-label="Кол-во">
      <input data-f="price" data-i="${i}" inputmode="decimal" value="${x.price != null ? esc(nf.format(+x.price)) : ""}" placeholder="цена без НДС" aria-label="Цена без НДС">
      <span class="muted num" style="font-size:12px" data-st="${i}">${x._orig ? (+x._orig.qty !== +x.qty || +x._orig.price !== +x.price ? "изменено" : "без изменений") : "новый"}</span>`).join("");
    const tot = r2(rows.filter(x => x.name).reduce((s2, x) => s2 + itemGross(x), 0)), was = r2(before.reduce((s2, x) => s2 + itemGross(x), 0));
    $("#ad-total").innerHTML = `Сумма договора: было <b class="num">${money(was, p.currency)}</b> → станет <b class="num">${money(tot, p.currency)}</b> (${tot - was >= 0 ? "+" : "−"}${money(Math.abs(tot - was), p.currency)})`;
  };
  sheet(`<div class="row between"><h2>${editing ? "Доп. соглашение №" + esc(a.no) : "Новое доп. соглашение"}</h2><button class="btn small" data-act="close">Закрыть</button></div>
  <form id="ad-form" class="form">
    <label class="f">Номер<input id="ad-no" value="${esc(a.no || "")}"></label>
    <label class="f">Дата<input type="date" id="ad-date" value="${esc(a.date || "")}"></label>
    <label class="f">Статус<select id="ad-st">${DOCST.filter(o => o[0] !== "none").map(o => `<option value="${o[0]}"${o[0] === (a.status || "todo") ? " selected" : ""}>${o[1]}</option>`).join("")}</select></label>
    <label class="f">Что меняется (кратко)<input id="ad-note" value="${esc(a.note || "")}" placeholder="например, цена баннера, +табличка"></label>
    ${hasItems ? `<div class="full"><div class="eyebrow" style="margin:4px 0 6px">Товары после доп. соглашения — измените кол-во или цену, добавьте новые</div>
      <div class="adgrid"><span class="eyebrow">Товар</span><span class="eyebrow">Кол-во</span><span class="eyebrow">Цена без НДС</span><span></span></div>
      <div class="adgrid" id="ad-rows"></div>
      <button type="button" class="btn small" id="ad-addrow" style="margin-top:6px">+ Новый товар</button>
      <div id="ad-total" style="margin-top:8px;font-size:14px"></div></div>`
    : `<label class="f">На сколько меняется сумма (можно с минусом)<input id="ad-delta" inputmode="decimal" value="${a.delta ? esc(nf.format(a.delta)) : ""}"></label>`}
    <div class="full err" id="ad-err"></div>
    <div class="full row" style="justify-content:flex-end"><button type="button" class="btn" data-act="close">Отмена</button><button class="btn primary" id="ad-save">Сохранить</button></div>
  </form>`);
  if (hasItems) {
    draw();
    $("#ad-rows").oninput = e => { const t = e.target, x = rows[+t.dataset.i]; if (!x) return; if (t.dataset.f === "name") x.name = t.value; else { const v = parseNum(t.value); x[t.dataset.f] = isFinite(v) ? v : 0; }
      const sp = document.querySelector(`[data-st="${t.dataset.i}"]`); if (sp && x._orig) sp.textContent = +x._orig.qty !== +x.qty || +x._orig.price !== +x.price ? "изменено" : "без изменений";
      const tot = r2(rows.filter(z => z.name).reduce((s2, z) => s2 + itemGross(z), 0)), was = r2(before.reduce((s2, z) => s2 + itemGross(z), 0));
      $("#ad-total").innerHTML = `Сумма договора: было <b class="num">${money(was, p.currency)}</b> → станет <b class="num">${money(tot, p.currency)}</b> (${tot - was >= 0 ? "+" : "−"}${money(Math.abs(tot - was), p.currency)})`; };
    $("#ad-addrow").onclick = () => { rows.push({ id: rid(), name: "", unit: "шт", qty: 1, price: 0, vat: (before[0] && before[0].vat != null) ? before[0].vat : 12, _new: true }); draw(); };
  }
  $("#ad-form").onsubmit = async e => {
    e.preventDefault();
    const rec = { id: a.id || rid(), no: $("#ad-no").value.trim() || String(addenda(p).length + 1), date: $("#ad-date").value || "", status: $("#ad-st").value, note: $("#ad-note").value.trim() };
    if (hasItems) {
      rec.changes = rows.filter(x => x.name && (!x._orig || +x._orig.qty !== +x.qty || +x._orig.price !== +x.price)).map(x => ({ id: x.id, name: x.name, unit: x.unit || "шт", qty: +x.qty || 0, price: +x.price || 0, vat: x.vat == null ? 12 : +x.vat }));
      if (!rec.changes.length && !rec.note) { $("#ad-err").textContent = "Ничего не изменено: поменяйте кол-во, цену или добавьте товар."; return; }
    } else { const d = parseNum($("#ad-delta").value); rec.delta = isFinite(d) ? d : 0; }
    const list = [...addenda(p)]; if (editing) list[idx] = rec; else list.push(rec);
    $("#ad-save").disabled = true;
    if (await saveAddenda(p, list)) { closeModal(); toast("Доп. соглашение сохранено"); } else $("#ad-save").disabled = false;
  };
}
async function saveStages(p, stages) { const { error } = await S.sb.from("projects").update({ stages }).eq("id", p.id); if (error) return toast(errText(error)); afterWrite("projects"); }

function filteredOps() {
  const f = S.f;
  return S.ops.filter(o => (!f.month || (o.op_date || "").startsWith(f.month)) && (!f.account || o.account === f.account || o.to_account === f.account) && (!f.project || (f.project === "-" ? !o.project_id : o.project_id === f.project)) && (!f.cat || o.category === f.cat) && (!f.who || o.who === f.who) && (!f.type || o.type === f.type) && (!f.chain || o.chain === f.chain)).sort(sortOps);
}
function vOps() {
  const s = st(), list = filteredOps(), f = S.f;
  const ti = list.filter(o => o.type === "in").reduce((x, o) => x + uzs(o), 0), to = list.filter(o => o.type === "out").reduce((x, o) => x + uzs(o), 0);
  const opt = (arr, val, all) => `<option value="">${all}</option>` + arr.map(x => Array.isArray(x) ? `<option value="${esc(x[0])}"${x[0] === val ? " selected" : ""}>${esc(x[1])}</option>` : `<option${x === val ? " selected" : ""}>${esc(x)}</option>`).join("");
  const whos = [...new Set([...s.people, ...S.ops.map(o => o.who).filter(Boolean)])];
  const cats = [...new Set([...s.out_cats, ...s.in_cats, ...S.ops.map(o => o.category).filter(Boolean)])];
  $("#app").innerHTML = `<div class="row between"><h1>Операции</h1>${canWrite() ? '<button class="btn primary" data-act="new-op">+ Операция</button>' : ""}</div>
  <div class="filters">
    <select id="f-type" aria-label="Тип">${opt([["in", "Приход"], ["out", "Расход"], ["transfer", "Переводы между счетами"]], f.type, "Все типы")}</select>
    <select id="f-month" aria-label="Месяц">${opt(months().map(m => [m, monthName(m)]), f.month, "Все месяцы")}</select>
    <select id="f-account" aria-label="Счёт">${opt(S.accounts.map(a => a.name), f.account, "Все счета")}</select>
    <select id="f-project" aria-label="Проект">${opt([["-", "Без проекта"], ...S.projects.map(p => [p.id, p.name])], f.project, "Все проекты")}</select>
    <select id="f-cat" aria-label="Категория">${opt(cats, f.cat, "Все категории")}</select>
    <select id="f-who" aria-label="Кто взял">${opt(whos, f.who, "Кто взял: все")}</select>
    <select id="f-chain" aria-label="Цепочка">${opt([...new Set(S.ops.map(o => o.chain).filter(Boolean))].sort(), f.chain, "Цепочки: все")}</select>
  </div>
  <div class="row muted" style="font-size:14px"><span>${list.length} операций</span><span>Приход <b class="num pos">${money(ti)}</b></span><span>Расход <b class="num neg">${money(to)}</b></span></div>
  <section class="panel">${list.length ? opsTable(list, false) : `<div class="empty">Нет операций${Object.values(f).some(Boolean) ? " с такими фильтрами" : ""}.</div>`}</section>`;
  ["type", "month", "account", "project", "cat", "who", "chain"].forEach(k => $("#f-" + k).addEventListener("change", e => { S.f[k] = e.target.value; vOps(); }));
}

function vCash() {
  const ms = months().slice().reverse();
  const rows = ms.map(m => { const o = S.ops.filter(x => (x.op_date || "").startsWith(m)); return { m, i: o.filter(x => x.type === "in").reduce((s, x) => s + uzs(x), 0), e: o.filter(x => x.type === "out").reduce((s, x) => s + uzs(x), 0) }; });
  let cum = 0; rows.forEach(r => { cum += r.i - r.e; r.c = cum; });
  const mx = Math.max(1, ...rows.map(r => Math.max(r.i, r.e)));
  const per = S.cfMonth, pops = S.ops.filter(o => !per || (o.op_date || "").startsWith(per));
  const group = (arr, key) => { const g = {}; arr.forEach(o => { const k = key(o) || "—"; g[k] = (g[k] || 0) + uzs(o); }); return Object.entries(g).sort((a, b) => b[1] - a[1]); };
  const outs = pops.filter(o => o.type === "out"), ins = pops.filter(o => o.type === "in");
  const prj = id => (S.projects.find(p => p.id === id) || {}).name || "Без проекта";
  const ent = o => { const p = S.projects.find(x => x.id === o.project_id); if (p && p.entity) return p.entity; return o.account === "МЧЖ" ? "МЧЖ ADVERT SOLUTION" : o.account === "ЯТТ" ? "ЯТТ" : "Карты и наличные"; };
  const tbl = (title, data, cls) => { const tot = data.reduce((s, x) => s + x[1], 0); return `<section class="panel"><div class="panel-h"><h2>${title}</h2><span class="num ${cls}">${money(tot)}</span></div>${data.length ? `<div class="tbl-wrap"><table><tbody>${data.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r num">${money(v)}</td><td class="r muted num" style="width:60px">${tot ? Math.round(v / tot * 100) : 0}%</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty" style="padding:16px">Нет данных</div>'}</section>`; };
  $("#app").innerHTML = `<div><h1>Cash flow</h1><div class="muted" style="font-size:13px">Суммы в сумах; доллары пересчитаны по курсу операции. Переводы между своими счетами не считаются.</div></div>
  <section class="panel"><div class="panel-h"><h2>По месяцам</h2></div>${rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>Месяц</th><th class="r">Приход</th><th class="r">Расход</th><th class="r">Итог месяца</th><th class="r hide-m">Накоплено</th><th class="hide-m"></th></tr></thead><tbody>${rows.slice().reverse().map(r => `<tr><td>${esc(monthName(r.m))}</td><td class="r num pos">${money(r.i)}</td><td class="r num neg">${money(r.e)}</td><td class="r num ${r.i - r.e < 0 ? "neg" : "pos"}">${money(r.i - r.e)}</td><td class="r num hide-m">${money(r.c)}</td><td class="hide-m"><div class="cfbar"><i class="a" style="width:${(r.i / mx * 100).toFixed(1)}%"></i><i class="b" style="width:${(r.e / mx * 100).toFixed(1)}%"></i></div></td></tr>`).join("")}</tbody></table></div>` : '<div class="empty">Пока нет операций.</div>'}</section>
  <div class="filters"><select id="cf-month" aria-label="Период"><option value="">За всё время</option>${months().map(m => `<option value="${m}"${m === per ? " selected" : ""}>${esc(monthName(m))}</option>`).join("")}</select></div>
  <div class="grid two">${tbl("Расходы по компаниям", group(outs, ent), "neg")}${tbl("Приход по компаниям", group(ins, ent), "pos")}</div>
  <div class="grid two">${tbl("Расходы по категориям", group(outs, o => o.category), "neg")}${tbl("Приход по категориям", group(ins, o => o.category), "pos")}</div>
  <div class="grid two">${tbl("Расходы по проектам", group(outs, o => prj(o.project_id)), "neg")}${tbl("Кто сколько взял", group(outs, o => o.who), "neg")}</div>
  ${tbl("Расходы по счетам", group(outs, o => o.account), "neg")}`;
  $("#cf-month").addEventListener("change", e => { S.cfMonth = e.target.value; vCash(); });
}

function vAccounts() {
  const s = st(), b = balances(), full = isFull();
  $("#app").innerHTML = `<h1>Счета и настройки</h1>
  <section class="panel"><div class="panel-h"><h2>Счета</h2><span class="muted" style="font-size:13px">Начальный остаток на ${fmtDate(s.opening_date)}</span></div>
   <div class="tbl-wrap"><table><thead><tr><th>Счёт</th><th>Валюта</th>${full ? '<th title="Счёт компании виден бухгалтеру">Видит бухгалтер</th>' : ""}<th class="r">Начальный остаток</th><th class="r">Сейчас</th></tr></thead><tbody>${S.accounts.map((a, i) => `<tr><td>${esc(a.name)}</td><td>${a.currency}</td>${full ? `<td><input type="checkbox" data-biz="${i}" ${a.business ? "checked" : ""} aria-label="Видит бухгалтер"></td>` : ""}<td class="r">${full ? `<input class="num" data-open="${i}" value="${esc(nf.format(+a.opening || 0))}" inputmode="decimal" style="width:150px;text-align:right;padding:6px 8px;border:1px solid var(--line);border-radius:7px;background:var(--surface)">` : `<span class="num">${money(a.opening, a.currency)}</span>`}</td><td class="r num">${money(b[a.name], a.currency)}</td></tr>`).join("")}</tbody></table></div></section>
  ${full ? `<section class="panel"><div class="panel-h"><h2>Настройки</h2></div><div class="panel-b"><div class="form">
    <label class="f">Дата начальных остатков<input type="date" id="s-date" value="${esc(s.opening_date)}"></label>
    <label class="f">Курс доллара (сум за 1 $)<input id="s-rate" inputmode="decimal" value="${+s.usd_rate ? esc(nf.format(s.usd_rate)) : ""}" placeholder="например, 12 650"></label>
    <label class="f">Новый счёт<input id="s-acc" placeholder="например, Карта Humo"></label>
    <label class="f">Валюта нового счёта<select id="s-acc-cur"><option>UZS</option><option>USD</option></select></label>
    <label class="f full">Категории расходов (через запятую)<textarea id="s-outcats">${esc(s.out_cats.join(", "))}</textarea></label>
    <label class="f full">Категории прихода (через запятую)<textarea id="s-incats">${esc(s.in_cats.join(", "))}</textarea></label>
    <label class="f full">Кто берёт деньги (через запятую)<input id="s-people" value="${esc(s.people.join(", "))}"></label>
    <label class="f full">Наши компании (через запятую)<input id="s-entities" value="${esc(s.entities.join(", "))}"></label>
  </div><div class="row" style="margin-top:14px"><button class="btn primary" data-act="save-settings">Сохранить</button><span id="s-msg" class="muted"></span></div></div></section>` : `<p class="muted">Настройки меняют владелец и партнёр.</p>`}`;
}

function vUsers() {
  const list = [...S.profiles].sort((a, b) => (a.role === "pending" ? 0 : 1) - (b.role === "pending" ? 0 : 1) || (a.created_at || "").localeCompare(b.created_at || ""));
  $("#app").innerHTML = `<h1>Пользователи</h1>
  <section class="panel"><div class="tbl-wrap"><table><thead><tr><th>Имя</th><th>Почта</th><th>Роль</th></tr></thead><tbody>${list.map(p => `<tr><td><input data-uname="${esc(p.id)}" value="${esc(p.full_name || "")}" style="padding:6px 8px;border:1px solid var(--line);border-radius:7px;background:var(--surface);width:100%;min-width:140px"></td><td>${esc(p.email)}</td><td>${p.id === S.me.id ? `<b>${ROLES[p.role]}</b>` : `<select data-urole="${esc(p.id)}" style="padding:6px 8px;border:1px solid var(--line);border-radius:7px;background:var(--surface)">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}"${k === p.role ? " selected" : ""}>${v}</option>`).join("")}</select>`}</td></tr>`).join("")}</tbody></table></div></section>
  <section class="panel"><div class="panel-h"><h2>Как добавить человека</h2></div><div class="panel-b" style="display:flex;flex-direction:column;gap:6px">
    <div>1. Supabase → Authentication → Users → <b>Add user → Create new user</b>: почта, пароль, галочка <b>Auto Confirm User</b>.</div>
    <div>2. Человек появится здесь с ролью «Без доступа». Выберите роль.</div>
    <div>3. Передайте ему адрес сайта, почту и пароль. Пароль он может сменить в своём профиле.</div>
    <div class="muted" style="font-size:13px;margin-top:6px"><b>Партнёр</b> видит и меняет всё, кроме пользователей. <b>Бухгалтер</b> видит проекты, документы и операции только по счетам, отмеченным «Видит бухгалтер» (МЧЖ и ЯТТ), удаляет только своё.</div>
  </div></section>`;
  document.querySelectorAll("[data-urole]").forEach(el => el.onchange = async () => { const { error } = await S.sb.from("profiles").update({ role: el.value }).eq("id", el.dataset.urole); if (error) toast(errText(error)); else toast("Роль сохранена"); afterWrite("profiles"); });
  document.querySelectorAll("[data-uname]").forEach(el => el.onchange = async () => { const { error } = await S.sb.from("profiles").update({ full_name: el.value.trim() }).eq("id", el.dataset.uname); if (error) toast(errText(error)); else toast("Имя сохранено"); afterWrite("profiles"); });
}

/* ================= modals ================= */
function closeModal() { $("#modal").innerHTML = ""; }
function sheet(html) { $("#modal").innerHTML = `<div class="scrim" data-act="scrim"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`; const f = $("#modal input:not([type=hidden]),#modal select"); if (f && window.innerWidth > 760) f.focus(); }

function opModal(op, preset = {}) {
  const s = st(), o = op ? Object.assign({}, op) : { type: preset.type || "out", op_date: today(), account: (S.accounts[0] || {}).name, project_id: preset.project || "", who: s.people[0] || "" };
  if (!op && preset.project && (o.type === "out") && !o.category && s.out_cats.includes("Оплата поставщику")) o.category = "Оплата поставщику";
  let type = o.type, ck = o.cost_type || (o.id && !o.item_id ? "other" : "goods");
  const lastRate = (S.ops.filter(x => x.currency === "USD" && x.rate).sort(sortOps)[0] || {}).rate || s.usd_rate || "";
  const mayEdit = !op || isFull() || op.created_by === S.me.id || S.me.role === "accountant";
  const mayDel = op && (isFull() || op.created_by === S.me.id);
  const collect = () => { const g = id => { const e = $("#" + id); return e ? e.value : undefined; };
    const d = g("o-date"); if (d !== undefined) o.op_date = d; const a = g("o-amount"); if (a !== undefined) o.amount = parseNum(a) || undefined; const n = g("o-note"); if (n !== undefined) o.note = n;
    const ac = g("o-acc"); if (ac) o.account = ac; const c = g("o-cat"); if (c) o.category = c; const p = g("o-proj"); if (p !== undefined) o.project_id = p; const it = g("o-item"); if (it !== undefined) o.item_id = it; const w = g("o-who"); if (w !== undefined) o.who = w; const cp = g("o-cp"); if (cp !== undefined) o.counterparty = cp; const t = g("o-to"); if (t) o.to_account = t; };
  const draw = () => {
    const cats = type === "in" ? s.in_cats : s.out_cats, acc = o.account;
    sheet(`<div class="row between"><h2>${op ? "Операция" : "Новая операция"}</h2><button class="btn small" data-act="close">Закрыть</button></div>
    <div class="seg" role="group" aria-label="Тип операции"><button type="button" class="t-out" aria-pressed="${type === "out"}" data-t="out">Расход</button><button type="button" class="t-in" aria-pressed="${type === "in"}" data-t="in">Приход</button><button type="button" class="t-tr" aria-pressed="${type === "transfer"}" data-t="transfer">Между счетами</button></div>
    <form id="op-form" class="form">
      <label class="f">Дата<input type="date" id="o-date" value="${esc(o.op_date)}" required></label>
      <label class="f">Сумма<input id="o-amount" inputmode="decimal" value="${o.amount != null ? esc(nf.format(o.amount)) : ""}" placeholder="0" required></label>
      <label class="f">${type === "transfer" ? "Со счёта" : "Счёт"}<select id="o-acc">${S.accounts.map(a => `<option${a.name === acc ? " selected" : ""}>${esc(a.name)}</option>`).join("")}</select></label>
      ${type === "transfer" ? `<label class="f">На счёт<select id="o-to">${S.accounts.map(a => `<option${a.name === o.to_account ? " selected" : ""}>${esc(a.name)}</option>`).join("")}</select></label>`
        : `<label class="f">Категория<select id="o-cat">${cats.map(c => `<option${c === o.category ? " selected" : ""}>${esc(c)}</option>`).join("")}${o.category && !cats.includes(o.category) ? `<option selected>${esc(o.category)}</option>` : ""}</select></label>`}
      <label class="f" id="rate-box"${accCur(acc) === "USD" ? "" : " hidden"}>Курс, сум за 1 $<input id="o-rate" inputmode="decimal" value="${esc(o.rate ? nf.format(o.rate) : lastRate ? nf.format(lastRate) : "")}"></label>
      ${type === "transfer" ? `<label class="f">Дошло на счёт (если меньше из-за комиссии)<input id="o-amountTo" inputmode="decimal" value="${o.amount_to != null ? esc(nf.format(o.amount_to)) : ""}" placeholder="необязательно"></label>` : ""}
      ${type !== "transfer" ? `<label class="f">Проект<select id="o-proj"><option value="">Без проекта</option>${S.projects.map(p => `<option value="${esc(p.id)}"${p.id === o.project_id ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>` : ""}
      ${type === "out" && o.project_id && itemsAt(S.projects.find(x => x.id === o.project_id)).length ? (() => { const its = itemsAt(S.projects.find(x => x.id === o.project_id)); return `<div class="f full"><span>Расход по проекту — на что</span><div class="seg ck" role="group" aria-label="Вид расхода"><button type="button" data-ck="goods" aria-pressed="${ck === "goods"}">Товар из договора</button><button type="button" data-ck="other" aria-pressed="${ck === "other"}">Прочее: такси, доставка…</button></div></div>
      <label class="f full">${ck === "goods" ? "Какой товар" : "На какой товар отнести"}<select id="o-item">${ck === "other" ? `<option value="">На все товары (разделить по доле в сумме)</option>` : ""}${its.map(x => `<option value="${esc(x.id)}"${x.id === o.item_id ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>`; })() : ""}
      ${type === "out" ? `<label class="f">Кто взял<input id="o-who" list="who-list" value="${esc(o.who || "")}"><datalist id="who-list">${s.people.map(p => `<option value="${esc(p)}">`).join("")}</datalist></label>` : ""}
      ${type !== "transfer" ? `<label class="f ${type === "in" ? "" : "full"}">${type === "in" ? "От кого" : "Кому / где"}<input id="o-cp" value="${esc(o.counterparty || "")}" placeholder="${type === "in" ? "заказчик, человек" : "магазин, человек, налоговая"}"></label>` : ""}
      <label class="f">Цепочка<input id="o-chain" value="${esc(o.chain || "")}" placeholder="например, Ц5" list="chain-list"><datalist id="chain-list">${[...new Set(S.ops.map(x => x.chain).filter(Boolean))].map(c => `<option value="${esc(c)}">`).join("")}</datalist></label>
      <label class="f full">Комментарий<input id="o-note" value="${esc(o.note || "")}" placeholder="${type === "out" && ck === "other" && o.project_id ? "на что: такси, доставка, упаковка…" : "на что потрачено, номер счёта и т.п."}"></label>
      <label class="f full">Чек или документ (PDF, фото)<input type="file" id="o-file" accept="application/pdf,image/*">${o.doc_path ? `<span>Прикреплён: <a href="#" data-act="open-file" data-path="${esc(o.doc_path)}">открыть</a></span>` : ""}</label>
      <div class="full err" id="o-err"></div>
      <div class="full row between"><div>${mayDel ? '<button type="button" class="btn danger" id="o-del">Удалить</button>' : ""}</div><div class="row"><button type="button" class="btn" data-act="close">Отмена</button>${mayEdit ? '<button class="btn primary" id="o-save">Сохранить</button>' : ""}</div></div>
    </form>
    ${op ? `<div class="muted" style="font-size:12px">Добавил(а): ${esc(pname(op.created_by) || "—")}${op.created_at ? ", " + new Date(op.created_at).toLocaleString("ru-RU") : ""}</div>` : ""}`);
    document.querySelectorAll(".seg button[data-t]").forEach(b => b.onclick = () => { collect(); type = b.dataset.t; draw(); });
    document.querySelectorAll(".seg button[data-ck]").forEach(b => b.onclick = () => { collect(); if (ck !== b.dataset.ck) { ck = b.dataset.ck; o.item_id = ck === "other" ? "" : o.item_id; } draw(); });
    const pj = $("#o-proj"); if (pj) pj.onchange = () => { collect(); o.item_id = ""; draw(); };
    $("#o-acc").onchange = e => { o.account = e.target.value; $("#rate-box").hidden = accCur(e.target.value) !== "USD"; };
    $("#op-form").onsubmit = save;
    const del = $("#o-del");
    if (del) del.onclick = async () => {
      if (!del.dataset.c) { del.dataset.c = 1; del.textContent = "Точно удалить?"; return; }
      const { error } = await S.sb.from("ops").delete().eq("id", op.id);
      if (error) return $("#o-err").textContent = errText(error);
      closeModal(); toast("Операция удалена"); afterWrite("ops");
    };
  };
  async function save(e) {
    e.preventDefault(); const err = $("#o-err"); err.textContent = "";
    const amount = parseNum($("#o-amount").value); if (!(amount > 0)) { err.textContent = "Укажите сумму больше нуля."; return; }
    const account = $("#o-acc").value, cur = accCur(account);
    const rec = { type, op_date: $("#o-date").value || today(), amount, account, currency: cur, note: $("#o-note").value.trim() || null, chain: $("#o-chain").value.trim() || null, rate: null, to_account: null, amount_to: null, category: null, project_id: null, counterparty: null, who: null, item_id: null, cost_type: null };
    if (cur === "USD") { const r = parseNum($("#o-rate").value); if (!(r > 0)) { err.textContent = "Для долларового счёта укажите курс."; return; } rec.rate = r; }
    if (type === "transfer") { rec.to_account = $("#o-to").value; if (rec.to_account === account) { err.textContent = "Выберите разные счета."; return; } const at = parseNum($("#o-amountTo").value); if (at > 0) rec.amount_to = at; rec.category = "Перевод между счетами"; }
    else { rec.category = $("#o-cat").value; rec.project_id = $("#o-proj").value || null; rec.counterparty = $("#o-cp").value.trim() || null; }
    if (type === "out") { rec.who = $("#o-who").value.trim() || null; const it = $("#o-item"); if (it && rec.project_id) { rec.item_id = it.value || null; rec.cost_type = ck; if (ck === "other" && !rec.note) { err.textContent = "Напишите, на что прочий расход (такси, доставка…)."; return; } } }
    const btn = $("#o-save"); btn.disabled = true; btn.textContent = "Сохраняю…";
    try {
      const fe = $("#o-file");
      if (fe.files[0]) rec.doc_path = await uploadFile(fe.files[0], "ops");
      const { error } = op ? await S.sb.from("ops").update(rec).eq("id", op.id) : await S.sb.from("ops").insert(rec);
      if (error) throw error;
      closeModal(); toast(op ? "Операция изменена" : "Операция записана"); afterWrite("ops");
    } catch (x) { btn.disabled = false; btn.textContent = "Сохранить"; err.textContent = errText(x); }
  }
  draw();
}

async function uploadFile(file, folder) {
  if (file.size > 20 * 1024 * 1024) throw { message: "Файл больше 20 МБ. Сожмите его." };
  const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "bin";
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await S.sb.storage.from("docs").upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw error;
  return path;
}
async function openFile(path) {
  const w = window.open("about:blank", "_blank");
  const { data, error } = await S.sb.storage.from("docs").createSignedUrl(path, 600);
  if (error || !data) { if (w) w.close(); return toast(errText(error)); }
  if (w) w.location = data.signedUrl; else location.href = data.signedUrl;
}

function projModal(p) {
  const s = st(), o = p || { status: "contract", currency: "UZS", entity: s.entities[0] };
  sheet(`<div class="row between"><h2>${p ? "Изменить проект" : "Новый проект"}</h2><button class="btn small" data-act="close">Закрыть</button></div>
  <form id="p-form" class="form">
    <label class="f full">Название проекта<input id="p-name" value="${esc(o.name || "")}" required placeholder="например, Наружная реклама для …"></label>
    <label class="f">Компания (наша сторона)<select id="p-entity">${s.entities.map(x => `<option${x === o.entity ? " selected" : ""}>${esc(x)}</option>`).join("")}</select></label>
    <label class="f">Заказчик<input id="p-client" value="${esc(o.client || "")}" placeholder="организация или человек"></label>
    <label class="f">Статус проекта<select id="p-status">${STATUSES.map(x => `<option value="${x[0]}"${x[0] === o.status ? " selected" : ""}>${x[1]}</option>`).join("")}</select></label>
    <label class="f">Сумма договора (основная, без доп. соглашений)<input id="p-sum" inputmode="decimal" value="${+o.contract_sum ? esc(nf.format(o.contract_sum)) : ""}" placeholder="0"></label>
    <label class="f">Валюта<select id="p-cur"><option${o.currency === "UZS" ? " selected" : ""}>UZS</option><option${o.currency === "USD" ? " selected" : ""}>USD</option></select></label>
    <label class="f">Номер договора<input id="p-no" value="${esc(o.contract_no || "")}"></label>
    <label class="f">Дата договора<input type="date" id="p-date" value="${esc(o.contract_date || "")}"></label>
    <label class="f">Срок сдачи<input type="date" id="p-deadline" value="${esc(o.deadline || "")}"></label>
    <div class="full"><div class="eyebrow" style="margin:4px 0 6px">Товары по договору (как в самом договоре, без доп. соглашений)</div>
      <div class="itgrid"><span class="eyebrow">Наименование</span><span class="eyebrow">Ед.</span><span class="eyebrow">Кол-во</span><span class="eyebrow">Цена без НДС</span><span class="eyebrow">НДС %</span><span></span></div>
      <div class="itgrid" id="it-rows"></div>
      <div class="row between" style="margin-top:6px"><button type="button" class="btn small" id="it-add">+ Товар</button><span id="it-total" class="muted" style="font-size:13px"></span></div></div>
    <div class="full"><div class="eyebrow" style="margin:4px 0 6px">Документы: статус, номер и дата</div>
      <div class="docgrid">${docState(o).map((x, i) => { const files = p ? S.documents.filter(d => d.project_id === p.id && d.kind === x.kind) : []; return `<span class="dk">${esc(x.kind)}${files.length ? `<small>${files.map(f => `<a href="#" data-act="open-file" data-path="${esc(f.file_path)}">📎 ${esc(f.name || "файл")}</a>`).join(" ")}</small>` : ""}</span>
        <select data-dstat="${i}" aria-label="Статус: ${esc(x.kind)}">${DOCST.map(z => `<option value="${z[0]}"${z[0] === x.status ? " selected" : ""}>${z[1]}</option>`).join("")}</select>
        <input data-dno="${i}" value="${esc(x.no || "")}" placeholder="№" aria-label="Номер: ${esc(x.kind)}">
        <input type="date" data-ddate="${i}" value="${esc(x.date || "")}" aria-label="Дата: ${esc(x.kind)}">`; }).join("")}</div>
      <div class="muted" style="font-size:12px;margin-top:6px">Файлы прикрепляются на странице проекта кнопкой 📎. «Документы закрыты», когда все нужные подписаны.</div></div>
    <label class="f full">Заметки<textarea id="p-notes" placeholder="что делаем, контакты заказчика, условия оплаты">${esc(o.notes || "")}</textarea></label>
    <div class="full err" id="p-err"></div>
    <div class="full row between"><div>${p && isFull() ? '<button type="button" class="btn danger" id="p-del">Удалить проект</button>' : ""}</div><div class="row"><button type="button" class="btn" data-act="close">Отмена</button><button class="btn primary" id="p-save">Сохранить</button></div></div>
  </form>`);
  const items = itemsBase(o).map(x => Object.assign({}, x));
  const itDraw = () => {
    $("#it-rows").innerHTML = items.map((x, i) => `<input data-f="name" data-i="${i}" value="${esc(x.name || "")}" placeholder="например, Флаг Parus" aria-label="Наименование">
      <input data-f="unit" data-i="${i}" value="${esc(x.unit || "шт")}" aria-label="Единица">
      <input data-f="qty" data-i="${i}" inputmode="decimal" value="${x.qty != null ? esc(nf.format(+x.qty)) : ""}" aria-label="Кол-во">
      <input data-f="price" data-i="${i}" inputmode="decimal" value="${x.price != null ? esc(nf.format(+x.price)) : ""}" aria-label="Цена без НДС">
      <input data-f="vat" data-i="${i}" inputmode="decimal" value="${x.vat != null ? esc(String(x.vat)) : "12"}" aria-label="НДС %">
      <button type="button" class="btn small" data-itdel="${i}" aria-label="Удалить товар">×</button>`).join("");
    itTot();
  };
  const itTot = () => { const t = r2(items.filter(x => x.name).reduce((s2, x) => s2 + itemGross(x), 0)); $("#it-total").textContent = items.length ? "По договору с НДС: " + money(t, $("#p-cur").value) + (addenda(o).length ? " · с доп. соглашениями: " + money(contractTotal(Object.assign({}, o, { items })), $("#p-cur").value) : "") : "Если внести товары, сумма договора посчитается сама"; const sum = $("#p-sum"); if (items.some(x => x.name)) { sum.value = nf.format(t); sum.readOnly = true; } else sum.readOnly = false; };
  itDraw();
  $("#it-rows").oninput = e => { const t = e.target, x = items[+t.dataset.i]; if (!x) return; if (t.dataset.f === "name" || t.dataset.f === "unit") x[t.dataset.f] = t.value; else { const v = parseNum(t.value); x[t.dataset.f] = isFinite(v) ? v : 0; } itTot(); };
  $("#it-rows").onclick = e => { const b = e.target.closest("[data-itdel]"); if (!b) return; const x = items[+b.dataset.itdel];
    if (S.ops.some(op2 => op2.item_id === x.id) && !b.dataset.c) { b.dataset.c = 1; b.textContent = "Точно?"; b.title = "К этому товару привязаны расходы"; return; }
    items.splice(+b.dataset.itdel, 1); itDraw(); };
  $("#it-add").onclick = () => { items.push({ id: rid(), name: "", unit: "шт", qty: 1, price: 0, vat: 12 }); itDraw(); };
  $("#p-form").onsubmit = async e => {
    e.preventDefault();
    const rec = { name: $("#p-name").value.trim(), entity: $("#p-entity").value, client: $("#p-client").value.trim() || null, status: $("#p-status").value, contract_sum: parseNum($("#p-sum").value) || 0, currency: $("#p-cur").value, contract_no: $("#p-no").value.trim() || null, contract_date: $("#p-date").value || null, deadline: $("#p-deadline").value || null, notes: $("#p-notes").value.trim() || null };
    const docs = Object.assign({}, (o.docs && typeof o.docs === "object") ? o.docs : {});
    REQDOCS.forEach((k, i) => { docs[k] = { status: document.querySelector(`[data-dstat="${i}"]`).value, no: document.querySelector(`[data-dno="${i}"]`).value.trim(), date: document.querySelector(`[data-ddate="${i}"]`).value || "" }; });
    if (docs["Договор"] && !docs["Договор"].no && rec.contract_no) docs["Договор"].no = rec.contract_no;
    if (docs["Договор"] && !docs["Договор"].date && rec.contract_date) docs["Договор"].date = rec.contract_date;
    rec.docs = docs;
    rec.items = items.filter(x => (x.name || "").trim()).map(x => ({ id: x.id || rid(), name: x.name.trim(), unit: (x.unit || "шт").trim(), qty: +x.qty || 0, price: +x.price || 0, vat: x.vat == null ? 12 : +x.vat }));
    if (rec.items.length) rec.contract_sum = contractTotal(Object.assign({}, o, { items: rec.items }));
    if (!rec.name) { $("#p-err").textContent = "Введите название."; return; }
    $("#p-save").disabled = true;
    const r = p ? await S.sb.from("projects").update(rec).eq("id", p.id).select().single() : await S.sb.from("projects").insert(rec).select().single();
    if (r.error) { $("#p-save").disabled = false; $("#p-err").textContent = errText(r.error); return; }
    closeModal(); toast(p ? "Проект сохранён" : "Проект создан"); await afterWrite("projects");
    if (!p) location.hash = "project-" + r.data.id;
  };
  const d = $("#p-del");
  if (d) d.onclick = async () => {
    const n = S.ops.filter(x => x.project_id === p.id).length;
    if (!d.dataset.c) { d.dataset.c = 1; d.textContent = n ? `Удалить? ${n} операций останутся без проекта` : "Точно удалить?"; return; }
    const { error } = await S.sb.from("projects").delete().eq("id", p.id);
    if (error) return $("#p-err").textContent = errText(error);
    closeModal(); location.hash = "projects"; toast("Проект удалён"); afterWrite("projects", "documents", "ops");
  };
}

function docModal(p, kind, name) {
  sheet(`<div class="row between"><h2>${kind ? "Прикрепить: " + esc(kind) : "Новый документ"}</h2><button class="btn small" data-act="close">Закрыть</button></div>
  <form id="d-form" class="form">
    <label class="f">Вид<select id="d-kind">${DOCKINDS.map(k => `<option${k === kind ? " selected" : ""}>${k}</option>`).join("")}</select></label>
    <label class="f">Дата<input type="date" id="d-date" value="${today()}"></label>
    <label class="f full">Название<input id="d-name" value="${esc(name || "")}" placeholder="например, Счёт-фактура №12"></label>
    <label class="f">Сумма (для счёта-фактуры)<input id="d-amount" inputmode="decimal" placeholder="0"></label>
    <label class="f full">Файл (PDF, фото, Word, Excel)<input type="file" id="d-file" required></label>
    <div class="full err" id="d-err"></div>
    <div class="full row" style="justify-content:flex-end"><button type="button" class="btn" data-act="close">Отмена</button><button class="btn primary" id="d-save">Загрузить</button></div>
  </form>`);
  $("#d-form").onsubmit = async e => {
    e.preventDefault(); const f = $("#d-file").files[0]; if (!f) { $("#d-err").textContent = "Выберите файл."; return; }
    const b = $("#d-save"); b.disabled = true; b.textContent = "Загружаю…";
    try {
      const path = await uploadFile(f, "projects/" + p.id);
      const { error } = await S.sb.from("documents").insert({ project_id: p.id, kind: $("#d-kind").value, doc_date: $("#d-date").value || null, name: $("#d-name").value.trim() || f.name, amount: parseNum($("#d-amount").value) || 0, file_path: path });
      if (error) throw error;
      const k = $("#d-kind").value, ds = docState(p).find(x => x.kind === k);
      closeModal(); toast("Документ загружен"); afterWrite("documents");
      if (ds && (ds.status === "todo" || ds.status === "none")) saveDoc(p, k, { status: "ready", date: ds.date || $("#d-date").value || "" });
    } catch (x) { b.disabled = false; b.textContent = "Загрузить"; $("#d-err").textContent = errText(x); }
  };
}

function profileModal() {
  sheet(`<div class="row between"><h2>Мой профиль</h2><button class="btn small" data-act="close">Закрыть</button></div>
  <div class="row"><span class="avatar" style="width:44px;height:44px;font-size:16px">${esc(initials(S.me.full_name || S.me.email))}</span><div><b>${esc(S.me.full_name || "")}</b><div class="muted" style="font-size:13px">${esc(S.me.email)} · ${ROLES[S.me.role]}</div></div></div>
  <form id="pr-form" class="form">
    <label class="f full">Имя<input id="pr-name" value="${esc(S.me.full_name || "")}"></label>
    <label class="f full">Новый пароль (если хотите сменить)<input type="password" id="pr-pass" autocomplete="new-password" minlength="6" placeholder="минимум 6 символов"></label>
    <div class="full err" id="pr-err"></div>
    <div class="full row" style="justify-content:flex-end"><button type="button" class="btn" data-act="close">Отмена</button><button class="btn primary" id="pr-save">Сохранить</button></div>
  </form>`);
  $("#pr-form").onsubmit = async e => {
    e.preventDefault(); const err = $("#pr-err"); err.textContent = "";
    try {
      const name = $("#pr-name").value.trim();
      if (name !== (S.me.full_name || "")) { const { error } = await S.sb.from("profiles").update({ full_name: name }).eq("id", S.me.id); if (error) throw error; }
      const pw = $("#pr-pass").value; if (pw) { const { error } = await S.sb.auth.updateUser({ password: pw }); if (error) throw error; }
      closeModal(); toast("Профиль сохранён"); afterWrite("profiles");
    } catch (x) { err.textContent = errText(x); }
  };
}

let menuOpen = false;
function closeMenu() { const m = $(".me-menu"); if (m) m.remove(); menuOpen = false; }
function toggleMenu() {
  if (menuOpen) return closeMenu();
  const d = document.createElement("div"); d.className = "me-menu";
  d.innerHTML = `<div class="who"><b>${esc(S.me.full_name || "")}</b><div class="muted">${esc(S.me.email)}</div><div class="role">${ROLES[S.me.role]}</div></div>
    <button data-act="profile">Мой профиль и пароль</button>${isOwner() ? '<a href="#users">Пользователи</a>' : ""}<button data-act="logout">Выйти</button>`;
  $("#me").appendChild(d); menuOpen = true;
}

let tt; function toast(t) { clearTimeout(tt); let el = $(".toast"); if (!el) { el = document.createElement("div"); el.className = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); } el.textContent = t; tt = setTimeout(() => el.remove(), 2800); }

/* ================= events ================= */
document.addEventListener("click", async e => {
  if (menuOpen && !e.target.closest(".me")) closeMenu();
  const t = e.target.closest("[data-act],[data-op],[data-href]"); if (!t) return;
  if (t.dataset.href) { location.hash = t.dataset.href.slice(1); return; }
  if (t.dataset.op) { const o = S.ops.find(x => x.id === t.dataset.op); if (o) opModal(o); return; }
  const a = t.dataset.act, r = route(), p = r.startsWith("project-") && S.projects.find(x => x.id === r.slice(8));
  if (a === "scrim" && e.target === t) closeModal();
  else if (a === "close") closeModal();
  else if (a === "me") toggleMenu();
  else if (a === "profile") { closeMenu(); profileModal(); }
  else if (a === "logout") { closeMenu(); await S.sb.auth.signOut(); }
  else if (a === "open-file") { e.preventDefault(); openFile(t.dataset.path); }
  else if (a === "new-op") { if (canWrite()) opModal(null, { type: t.dataset.type, project: t.dataset.project }); }
  else if (a === "new-project") projModal(null);
  else if (a === "edit-project") projModal(S.projects.find(x => x.id === t.dataset.id));
  else if (a === "new-doc" && p) docModal(p, t.dataset.kind, t.dataset.name);
  else if (a === "del-doc") {
    if (!t.dataset.c) { t.dataset.c = 1; t.textContent = "Удалить?"; return; }
    const d = S.documents.find(x => x.id === t.dataset.id); if (!d) return;
    const { error } = await S.sb.from("documents").delete().eq("id", d.id);
    if (error) return toast(errText(error));
    if (d.file_path) S.sb.storage.from("docs").remove([d.file_path]).catch(() => {});
    toast("Документ удалён"); afterWrite("documents");
  }
  else if (a === "toggle-cost") { costOpen = !costOpen; try { localStorage.setItem("cf-cost-open", costOpen ? "1" : "0"); } catch (x) {} render(); }
  else if (a === "new-add" && p) addModal(p);
  else if (a === "edit-add" && p) addModal(p, +t.dataset.i);
  else if (a === "del-add" && p) { if (!t.dataset.c) { t.dataset.c = 1; t.textContent = "Удалить?"; return; } const l = [...addenda(p)]; l.splice(+t.dataset.i, 1); saveAddenda(p, l); }
  else if (a === "toggle-stage" && p) saveStages(p, (p.stages || []).map((s, i) => i === +t.dataset.i ? Object.assign({}, s, { done: t.checked }) : s));
  else if (a === "del-stage" && p) { const s = [...(p.stages || [])]; s.splice(+t.dataset.i, 1); saveStages(p, s); }
  else if (a === "save-settings") {
    const split = s => s.split(",").map(x => x.trim()).filter(Boolean), msg = $("#s-msg");
    try {
      for (let i = 0; i < S.accounts.length; i++) {
        const ac = S.accounts[i], v = parseNum(document.querySelector(`[data-open="${i}"]`).value), biz = document.querySelector(`[data-biz="${i}"]`).checked;
        const opening = isFinite(v) ? v : 0;
        if (opening !== +ac.opening || biz !== ac.business) { const { error } = await S.sb.from("accounts").update({ opening, business: biz }).eq("name", ac.name); if (error) throw error; }
      }
      const na = $("#s-acc").value.trim();
      if (na && !S.accounts.some(x => x.name === na)) { const { error } = await S.sb.from("accounts").insert({ name: na, currency: $("#s-acc-cur").value, opening: 0, sort: S.accounts.length + 1 }); if (error) throw error; }
      const { error } = await S.sb.from("settings").update({ opening_date: $("#s-date").value || st().opening_date, usd_rate: parseNum($("#s-rate").value) || 0, out_cats: split($("#s-outcats").value), in_cats: split($("#s-incats").value), people: split($("#s-people").value), entities: split($("#s-entities").value) }).eq("id", 1);
      if (error) throw error;
      toast("Настройки сохранены"); afterWrite("accounts", "settings");
    } catch (x) { msg.textContent = errText(x); }
  }
});
document.addEventListener("change", e => {
  const r = route(), p = r.startsWith("project-") && S.projects.find(x => x.id === r.slice(8)); if (!p) return;
  const t = e.target.closest("[data-docst]"); if (t) return saveDoc(p, t.dataset.docst, { status: t.value });
  const a = e.target.closest("[data-addst]"); if (a) saveAddenda(p, addenda(p).map((x, i) => i === +a.dataset.addst ? Object.assign({}, x, { status: a.value }) : x));
});
document.addEventListener("keydown", e => { if (e.key === "Escape") { if ($("#modal").innerHTML) closeModal(); else closeMenu(); } });

/* ================= boot ================= */
let channel = null, recovering = false;
async function start() {
  if (recovering) return;
  const { data: { session } } = await S.sb.auth.getSession();
  if (session && S.loaded && S.session && S.session.user.id === session.user.id) { S.session = session; return; }
  S.session = session;
  if (!session) { S.loaded = false; S.me = null; if (channel) { S.sb.removeChannel(channel); channel = null; } return showLogin(); }
  const { data: me, error } = await S.sb.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
  if (error) return showLogin("login", errText(error));
  if (!me) return showLogin("login", "Профиль не найден. Проверьте, что в Supabase выполнен файл schema.sql.");
  S.me = me;
  if (me.role === "pending") return showPending();
  $("#login").hidden = true; $("#shell").hidden = false;
  $("#app").innerHTML = `<div class="loading">Загружаю данные…</div>`;
  await load(["accounts", "settings", "projects", "documents", "ops", "profiles"]);
  S.loaded = true; render();
  if (!channel) channel = S.sb.channel("db-changes").on("postgres_changes", { event: "*", schema: "public" }, payload => scheduleReload(payload.table)).subscribe();
}

if (!window.supabase || !cfg.SUPABASE_URL || /ВАШ-ПРОЕКТ/.test(cfg.SUPABASE_URL)) { showLogin(); return; }
S.sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
S.sb.auth.onAuthStateChange((event) => {
  if (event === "PASSWORD_RECOVERY") { recovering = true; showLogin("newpass"); return; }
  if (event === "SIGNED_IN" || event === "SIGNED_OUT") setTimeout(start, 0);
});
start();
})();
