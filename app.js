const db = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const state = {
  options: { departments: [], issue_types: [], buildings: [], statuses: [] },
  publicRows: [],
  adminRows: [],
  session: null
};

const today = () => new Date().toISOString().slice(0, 10);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function optionList(select, items) {
  select.innerHTML = '<option value="">請選擇</option>' +
    items.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("");
}

function statusClassByCode(code) {
  if (code === "closed") return "status-closed";
  if (code === "processing") return "status-processing";
  return "status-acknowledged";
}

function statusCodeByLabel(label) {
  return state.options.statuses.find((s) => s.label === label)?.code;
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
  }).format(date);
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 2400);
}

function fail(error, prefix) {
  console.error(prefix, error);
  showToast(`${prefix}：${error.message || error}`);
}

// ---------- 資料載入 ----------
async function loadOptions() {
  const [d, i, b, s] = await Promise.all([
    db.from("departments").select("id,name").eq("is_active", true).order("sort_order"),
    db.from("issue_types").select("id,name").eq("is_active", true).order("sort_order"),
    db.from("buildings").select("id,name").eq("is_active", true).order("sort_order"),
    db.from("repair_statuses").select("id,code,label,is_closed").order("sort_order")
  ]);
  const err = d.error || i.error || b.error || s.error;
  if (err) return fail(err, "載入選項失敗");
  state.options = { departments: d.data, issue_types: i.data, buildings: b.data, statuses: s.data };

  optionList(document.querySelector('[name="department_id"]'), d.data);
  optionList(document.querySelector('[name="issue_type_id"]'), i.data);
  optionList(document.querySelector('[name="building_id"]'), b.data);
  document.querySelector("#statusFilter").innerHTML = '<option value="">全部狀態</option>' +
    s.data.map((x) => `<option value="${escapeHtml(x.label)}">${escapeHtml(x.label)}</option>`).join("");
}

async function loadPublicRows() {
  const query = document.querySelector("#statusSearch").value.trim();
  const filter = document.querySelector("#statusFilter").value;
  let q = db.from("v_public_repair_requests").select("*").order("submitted_at", { ascending: false }).limit(200);
  if (filter) q = q.eq("status_label", filter);
  if (query) {
    const term = query.replace(/^r-/i, "").replace(/[,()%*\\]/g, " ").trim();
    if (term) {
      const conds = [
        `repair_location.ilike.*${term}*`,
        `issue_description.ilike.*${term}*`,
        `public_response.ilike.*${term}*`
      ];
      if (/^\d+$/.test(term)) conds.push(`id.eq.${term}`);
      q = q.or(conds.join(","));
    }
  }
  const { data, error } = await q;
  if (error) return fail(error, "載入進度失敗");
  state.publicRows = data;
  renderPublicRows();
  updateMetrics();
}

async function loadAdminRows() {
  if (!state.session) return;
  const { data, error } = await db
    .from("repair_requests")
    .select("*, departments(name), issue_types(name), buildings(name), repair_statuses(code,label)")
    .order("submitted_at", { ascending: false });
  if (error) return fail(error, "載入後台案件失敗");
  state.adminRows = data;
  renderAdminStats();
  renderAdminCards();
}

// ---------- 畫面 ----------
function renderPublicRows() {
  const tbody = document.querySelector("#publicRows");
  tbody.innerHTML = state.publicRows.map((item) => `
    <tr>
      <td data-label="編號">R-${escapeHtml(item.id)}</td>
      <td data-label="報修時間">${escapeHtml(formatDateTime(item.submitted_at))}</td>
      <td data-label="單位">${escapeHtml(item.department_name)}</td>
      <td data-label="類型">${escapeHtml(item.issue_type_name)}</td>
      <td data-label="大樓 / 位置"><strong>${escapeHtml(item.building_name)}</strong><br>${escapeHtml(item.repair_location)}</td>
      <td data-label="處理說明">${escapeHtml(item.public_response || "尚未填寫處理說明")}</td>
      <td data-label="狀態"><span class="status-pill ${statusClassByCode(statusCodeByLabel(item.status_label))}">${escapeHtml(item.status_label || "瞭解問題")}</span></td>
    </tr>
  `).join("") || '<tr><td colspan="7">目前沒有符合條件的報修資料。</td></tr>';
}

