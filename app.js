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
const DOCKINDS = ["Договор", "Счёт-фактура", "Акт выполненных работ", "Доп. соглашение", "Другое"];
const ROLES = { owner: "Владелец", partner: "Партнёр", accountant: "Бухгалтер", pending: "Без доступа" };

/* ================= state ================= */
const cfg = window.APP_CONFIG || {};
const S = {
  sb: null, session: null, me: null,
  accounts: [], settings: null, projects: [], documents: [], ops: [], profiles: [],
  loaded: false, f: { month: "", account: "", project: "", cat: "", who: "", type: "" }, cfMonth: ""
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
function projMoney(p) {
  const cur = p.currency || "UZS", ops = S.ops.filter(o => o.project_id === p.id);
  const received = ops.filter(o => o.type === "in").reduce((s, o) => s + inCur(o, cur), 0);
  const spent = ops.filter(o => o.type === "out").reduce((s, o) => s + inCur(o, cur), 0);
  const docs = S.documents.filter(d => d.project_id === p.id);
  const invoiced = docs.filter(d => d.kind === "Счёт-фактура").reduce((s, d) => s + (+d.amount || 0), 0);
  const contract = +p.contract_sum || 0;
  return { cur, received, spent, invoiced, contract, debt: Math.max(contract - received, 0), unpaidInv: Math.max(invoiced - received, 0), profit: received - spent, ops, docs };
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
  const r = route(), cur = r.startsWith("project-") ? "projects" : r;
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
  ${m.debt > 0 ? `<span style="font-size:13px">Долг заказчика: <b class="num neg">${money(m.debt, m.cur)}</b></span>` : ""}</a>`;
}
function opsTable(list, compact) {
  const prj = id => (S.projects.find(p => p.id === id) || {}).name || "";
  return `<div class="tbl-wrap"><table><thead><tr><th>Дата</th><th>Операция</th>${compact ? "" : '<th class="hide-m">Счёт</th><th class="hide-m">Кто взял</th>'}<th class="r">Сумма</th></tr></thead><tbody>${list.map(o => {
    const sign = o.type === "in" ? "+" : o.type === "out" ? "−" : "";
    const title = o.type === "transfer" ? `${esc(o.account)} → ${esc(o.to_account)}` : esc(o.category || "Без категории");
    const sub = [o.counterparty, o.type !== "transfer" && compact ? o.account : "", prj(o.project_id), o.note].filter(Boolean).map(esc).join(" · ");
    return `<tr class="click oprow" data-op="${esc(o.id)}"><td class="num" style="font-size:13px">${fmtDate(o.op_date)}</td><td><div>${title}</div>${sub ? `<div class="meta">${sub}</div>` : ""}</td>${compact ? "" : `<td class="hide-m">${esc(o.account)}</td><td class="hide-m">${esc(o.who || "")}</td>`}<td class="r num ${o.type === "in" ? "pos" : o.type === "out" ? "neg" : ""}">${sign}${money(o.amount, o.currency)}</td></tr>`;
  }).join("")}</tbody></table></div>`;
}

function vProjects() {
  const list = [...S.projects].sort((a, b) => (a.status === "closed") - (b.status === "closed") || (b.created_at || "").localeCompare(a.created_at || ""));
  $("#app").innerHTML = `<div class="row between"><h1>Проекты</h1>${canWrite() ? '<button class="btn primary" data-act="new-project">+ Новый проект</button>' : ""}</div>
  <section class="panel">${list.length ? `<div class="tbl-wrap"><table><thead><tr><th>Проект</th><th>Статус</th><th class="r">Договор</th><th class="r">Получено</th><th class="r">Долг</th><th class="r hide-m">Расходы</th><th class="r hide-m">Прибыль</th></tr></thead><tbody>${list.map(p => { const m = projMoney(p); return `<tr class="click" data-href="#project-${esc(p.id)}"><td><b>${esc(p.name)}</b><div class="muted" style="font-size:12px">${esc([p.entity, p.client].filter(Boolean).join(" · "))}</div></td><td><span class="pill ${stCls(p.status)}">${stName(p.status)}</span></td><td class="r num">${money(m.contract, m.cur)}</td><td class="r num">${money(m.received, m.cur)}</td><td class="r num ${m.debt > 0 ? "neg" : ""}">${money(m.debt, m.cur)}</td><td class="r num hide-m">${money(m.spent, m.cur)}</td><td class="r num hide-m ${m.profit < 0 ? "neg" : ""}">${money(m.profit, m.cur)}</td></tr>`; }).join("")}</tbody></table></div>`
  : `<div class="empty"><b>Проектов пока нет</b>В проекте хранятся договор, счета-фактуры, этапы работ, оплаты заказчика и расходы.${canWrite() ? '<button class="btn primary" data-act="new-project">Добавить проект</button>' : ""}</div>`}</section>`;
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
    <div class="muted" style="margin-top:4px">${p.entity ? `<b>${esc(p.entity)}</b> · ` : ""}${esc(p.client || "Заказчик не указан")}${p.contract_no ? ` · договор №${esc(p.contract_no)}` : ""}${p.contract_date ? ` от ${fmtDate(p.contract_date)}` : ""}${p.deadline ? ` · срок ${fmtDate(p.deadline)}` : ""}</div></div>
    ${canWrite() ? `<button class="btn" data-act="edit-project" data-id="${esc(p.id)}">Изменить</button>` : ""}</div>
  <div class="grid kpis">
    ${k("Сумма договора", money(m.contract, m.cur))}
    ${k("Получено от заказчика", money(m.received, m.cur), "pos", m.contract ? Math.round(m.received / m.contract * 100) + "% договора" : "")}
    ${k("Долг заказчика", money(m.debt, m.cur), m.debt > 0 ? "neg" : "", m.invoiced ? `по счетам не оплачено ${money(m.unpaidInv, m.cur)}` : "счетов-фактур нет")}
    ${k("Расходы по проекту", money(m.spent, m.cur), "neg")}
    ${k("Прибыль сейчас", money(m.profit, m.cur), m.profit < 0 ? "neg" : "pos", "получено минус расходы")}
  </div>
  ${canWrite() ? `<div class="row"><button class="btn primary" data-act="new-op" data-type="in" data-project="${esc(p.id)}">+ Оплата от заказчика</button><button class="btn" data-act="new-op" data-type="out" data-project="${esc(p.id)}">+ Расход по проекту</button></div>` : ""}
  <div class="grid two">
    <section class="panel"><div class="panel-h"><h2>Оплаты и расходы</h2><span class="muted" style="font-size:13px">${ops.length} операций</span></div>
      ${ops.length ? opsTable(ops, true) : `<div class="empty">По проекту пока нет операций.</div>`}</section>
    <div class="grid" style="align-content:start">
      <section class="panel"><div class="panel-h"><h2>Этапы работ</h2></div>
        <div>${stages.map((s, i) => `<div class="stage ${s.done ? "done" : ""}"><input type="checkbox" id="st-${i}" data-act="toggle-stage" data-i="${i}" ${s.done ? "checked" : ""} ${canWrite() ? "" : "disabled"}><label for="st-${i}" class="sn" style="flex:1">${esc(s.name)}</label>${s.due ? `<span class="muted num" style="font-size:12px">${fmtDate(s.due)}</span>` : ""}${canWrite() ? `<button class="btn small" data-act="del-stage" data-i="${i}" aria-label="Удалить этап">×</button>` : ""}</div>`).join("") || '<div class="empty" style="padding:16px">Этапов пока нет.</div>'}</div>
        ${canWrite() ? `<form class="panel-b row" id="stage-form" style="border-top:1px solid var(--line)"><input id="stage-name" placeholder="Новый этап, напр. «Дизайн макета»" style="flex:1;min-width:160px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--surface)"><input id="stage-due" type="date" style="padding:7px 8px;border:1px solid var(--line);border-radius:8px;background:var(--surface)"><button class="btn small">Добавить</button></form>` : ""}
      </section>
      <section class="panel"><div class="panel-h"><h2>Документы</h2>${canWrite() ? '<button class="btn small" data-act="new-doc">+ Документ</button>' : ""}</div>
        <div class="docs">${m.docs.map(d => `<div class="doc"><span class="ico">${esc(((d.file_path || "").split(".").pop() || "DOC").toUpperCase().slice(0, 4))}</span><div style="flex:1;min-width:0"><div style="overflow-wrap:anywhere">${d.file_path ? `<a href="#" data-act="open-file" data-path="${esc(d.file_path)}">${esc(d.name || d.kind)}</a>` : esc(d.name || d.kind)}</div><div class="k">${esc(d.kind)}${d.doc_date ? " · " + fmtDate(d.doc_date) : ""}${+d.amount ? ' · <span class="num">' + money(+d.amount, m.cur) + "</span>" : ""}${d.created_by ? " · " + esc(pname(d.created_by)) : ""}</div></div>${(isFull() || d.created_by === S.me.id) ? `<button class="btn small" data-act="del-doc" data-id="${esc(d.id)}" aria-label="Удалить документ">×</button>` : ""}</div>`).join("") || `<div class="empty" style="padding:16px">Договор, счета-фактуры и акты появятся здесь.</div>`}</div>
      </section>
      ${p.notes ? `<section class="panel"><div class="panel-h"><h2>Заметки</h2></div><div class="panel-b" style="white-space:pre-wrap">${esc(p.notes)}</div></section>` : ""}
    </div>
  </div>`;
  const sf = $("#stage-form");
  if (sf) sf.onsubmit = async e => { e.preventDefault(); const n = $("#stage-name").value.trim(); if (!n) return; await saveStages(p, [...stages, { name: n, due: $("#stage-due").value || "", done: false }]); };
}
async function saveStages(p, stages) { const { error } = await S.sb.from("projects").update({ stages }).eq("id", p.id); if (error) return toast(errText(error)); afterWrite("projects"); }

function filteredOps() {
  const f = S.f;
  return S.ops.filter(o => (!f.month || (o.op_date || "").startsWith(f.month)) && (!f.account || o.account === f.account || o.to_account === f.account) && (!f.project || (f.project === "-" ? !o.project_id : o.project_id === f.project)) && (!f.cat || o.category === f.cat) && (!f.who || o.who === f.who) && (!f.type || o.type === f.type)).sort(sortOps);
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
  </div>
  <div class="row muted" style="font-size:14px"><span>${list.length} операций</span><span>Приход <b class="num pos">${money(ti)}</b></span><span>Расход <b class="num neg">${money(to)}</b></span></div>
  <section class="panel">${list.length ? opsTable(list, false) : `<div class="empty">Нет операций${Object.values(f).some(Boolean) ? " с такими фильтрами" : ""}.</div>`}</section>`;
  ["type", "month", "account", "project", "cat", "who"].forEach(k => $("#f-" + k).addEventListener("change", e => { S.f[k] = e.target.value; vOps(); }));
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
  let type = o.type;
  const lastRate = (S.ops.filter(x => x.currency === "USD" && x.rate).sort(sortOps)[0] || {}).rate || s.usd_rate || "";
  const mayEdit = !op || isFull() || op.created_by === S.me.id || S.me.role === "accountant";
  const mayDel = op && (isFull() || op.created_by === S.me.id);
  const collect = () => { const g = id => { const e = $("#" + id); return e ? e.value : undefined; };
    const d = g("o-date"); if (d !== undefined) o.op_date = d; const a = g("o-amount"); if (a !== undefined) o.amount = parseNum(a) || undefined; const n = g("o-note"); if (n !== undefined) o.note = n;
    const ac = g("o-acc"); if (ac) o.account = ac; const c = g("o-cat"); if (c) o.category = c; const p = g("o-proj"); if (p !== undefined) o.project_id = p; const w = g("o-who"); if (w !== undefined) o.who = w; const cp = g("o-cp"); if (cp !== undefined) o.counterparty = cp; const t = g("o-to"); if (t) o.to_account = t; };
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
      ${type === "out" ? `<label class="f">Кто взял<input id="o-who" list="who-list" value="${esc(o.who || "")}"><datalist id="who-list">${s.people.map(p => `<option value="${esc(p)}">`).join("")}</datalist></label>` : ""}
      ${type !== "transfer" ? `<label class="f ${type === "in" ? "" : "full"}">${type === "in" ? "От кого" : "Кому / где"}<input id="o-cp" value="${esc(o.counterparty || "")}" placeholder="${type === "in" ? "заказчик, человек" : "магазин, человек, налоговая"}"></label>` : ""}
      <label class="f full">Комментарий<input id="o-note" value="${esc(o.note || "")}" placeholder="на что потрачено, номер счёта и т.п."></label>
      <label class="f full">Чек или документ (PDF, фото)<input type="file" id="o-file" accept="application/pdf,image/*">${o.doc_path ? `<span>Прикреплён: <a href="#" data-act="open-file" data-path="${esc(o.doc_path)}">открыть</a></span>` : ""}</label>
      <div class="full err" id="o-err"></div>
      <div class="full row between"><div>${mayDel ? '<button type="button" class="btn danger" id="o-del">Удалить</button>' : ""}</div><div class="row"><button type="button" class="btn" data-act="close">Отмена</button>${mayEdit ? '<button class="btn primary" id="o-save">Сохранить</button>' : ""}</div></div>
    </form>
    ${op ? `<div class="muted" style="font-size:12px">Добавил(а): ${esc(pname(op.created_by) || "—")}${op.created_at ? ", " + new Date(op.created_at).toLocaleString("ru-RU") : ""}</div>` : ""}`);
    document.querySelectorAll(".seg button").forEach(b => b.onclick = () => { collect(); type = b.dataset.t; draw(); });
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
    const rec = { type, op_date: $("#o-date").value || today(), amount, account, currency: cur, note: $("#o-note").value.trim() || null, rate: null, to_account: null, amount_to: null, category: null, project_id: null, counterparty: null, who: null };
    if (cur === "USD") { const r = parseNum($("#o-rate").value); if (!(r > 0)) { err.textContent = "Для долларового счёта укажите курс."; return; } rec.rate = r; }
    if (type === "transfer") { rec.to_account = $("#o-to").value; if (rec.to_account === account) { err.textContent = "Выберите разные счета."; return; } const at = parseNum($("#o-amountTo").value); if (at > 0) rec.amount_to = at; rec.category = "Перевод между счетами"; }
    else { rec.category = $("#o-cat").value; rec.project_id = $("#o-proj").value || null; rec.counterparty = $("#o-cp").value.trim() || null; }
    if (type === "out") rec.who = $("#o-who").value.trim() || null;
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
    <label class="f">Статус<select id="p-status">${STATUSES.map(x => `<option value="${x[0]}"${x[0] === o.status ? " selected" : ""}>${x[1]}</option>`).join("")}</select></label>
    <label class="f">Сумма договора<input id="p-sum" inputmode="decimal" value="${+o.contract_sum ? esc(nf.format(o.contract_sum)) : ""}" placeholder="0"></label>
    <label class="f">Валюта<select id="p-cur"><option${o.currency === "UZS" ? " selected" : ""}>UZS</option><option${o.currency === "USD" ? " selected" : ""}>USD</option></select></label>
    <label class="f">Номер договора<input id="p-no" value="${esc(o.contract_no || "")}"></label>
    <label class="f">Дата договора<input type="date" id="p-date" value="${esc(o.contract_date || "")}"></label>
    <label class="f">Срок сдачи<input type="date" id="p-deadline" value="${esc(o.deadline || "")}"></label>
    <label class="f full">Заметки<textarea id="p-notes" placeholder="что делаем, контакты заказчика, условия оплаты">${esc(o.notes || "")}</textarea></label>
    <div class="full err" id="p-err"></div>
    <div class="full row between"><div>${p && isFull() ? '<button type="button" class="btn danger" id="p-del">Удалить проект</button>' : ""}</div><div class="row"><button type="button" class="btn" data-act="close">Отмена</button><button class="btn primary" id="p-save">Сохранить</button></div></div>
  </form>`);
  $("#p-form").onsubmit = async e => {
    e.preventDefault();
    const rec = { name: $("#p-name").value.trim(), entity: $("#p-entity").value, client: $("#p-client").value.trim() || null, status: $("#p-status").value, contract_sum: parseNum($("#p-sum").value) || 0, currency: $("#p-cur").value, contract_no: $("#p-no").value.trim() || null, contract_date: $("#p-date").value || null, deadline: $("#p-deadline").value || null, notes: $("#p-notes").value.trim() || null };
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

function docModal(p) {
  sheet(`<div class="row between"><h2>Новый документ</h2><button class="btn small" data-act="close">Закрыть</button></div>
  <form id="d-form" class="form">
    <label class="f">Вид<select id="d-kind">${DOCKINDS.map(k => `<option>${k}</option>`).join("")}</select></label>
    <label class="f">Дата<input type="date" id="d-date" value="${today()}"></label>
    <label class="f full">Название<input id="d-name" placeholder="например, Счёт-фактура №12"></label>
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
      closeModal(); toast("Документ загружен"); afterWrite("documents");
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
  else if (a === "new-doc" && p) docModal(p);
  else if (a === "del-doc") {
    if (!t.dataset.c) { t.dataset.c = 1; t.textContent = "Удалить?"; return; }
    const d = S.documents.find(x => x.id === t.dataset.id); if (!d) return;
    const { error } = await S.sb.from("documents").delete().eq("id", d.id);
    if (error) return toast(errText(error));
    if (d.file_path) S.sb.storage.from("docs").remove([d.file_path]).catch(() => {});
    toast("Документ удалён"); afterWrite("documents");
  }
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