function renderAdminCards() {
  const wrap = document.querySelector("#adminCards");
  wrap.innerHTML = state.adminRows.map((item) => `
    <article class="admin-card" data-id="${escapeHtml(item.id)}">
      <div>
        <h3>R-${escapeHtml(item.id)}｜${escapeHtml(item.issue_types?.name)}</h3>
        <p>${escapeHtml(item.issue_description)}</p>
        <div class="admin-meta">
          <span>${escapeHtml(item.departments?.name)}</span>
          <span>${escapeHtml(item.buildings?.name)} / ${escapeHtml(item.repair_location)}</span>
          <span>${escapeHtml(formatDateTime(item.submitted_at))}</span>
          <span>${escapeHtml(item.requester_name)} / ${escapeHtml(item.line_id)}</span>
        </div>
      </div>
      <div class="admin-fields">
        <label>
          <span>處理說明(公開)</span>
          <textarea data-field="public_response" rows="3">${escapeHtml(item.public_response || "")}</textarea>
        </label>
        <label>
          <span>內部備註</span>
          <textarea data-field="private_note" rows="2">${escapeHtml(item.private_note || "")}</textarea>
        </label>
        <label>
          <span>維修人員</span>
          <input data-field="assignee_name" value="${escapeHtml(item.assignee_name || "")}">
        </label>
        <label>
          <span>狀態</span>
          <select data-field="status_id">
            ${state.options.statuses.map((s) => `<option value="${s.id}" ${s.id === item.status_id ? "selected" : ""}>${escapeHtml(s.label)}</option>`).join("")}
          </select>
        </label>
        <label>
          <span><input data-field="is_public" type="checkbox" ${item.is_public ? "checked" : ""}> 公開於進度查詢</span>
        </label>
        <button class="primary save-admin" type="button">儲存處理</button>
      </div>
    </article>
  `).join("") || '<p>尚無報修資料。</p>';
}

function countBy(items, getter) {
  return items.reduce((result, item) => {
    const value = getter(item) || "未填";
    result[value] = (result[value] || 0) + 1;
    return result;
  }, {});
}

function topEntries(counts, limit = 5) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), "zh-Hant"))
    .slice(0, limit);
}

function pct(value, total) {
  return total ? `${Math.round((value / total) * 100)}%` : "0%";
}

function renderStatCards(stats) {
  const cards = [
    ["總案件", stats.total, "目前累積案件數"],
    ["今日待處理", stats.todayOpen, "希望維修日為今天且未結案"],
    ["處理中", stats.processing, "狀態為正在處理"],
    ["已結案", stats.closed, `結案率 ${pct(stats.closed, stats.total)}`],
    ["公開案件", stats.publicCount, "會出現在進度查詢"],
    ["未指派", stats.unassigned, "尚未填維修人員"]
  ];
  document.querySelector("#adminStats").innerHTML = cards.map(([label, value, note]) => `
    <article class="stat-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(note)}</small>
    </article>
  `).join("");
}

function renderBarList(target, entries, total) {
  const wrap = document.querySelector(target);
  if (!entries.length) {
    wrap.innerHTML = '<p class="empty-state">目前沒有資料</p>';
    return;
  }
  wrap.innerHTML = entries.map(([label, count]) => `
    <div class="bar-row">
      <div class="bar-label"><span>${escapeHtml(label)}</span><strong>${escapeHtml(count)}</strong></div>
      <div class="bar-track"><span style="width: ${pct(count, total)}"></span></div>
    </div>
  `).join("");
}

function renderAdminStats() {
  const rows = state.adminRows;
  const code = (r) => r.repair_statuses?.code;
  const total = rows.length;
  renderStatCards({
    total,
    todayOpen: rows.filter((r) => r.preferred_repair_date === today() && code(r) !== "closed").length,
    processing: rows.filter((r) => code(r) === "processing").length,
    closed: rows.filter((r) => code(r) === "closed").length,
    publicCount: rows.filter((r) => r.is_public).length,
    unassigned: rows.filter((r) => !String(r.assignee_name || "").trim()).length
  });
  renderBarList("#statusStats", topEntries(countBy(rows, (r) => r.repair_statuses?.label), state.options.statuses.length), total);
  renderBarList("#issueStats", topEntries(countBy(rows, (r) => r.issue_types?.name)), total);
  renderBarList("#buildingStats", topEntries(countBy(rows, (r) => r.buildings?.name)), total);
}

async function updateMetrics() {
  const { count, error } = await db
    .from("v_public_repair_requests")
    .select("id", { count: "exact", head: true })
    .eq("preferred_repair_date", today())
    .neq("status_label", "己經結案");
  if (!error) document.querySelector("#todayOpenCount").textContent = String(count ?? 0);
}

// ---------- 登入 ----------
async function isStaff(session) {
  if (!session) return false;
  const { data } = await db.from("staff_profiles").select("user_id").eq("user_id", session.user.id).maybeSingle();
  return !!data;
}

async function applySession(session) {
  const staff = await isStaff(session);
  state.session = staff ? session : null;
  document.querySelector("#loginForm").hidden = staff;
  document.querySelector("#adminPanel").hidden = !staff;
  document.querySelector("#adminCards").hidden = !staff;
  document.querySelector("#logoutButton").hidden = !staff;
  if (session && !staff) {
    showToast("此帳號不是維修人員");
    await db.auth.signOut();
  }
  if (staff) await loadAdminRows();
  else state.adminRows = [];
}

// ---------- 初始化 ----------
async function init() {
  document.querySelector('[name="preferred_repair_date"]').value = today();

  document.querySelectorAll(".nav-button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".nav-button").forEach((item) => item.classList.remove("active"));
      document.querySelectorAll(".view").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      document.querySelector(`#${button.dataset.view}`).classList.add("active");
    });
  });

  document.querySelector("#repairForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const v = Object.fromEntries(new FormData(form).entries());
    if (v.issue_description.trim().length < 10) return showToast("問題描述至少 10 字");
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    const { data, error } = await db.rpc("submit_repair_request", {
      p_requester_email: v.requester_email,
      p_department_id: Number(v.department_id),
      p_requester_name: v.requester_name,
      p_line_id: v.line_id,
      p_preferred_repair_date: v.preferred_repair_date,
      p_issue_type_id: Number(v.issue_type_id),
      p_building_id: Number(v.building_id),
      p_repair_location: v.repair_location,
      p_issue_description: v.issue_description
    });
    submit.disabled = false;
    if (error) return fail(error, "送出失敗");
    form.reset();
    document.querySelector('[name="preferred_repair_date"]').value = today();
    showToast(`已建立報修 R-${data}`);
    loadPublicRows();
    loadAdminRows();
  });

  let timer;
  document.querySelector("#statusSearch").addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(loadPublicRows, 300);
  });
  document.querySelector("#statusFilter").addEventListener("change", loadPublicRows);

  document.querySelector("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const v = Object.fromEntries(new FormData(event.currentTarget).entries());
    const { error } = await db.auth.signInWithPassword({ email: v.email, password: v.password });
    if (error) return fail(error, "登入失敗");
    event.currentTarget.reset();
  });

  document.querySelector("#logoutButton").addEventListener("click", () => db.auth.signOut());

  document.querySelector("#adminCards").addEventListener("click", async (event) => {
    if (!event.target.classList.contains("save-admin")) return;
    const card = event.target.closest(".admin-card");
    const id = Number(card.dataset.id);
    const patch = {};
    card.querySelectorAll("[data-field]").forEach((f) => {
      const key = f.dataset.field;
      patch[key] = f.type === "checkbox" ? f.checked : key === "status_id" ? Number(f.value) : f.value;
    });
    const closed = state.options.statuses.find((s) => s.id === patch.status_id)?.is_closed;
    if (closed && !patch.public_response.trim()) return showToast("結案前請填寫公開處理說明");
    const { error } = await db.from("repair_requests").update(patch).eq("id", id);
    if (error) return fail(error, "更新失敗");
    showToast(`R-${id} 已更新`);
    loadAdminRows();
    loadPublicRows();
  });

  db.auth.onAuthStateChange((_event, session) => {
    // 避免在回呼內直接 await supabase 呼叫造成死結
    setTimeout(() => applySession(session), 0);
  });

  await loadOptions();
  await loadPublicRows();
  const { data } = await db.auth.getSession();
  await applySession(data.session);
}

init();
