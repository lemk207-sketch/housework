// ============================================================
// HẰNG SỐ HIỂN THỊ
// ============================================================
const DAY_SHORT = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
const DAY_FULL  = ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ nhật"];

const BLOCKS = [
  { id: "morning",   label: "🌤️ Buổi sáng" },
  { id: "afternoon", label: "🍳 Buổi chiều" },
  { id: "evening",   label: "🌙 Buổi tối" },
];

const WEIGHT_LABELS = { 1: "Nhẹ (1đ)", 2: "Vừa (2đ)", 4: "Nặng (4đ)" };

// ============================================================
// STATE — lấy & lưu qua API của server (server.js), dữ liệu thật sự
// nằm trong database SQLite (housework.db). Mở lại trang vẫn còn nguyên,
// và 3 chị em mở từ máy/điện thoại khác nhau cũng thấy cùng một dữ liệu.
// ============================================================
let state = { people: [], tasks: [], completions: {}, weekStart: "", weekDates: [], shares: {} };
let editingTaskId = null;   // id việc đang sửa, null = đang thêm mới
let openModePanel = null;   // { personId, mode } — panel kích hoạt chế độ đang mở
let doerPickerFor = null;   // { date, taskId } — đang mở bảng chọn "ai đã làm việc này"

async function api(path, options) {
  const res = await fetch(path, options);
  let body = null;
  try { body = await res.json(); } catch { /* không có body JSON */ }
  if (!res.ok) throw new Error((body && body.error) || `Lỗi server (${res.status})`);
  return body;
}

async function refresh() {
  state = await api("/api/state");
  setFooterStatus(`Đã kết nối database — tuần bắt đầu từ ${fmtDateLabel(state.weekStart)}.`);
  // Chỉ cho phép mở form thêm việc SAU KHI đã có danh sách người — tránh trường hợp
  // bấm quá nhanh lúc trang vừa tải, khiến ô "Người phụ trách" bị rỗng do chưa có dữ liệu.
  if (state.people.length > 0) {
    showFormBtn.disabled = false;
    showFormBtn.textContent = "＋ Thêm việc nhà";
    aiFab.hidden = false;
  }
  renderAll();
}

// Khung xương chờ dữ liệu — hiện ngay khi mở trang, thay vì để khoảng trắng trống trơn
// trong lúc chờ gọi /api/state lần đầu.
function showSkeletons() {
  const row = (w = "70%") => `<div class="skeleton skeleton-line" style="width:${w}"></div>`;
  const grid = document.getElementById("people-grid");
  if (grid) {
    grid.innerHTML = Array.from({ length: 3 }).map(() => `
      <div class="skeleton skeleton-row"></div>
    `).join("");
  }
  const ledger = document.getElementById("ledger");
  if (ledger) {
    ledger.innerHTML = Array.from({ length: 3 }).map(() => `
      <div class="skeleton skeleton-row" style="height:40px"></div>
    `).join("");
  }
  const taskList = document.getElementById("task-list");
  if (taskList) {
    taskList.innerHTML = Array.from({ length: 4 }).map(() => `
      <div class="skeleton skeleton-row" style="height:48px"></div>
    `).join("");
  }
  const donuts = document.getElementById("percent-donuts");
  if (donuts) {
    donuts.innerHTML = Array.from({ length: 3 }).map(() => `
      <div class="skeleton" style="width:120px; height:120px; border-radius:50%; margin:auto"></div>
    `).join("");
  }
}

function setFooterStatus(text, isError) {
  const el = document.getElementById("footer-status");
  el.textContent = text;
  el.classList.toggle("error", !!isError);
}

// ============================================================
// HÀM TIỆN ÍCH
// ============================================================
function personById(id) { return state.people.find(p => p.id === id); }
function otherNames(personId) {
  return state.people.filter(p => p.id !== personId).map(p => p.name).join(" & ");
}

// Avatar: lấy chữ cái đầu của tên gọi (bỏ qua "Chị"/"Em" để ra chữ đặc trưng — VD "Chị Nấm" → "N")
function personInitial(name) {
  const words = name.trim().split(/\s+/);
  const skip = new Set(["chị", "em", "anh", "bé"]);
  const main = words.find(w => !skip.has(w.toLowerCase())) || words[words.length - 1];
  return main.charAt(0).toUpperCase();
}
function avatarHTML(person, size = "md") {
  return `<span class="avatar avatar-${size}" style="--avatar-color:${person.color}">${personInitial(person.name)}</span>`;
}

// Donut: vòng tròn % bằng CSS conic-gradient thuần — dùng chung cho mục Tỉ trọng & Hồ sơ cá nhân
function donutHTML({ percent, color, caption = "", size = "", extraClass = "", title = "" }) {
  const pct = Math.max(0, Math.min(100, percent || 0));
  const sizeClass = size ? `donut-${size}` : "";
  return `
    <div class="donut ${sizeClass} ${extraClass}" style="--pct:${pct}; --donut-color:${color}" ${title ? `title="${title}"` : ""}>
      <div class="donut-label">
        <span class="donut-pct">${pct.toFixed(0)}%</span>
        ${caption ? `<span class="donut-caption">${caption}</span>` : ""}
      </div>
    </div>
  `;
}

// ============================================================
// 7 NGÀY TRONG TUẦN — dữ liệu cho timeline & "chuỗi ngày hoàn thành" (streak)
// ============================================================
// "Người được tính công" cho 1 lần làm việc: nếu đã có người ghi nhận hoàn thành
// (doneBy) thì tính cho người đó — kể cả khi khác với người phụ trách mặc định
// (vd: việc của Em Xoài nhưng Chị Nấm rửa giúp thì % cộng cho Chị Nấm).
// Nếu chưa làm thì vẫn thuộc về người phụ trách (đang "nợ" việc này).
function creditedPerson(dateStr, task) {
  const doneBy = state.completions[dateStr] && state.completions[dateStr][task.id];
  return doneBy || task.personId;
}

function computeWeekTimeline(personId) {
  const today = todayIso();
  return state.weekDates.map((dateStr, dayIdx) => {
    let total = 0, done = 0;
    state.tasks.forEach(t => {
      if (!t.days.includes(dayIdx) || creditedPerson(dateStr, t) !== personId) return;
      total += t.weight;
      if (state.completions[dateStr] && state.completions[dateStr][t.id]) done += t.weight;
    });
    return {
      dateStr, dayIdx, total, done,
      pct: total > 0 ? (done / total) * 100 : null,
      isToday: dateStr === today,
      isFuture: dateStr > today,
    };
  });
}

// Số ngày liên tục (tính tới hôm nay, lùi về đầu tuần) mà người này hoàn thành 100% việc được giao.
// Ngày không được giao việc nào thì bỏ qua, không tính cũng không phá chuỗi.
function computeStreak(personId) {
  const timeline = computeWeekTimeline(personId);
  let streak = 0;
  for (let i = timeline.length - 1; i >= 0; i--) {
    const day = timeline[i];
    if (day.isFuture) continue;
    if (day.total === 0) continue;
    if (day.pct === 100) streak++;
    else break;
  }
  return streak;
}
function fmtDays(days) {
  if (days.length === 7) return "Hằng ngày";
  return [...days].sort((a, b) => a - b).map(d => DAY_SHORT[d]).join(", ");
}
function fmtDateLabel(isoStr) {
  if (!isoStr) return "";
  const [, m, d] = isoStr.split("-");
  return `${d}/${m}`;
}
function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ============================================================
// TUYẾT AI — tính tiến độ & gợi ý bù nợ cho từng người, dựa hoàn toàn
// trên dữ liệu đã có (việc được giao + đánh dấu đã xong + sổ nợ chung).
// Đây là "AI" theo kiểu luật/gợi ý thông minh, không gọi dịch vụ ngoài.
// ============================================================
function computeProgress(personId) {
  const today = todayIso();
  const todayIdx = state.weekDates.indexOf(today);

  let todayTotal = 0, todayDone = 0;
  let weekTotal = 0, weekDone = 0;

  state.tasks.forEach(t => {
    t.days.forEach(dayIdx => {
      const dateStr = state.weekDates[dayIdx];
      if (!dateStr || creditedPerson(dateStr, t) !== personId) return;
      const done = !!(state.completions[dateStr] && state.completions[dateStr][t.id]);
      weekTotal += t.weight;
      if (done) weekDone += t.weight;
      if (dayIdx === todayIdx) {
        todayTotal += t.weight;
        if (done) todayDone += t.weight;
      }
    });
  });

  return {
    todayPct: todayTotal > 0 ? (todayDone / todayTotal) * 100 : null,
    todayDoneCount: todayTotal > 0 ? `${todayDone}/${todayTotal} điểm việc` : null,
    weekPct: weekTotal > 0 ? (weekDone / weekTotal) * 100 : null,
    weekRemainingPct: weekTotal > 0 ? Math.max(0, 100 - (weekDone / weekTotal) * 100) : null,
  };
}

function upcomingUndone(personId) {
  const today = todayIso();
  const list = [];
  state.tasks.forEach(t => {
    if (t.personId !== personId) return;
    t.days.forEach(dayIdx => {
      const dateStr = state.weekDates[dayIdx];
      if (!dateStr || dateStr < today) return;
      const done = !!(state.completions[dateStr] && state.completions[dateStr][t.id]);
      if (!done) list.push({ task: t, dateStr, dayIdx });
    });
  });
  list.sort((a, b) => a.dateStr.localeCompare(b.dateStr));
  return list;
}

function buildAiLines(personId) {
  const person = personById(personId);
  const progress = computeProgress(personId);
  const balance = person.balanceWeeks;
  const lines = [];

  // 1) Tiến độ tuần này so với chỉ tiêu (= hoàn thành đủ việc được giao)
  if (progress.weekPct === null) {
    lines.push(`${person.name} hiện chưa được giao việc nào trong tuần này.`);
  } else if (progress.weekRemainingPct < 1) {
    lines.push(`Tuần này ${person.name} đã hoàn thành <strong>100%</strong> việc được giao — quá đỉnh, cứ giữ vững phong độ này nhé! 🎉`);
  } else {
    const next = upcomingUndone(personId)[0];
    lines.push(`Tuần này ${person.name} đã xong khoảng <strong>${progress.weekPct.toFixed(0)}%</strong> việc được giao, còn khoảng <strong>${progress.weekRemainingPct.toFixed(0)}%</strong> nữa để đủ chỉ tiêu (không bị tính nợ thêm).`);
    if (next) {
      lines.push(`👉 Gợi ý: làm "<strong>${next.task.name}</strong>" vào ${DAY_FULL[next.dayIdx]} (${fmtDateLabel(next.dateStr)}) trước nhé.`);
    }
  }

  // 2) Sổ nợ chung — gợi ý cách bù nếu đang nợ
  if (balance < -0.05) {
    const owe = Math.abs(balance);
    const helper = [...state.people].filter(p => p.id !== personId).sort((a, b) => b.balanceWeeks - a.balanceWeeks)[0];
    let helpLine = `📒 ${person.name} đang <strong>nợ khoảng ${owe.toFixed(1)} tuần</strong> việc nhà.`;
    if (helper) {
      const h = upcomingUndone(helper.id)[0];
      if (h) {
        helpLine += ` Để bù dần, có thể chủ động làm giúp "<strong>${h.task.name}</strong>" (việc của ${helper.name}) vào ${DAY_FULL[h.dayIdx]} (${fmtDateLabel(h.dateStr)}).`;
      } else {
        helpLine += ` Để bù dần, hãy chủ động nhận thêm việc giúp ${helper.name} trong vài ngày tới nhé.`;
      }
    }
    lines.push(helpLine);
  } else if (balance > 0.05) {
    lines.push(`📒 ${person.name} hiện đang <strong>dư khoảng ${balance.toFixed(1)} tuần</strong> — đã làm nhiều hơn phần của mình, cả nhà đang ghi nhận đó! Cứ duy trì nhịp độ bình thường là ổn.`);
  } else {
    lines.push(`📒 Sổ nợ chung của ${person.name} đang <strong>cân bằng</strong> — không nợ, không dư.`);
  }

  return lines;
}

// ============================================================
// TUYẾT AI CHAT POPUP
// ============================================================
let aiPopupOpen = false;

function renderAiChat() {
  const body = document.getElementById("ai-popup-body");
  if (!body) return;
  body.innerHTML = state.people.map(p => {
    const lines = buildAiLines(p.id);
    return `
      <div class="ai-card" style="--p-color:${p.color}">
        <div class="ai-avatar">🧊</div>
        <div>
          <div class="ai-name">${avatarHTML(p, "sm")} ${p.name}</div>
          ${lines.map(l => `<p class="ai-line">${l}</p>`).join("")}
        </div>
      </div>
    `;
  }).join("");
}

function openAiChat() {
  renderAiChat();
  document.getElementById("ai-popup").hidden = false;
  aiPopupOpen = true;
}

function closeAiChat() {
  document.getElementById("ai-popup").hidden = true;
  aiPopupOpen = false;
}

// ============================================================
// HỒ SƠ CÁ NHÂN — bấm vào một người để xem % hôm nay/tuần này + Tuyết AI
// ============================================================
let openProfileId = null;

function dayCellHTML(person, day) {
  let note, miniDonut;
  if (day.total === 0) {
    note = "Không có việc";
    miniDonut = `<div class="donut donut-sm" style="--pct:0; --donut-color:#e6e2da"><div class="donut-label"><span class="donut-pct">–</span></div></div>`;
  } else if (day.isFuture) {
    note = `${day.total} điểm việc`;
    miniDonut = donutHTML({ percent: 0, color: "#d8d2c6", size: "sm" });
  } else {
    note = day.pct === 100 ? "✓ Xong hết" : `${Math.round(day.pct)}% xong`;
    miniDonut = donutHTML({ percent: day.pct, color: person.color, size: "sm" });
  }
  return `
    <div class="day-cell-card ${day.isToday ? "is-today" : ""}">
      <span class="day-cell-label">${DAY_SHORT[day.dayIdx]}${day.isToday ? " 👈" : ""}</span>
      ${miniDonut}
      <span class="day-cell-note">${note}</span>
    </div>
  `;
}

function streakBadgeHTML(person, streak) {
  if (streak <= 0) {
    return `
      <div class="streak-badge zero">
        <span class="streak-flame">💤</span>
        <span>Chưa có chuỗi ngày hoàn thành nào trong tuần này — bắt đầu ngay hôm nay để mở chuỗi mới nhé, ${person.name}!</span>
      </div>`;
  }
  return `
    <div class="streak-badge">
      <span class="streak-flame">🔥</span>
      <span><strong>${streak} ngày liên tục</strong> ${person.name} hoàn thành đủ 100% việc được giao — giữ vững phong độ này nhé!</span>
    </div>`;
}

function renderProfile(personId) {
  const person = personById(personId);
  const content = document.getElementById("profile-content");
  if (!content) return;
  if (!person) {
    content.innerHTML = `<p class="hint">Không tìm thấy dữ liệu người này (id: "${personId}"). Hãy bấm "Quay lại", tải lại trang (Ctrl+F5) rồi thử lại nhé.</p>`;
    return;
  }

  try {
    const modeLabel = { normal: "Bình thường", exam: "📚 Đang ôn thi", free: "🌿 Đang rảnh" };
    const progress = computeProgress(personId);
    const lines = buildAiLines(personId);
    const timeline = computeWeekTimeline(personId);
    const streak = computeStreak(personId);

    const fair = (state.shares[person.id] && state.shares[person.id].percent) || 0;
    let statusLine;
    if (person.mode === "exam" && person.modeDetail) {
      statusLine = `Đang ở chế độ <strong>Bận thi 📚</strong> — nhận khoảng <strong>${person.modeDetail.percent}%</strong> khối lượng trong <strong>${person.modeDetail.weeks} tuần</strong>, phần còn lại ${otherNames(person.id)} chia nhau gánh.`;
    } else if (person.mode === "free" && person.modeDetail) {
      statusLine = `Đang ở chế độ <strong>Đang rảnh 🌿</strong> — nhận thêm tới <strong>${person.modeDetail.percent}%</strong> khối lượng trong <strong>${person.modeDetail.weeks} tuần</strong>, phần dư dùng để bù nợ chung.`;
    } else {
      statusLine = `Theo lịch bình thường — đảm nhận khoảng <strong>${fair.toFixed(1)}%</strong> tổng khối lượng việc nhà mỗi tuần.`;
    }

    const bal = person.balanceWeeks;
    let balCls = "even", balNote = "Đang cân bằng — không nợ, không dư.";
    if (bal > 0.05)       { balCls = "credit"; balNote = "Đã làm dư so với phần của mình — sẽ được tính bù khi cần."; }
    else if (bal < -0.05) { balCls = "debt";   balNote = "Đang nợ phần việc — sẽ được bù dần ở những tuần sau."; }

    const todayDetail = progress.todayPct === null
      ? "Hôm nay không có việc nào được giao."
      : `Đã hoàn thành ${progress.todayDoneCount} được giao hôm nay.`;
    const weekDetail = progress.weekPct === null
      ? "Tuần này chưa có việc nào được giao."
      : `Còn khoảng ${progress.weekRemainingPct.toFixed(0)}% nữa để đủ chỉ tiêu tuần (không bị tính nợ thêm).`;

    content.innerHTML = `
      <div class="profile-hero" style="--p-color:${person.color}">
        ${avatarHTML(person, "xl")}
        <div>
          <h2 class="profile-name">${person.name}</h2>
          <span class="mode-badge ${person.mode}">${modeLabel[person.mode]}</span>
          <p class="profile-status-line">${statusLine}</p>
        </div>
      </div>

      <p class="profile-section-title">Tiến độ làm việc</p>
      <div class="profile-rings">
        <div class="ring-card" style="--p-color:${person.color}">
          ${donutHTML({ percent: progress.todayPct ?? 0, color: person.color, caption: "hôm nay", size: "lg" })}
          <div class="ring-info">
            <div class="ring-title">Hôm nay</div>
            <div class="ring-detail">${todayDetail}</div>
          </div>
        </div>
        <div class="ring-card" style="--p-color:${person.color}">
          ${donutHTML({ percent: progress.weekPct ?? 0, color: person.color, caption: "tuần này", size: "lg" })}
          <div class="ring-info">
            <div class="ring-title">Tuần này</div>
            <div class="ring-detail">${weekDetail}</div>
          </div>
        </div>
      </div>

      ${streakBadgeHTML(person, streak)}

      <p class="profile-section-title">7 ngày trong tuần này</p>
      <div class="day-timeline">
        ${timeline.map(day => dayCellHTML(person, day)).join("")}
      </div>

      <p class="profile-section-title">Sổ nợ chung</p>
      <div class="profile-balance-card ${balCls}">
        ${avatarHTML(person, "md")}
        <div>
          <div class="balance-figure">${bal > 0 ? "+" : ""}${bal.toFixed(2)} tuần</div>
          <div class="balance-note">${balNote}</div>
        </div>
      </div>

      <div class="ai-box">
        <div class="ai-avatar">🧊</div>
        <div class="ai-bubble">
          <strong>Tuyết AI gợi ý cho ${person.name}</strong>
          ${lines.map(l => `<p class="ai-line">${l}</p>`).join("")}
        </div>
      </div>
    `;
  } catch (err) {
    content.innerHTML = `<p class="hint">Có lỗi khi hiển thị hồ sơ: ${err.message}. Hãy bấm "Quay lại", tải lại trang (Ctrl+F5) rồi thử lại — và cho mình biết nếu vẫn gặp lỗi này nhé.</p>`;
  }
}

function openProfile(personId) {
  openProfileId = personId;
  renderProfile(personId);
  document.getElementById("profile-overlay").hidden = false;
  document.body.classList.add("profile-open");
}

function closeProfile() {
  openProfileId = null;
  document.body.classList.remove("profile-open");
  document.getElementById("profile-overlay").hidden = true;
}

// ============================================================
// RENDER: 1) Mọi người & chế độ + Sổ nợ chung
// ============================================================
function renderModePanel(person, mode) {
  if (mode === "normal") return "";
  const isExam = mode === "exam";
  const desc = isExam
    ? `Trong thời gian ôn thi, ${person.name} chỉ cần đảm nhận một phần nhỏ — phần còn lại ${otherNames(person.id)} sẽ chia nhau gánh đỡ. Hệ thống sẽ ghi nợ đúng số tuần khai báo.`
    : `${person.name} đang rảnh, có thể nhận thêm việc (gợi ý 50–70%) — phần làm dư sẽ được ghi công để bù vào những lúc cả nhà thiếu hụt sau này.`;

  return `
    <div class="mode-panel ${mode}">
      <p style="margin:0 0 8px;">${desc}</p>
      <div class="field-row">
        <label for="mp-percent">${isExam ? "Chỉ làm khoảng (%)" : "Nhận thêm tới (%)"}</label>
        <input type="number" id="mp-percent" min="${isExam ? 0 : 34}" max="${isExam ? 33 : 100}" value="${isExam ? 10 : 60}">
      </div>
      <div class="field-row">
        <label for="mp-weeks">Áp dụng trong (tuần)</label>
        <input type="number" id="mp-weeks" min="1" max="12" value="1">
      </div>
      <button type="button" class="btn-apply" data-action="apply-mode" data-person="${person.id}" data-mode="${mode}">
        Kích hoạt &amp; ghi nhận
      </button>
    </div>
  `;
}

function renderPeople() {
  const wrap = document.getElementById("people-grid");
  const modeLabel = { normal: "Bình thường", exam: "📚 Đang ôn thi", free: "🌿 Đang rảnh" };

  wrap.innerHTML = state.people.map(p => {
    const fair = (state.shares[p.id] && state.shares[p.id].percent) || 0;

    let statusLine;
    if (p.mode === "exam" && p.modeDetail) {
      statusLine = `Đang nhận khoảng <strong>${p.modeDetail.percent}%</strong> khối lượng trong <strong>${p.modeDetail.weeks} tuần</strong> — phần còn lại do ${otherNames(p.id)} chia nhau gánh.`;
    } else if (p.mode === "free" && p.modeDetail) {
      statusLine = `Nhận thêm tới <strong>${p.modeDetail.percent}%</strong> khối lượng trong <strong>${p.modeDetail.weeks} tuần</strong> — phần dư dùng để bù nợ chung.`;
    } else {
      statusLine = `Theo lịch bình thường — khoảng <strong>${fair.toFixed(1)}%</strong> khối lượng/tuần.`;
    }

    const panel = (openModePanel && openModePanel.personId === p.id)
      ? renderModePanel(p, openModePanel.mode)
      : "";

    return `
      <div class="person-card" style="--p-color:${p.color}" data-action="open-profile" data-person="${p.id}">
        <div class="person-head">
          <div class="person-head-left">
            ${avatarHTML(p, "md")}
            <span class="person-name">${p.name}</span>
          </div>
          <span class="mode-badge ${p.mode}">${modeLabel[p.mode]}</span>
        </div>
        <p class="person-open-hint">👆 Bấm để xem hôm nay/tuần này đã làm bao nhiêu % &amp; lời khuyên từ Tuyết AI</p>
        <div class="mode-buttons">
          <button data-action="mode" data-person="${p.id}" data-mode="normal" class="${p.mode === "normal" ? "active normal" : ""}">Bình thường</button>
          <button data-action="mode" data-person="${p.id}" data-mode="exam"   class="${p.mode === "exam"   ? "active exam"   : ""}">📚 Bận thi</button>
          <button data-action="mode" data-person="${p.id}" data-mode="free"   class="${p.mode === "free"   ? "active free"   : ""}">🌿 Đang rảnh</button>
        </div>
        ${panel}
        <p class="person-status">${statusLine}</p>
      </div>
    `;
  }).join("");
}

function renderLedger() {
  const wrap = document.getElementById("ledger");
  wrap.innerHTML = state.people.map(p => {
    const bal = p.balanceWeeks;
    let cls = "even", note = "Đang cân bằng — không nợ, không dư.";
    if (bal > 0.05)       { cls = "credit"; note = "Đã làm dư so với phần của mình — sẽ được tính bù khi cần."; }
    else if (bal < -0.05) { cls = "debt";   note = "Đang nợ phần việc — sẽ được bù dần ở những tuần sau."; }
    return `
      <div class="ledger-row ${cls}">
        <div class="l-name">${avatarHTML(p, "sm")} ${p.name}</div>
        <div class="l-balance">${bal > 0 ? "+" : ""}${bal.toFixed(2)} tuần</div>
        <div class="l-note">${note}</div>
      </div>
    `;
  }).join("");
}

// ============================================================
// RENDER: 2) Danh sách đầu việc (thêm / sửa / xoá)
// ============================================================
function renderTaskList() {
  const wrap = document.getElementById("task-list");
  if (state.tasks.length === 0) {
    wrap.innerHTML = `<p class="hint">Chưa có việc nào — bấm "Thêm việc nhà" bên dưới để bắt đầu nhé.</p>`;
    return;
  }
  wrap.innerHTML = state.tasks.map(t => {
    const person = personById(t.personId);
    const block = BLOCKS.find(b => b.id === t.block);
    return `
      <div class="task-item">
        <span class="t-dot" style="background:${person ? person.color : "#ccc"}"></span>
        <div class="t-main">
          <div class="t-name">${t.name}</div>
          <div class="t-meta">${WEIGHT_LABELS[t.weight] || (t.weight + "đ")} · ${block ? block.label : ""} · ${fmtDays(t.days)} · ${person ? person.name : "—"}</div>
        </div>
        <div class="t-actions">
          <button data-action="edit-task" data-task="${t.id}">Sửa</button>
          <button class="danger" data-action="delete-task" data-task="${t.id}">Xoá</button>
        </div>
      </div>
    `;
  }).join("");
}

// ============================================================
// RENDER: 3) Thanh % khối lượng (server tính sẵn từ danh sách việc hiện tại)
// ============================================================
function renderPercentBars() {
  const donuts = document.getElementById("percent-donuts");
  const bars = document.getElementById("percent-bars");
  const legend = document.getElementById("percent-legend");

  donuts.innerHTML = state.people.map(p => {
    const pct = (state.shares[p.id] && state.shares[p.id].percent) || 0;
    return `
      <div class="percent-donut-card">
        ${donutHTML({ percent: pct, color: p.color, caption: "khối lượng" })}
        <div class="percent-donut-name">${avatarHTML(p, "sm")} ${p.name}</div>
      </div>
    `;
  }).join("");

  bars.innerHTML = state.people.map(p => {
    const pct = (state.shares[p.id] && state.shares[p.id].percent) || 0;
    return `
      <div class="bar-row">
        <div class="bar-name">${p.name}</div>
        <div class="bar-track">
          <div class="bar-fill" style="width:${pct}%; background:${p.color};">${pct.toFixed(1)}%</div>
        </div>
        <div class="bar-pct">${pct.toFixed(1)}%</div>
      </div>
    `;
  }).join("");

  legend.innerHTML = state.people.map(p =>
    `<span><span class="dot" style="background:${p.color}"></span>${p.name}</span>`
  ).join("");
}

// ============================================================
// RENDER: 4) Lịch tuần này — theo ngày thực tế, có thể đánh dấu "đã xong"
// ============================================================
function renderSchedule() {
  const table = document.getElementById("schedule-table");
  if (state.weekDates.length === 0) { table.innerHTML = ""; return; }

  const head = `<tr><th>Ngày</th>${BLOCKS.map(b => `<th>${b.label}</th>`).join("")}</tr>`;

  const rows = state.weekDates.map((dateStr, dayIdx) => {
    const cells = BLOCKS.map(block => {
      const tasks = state.tasks.filter(t => t.block === block.id && t.days.includes(dayIdx));
      if (tasks.length === 0) return `<td></td>`;
      const chips = tasks.map(t => {
        const person = personById(t.personId);
        const color = person ? person.color : "#ccc";
        const doneBy = state.completions[dateStr] && state.completions[dateStr][t.id];
        const done = !!doneBy;
        const doer = done ? personById(doneBy) : null;
        const pickerOpen = !!(doerPickerFor && doerPickerFor.date === dateStr && doerPickerFor.taskId === t.id);

        // Nếu người THỰC SỰ làm khác với người phụ trách mặc định -> gắn thêm
        // avatar nhỏ của người đó để biết ngay "ai đã giúp việc này".
        const helperBadge = (done && doer && doer.id !== t.personId)
          ? `<span class="doer-badge" title="${doer.name} đã làm việc này">${avatarHTML(doer, "sm")}</span>`
          : "";

        const picker = pickerOpen ? `
          <div class="doer-picker">
            <span class="doer-picker-title">Ai đã làm việc này?</span>
            <div class="doer-picker-options">
              ${state.people.map(p => `
                <button type="button" class="doer-pick-btn ${p.id === t.personId ? "suggested" : ""}"
                  data-action="pick-doer" data-date="${dateStr}" data-task="${t.id}" data-person="${p.id}">
                  ${avatarHTML(p, "sm")}
                  <span>${p.name}${p.id === t.personId ? " (phụ trách)" : ""}</span>
                </button>
              `).join("")}
            </div>
            <button type="button" class="doer-picker-cancel" data-action="cancel-pick-doer">Huỷ</button>
          </div>
        ` : "";

        return `
          <div class="task-chip ${pickerOpen ? "picking" : ""}" style="background:${color}">
            <span class="task-name">${t.name}</span>
            <span class="person-name">${person ? person.name : "—"}</span>
            ${helperBadge}
            <button type="button" class="cross-btn ${done ? "done" : ""}" style="--cross-color:${color}"
              data-action="toggle-done" data-date="${dateStr}" data-task="${t.id}"
              title="${done ? `Đã xong${doer ? " — " + doer.name : ""} — bấm để bỏ đánh dấu` : "Bấm để đánh dấu đã xong"}">${done ? "✓" : ""}</button>
            ${picker}
          </div>
        `;
      }).join("");
      return `<td>${chips}</td>`;
    }).join("");
    return `<tr><td class="day-cell">${DAY_FULL[dayIdx]}<br><span class="day-date">${fmtDateLabel(dateStr)}</span></td>${cells}</tr>`;
  }).join("");

  table.innerHTML = head + rows;
}

function renderAll() {
  renderPeople();
  renderLedger();
  renderTaskList();
  renderPercentBars();
  renderSchedule();
  if (openProfileId) renderProfile(openProfileId);
}

// ============================================================
// FORM THÊM / SỬA VIỆC
// ============================================================
const taskForm = document.getElementById("task-form");
const showFormBtn = document.getElementById("btn-show-form");

function populateDayChecks(selectedDays) {
  const wrap = document.getElementById("f-days");
  wrap.innerHTML = DAY_FULL.map((_, idx) => `
    <label><input type="checkbox" value="${idx}" ${selectedDays.includes(idx) ? "checked" : ""}> ${DAY_SHORT[idx]}</label>
  `).join("");
}

function populatePersonSelect(selectedId) {
  const sel = document.getElementById("f-person");
  sel.innerHTML = state.people.map(p =>
    `<option value="${p.id}" ${p.id === selectedId ? "selected" : ""}>${p.name}</option>`
  ).join("");
}

function openTaskForm(taskId) {
  if (state.people.length === 0) {
    alert("Dữ liệu đang tải, vui lòng đợi một chút rồi thử lại nhé.");
    return;
  }
  editingTaskId = taskId;
  const title = document.getElementById("task-form-title");
  const submitBtn = document.getElementById("f-submit");

  if (taskId) {
    const t = state.tasks.find(x => x.id === taskId);
    title.textContent = "Sửa việc nhà";
    submitBtn.textContent = "Lưu thay đổi";
    document.getElementById("f-task-id").value = t.id;
    document.getElementById("f-name").value = t.name;
    document.getElementById("f-weight").value = String(t.weight);
    document.getElementById("f-block").value = t.block;
    populateDayChecks(t.days);
    populatePersonSelect(t.personId);
  } else {
    title.textContent = "Thêm việc mới";
    submitBtn.textContent = "Thêm việc";
    document.getElementById("f-task-id").value = "";
    document.getElementById("f-name").value = "";
    document.getElementById("f-weight").value = "1";
    document.getElementById("f-block").value = "morning";
    populateDayChecks([0,1,2,3,4,5,6]);
    populatePersonSelect(state.people[0] ? state.people[0].id : "");
  }

  taskForm.hidden = false;
  showFormBtn.hidden = true;
  document.getElementById("f-name").focus();
}

function closeTaskForm() {
  editingTaskId = null;
  taskForm.hidden = true;
  showFormBtn.hidden = false;
  taskForm.reset();
}

async function submitTaskForm() {
  const name = document.getElementById("f-name").value.trim();
  const weight = Number(document.getElementById("f-weight").value);
  const block = document.getElementById("f-block").value;
  const personId = document.getElementById("f-person").value;
  const days = Array.from(document.querySelectorAll("#f-days input:checked")).map(i => Number(i.value));

  if (!name) return;
  if (days.length === 0) { alert("Chọn ít nhất một ngày trong tuần nhé."); return; }

  const payload = { name, weight, block, personId, days };
  try {
    if (editingTaskId) {
      await api(`/api/tasks/${editingTaskId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } else {
      await api("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }
    closeTaskForm();
    await refresh();
  } catch (err) {
    alert("Không lưu được: " + err.message);
  }
}

const aiFab = document.getElementById("ai-fab");
aiFab.addEventListener("click", openAiChat);
document.getElementById("ai-popup-close").addEventListener("click", closeAiChat);
document.getElementById("ai-popup").addEventListener("click", e => {
  if (e.target.id === "ai-popup") closeAiChat();
});

document.getElementById("profile-close").addEventListener("click", closeProfile);
document.getElementById("profile-overlay").addEventListener("click", e => {
  if (e.target.id === "profile-overlay") closeProfile();
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    if (aiPopupOpen) closeAiChat();
    else if (openProfileId) closeProfile();
  }
});

showFormBtn.addEventListener("click", () => openTaskForm(null));
document.getElementById("f-cancel").addEventListener("click", closeTaskForm);
taskForm.addEventListener("submit", e => { e.preventDefault(); submitTaskForm(); });

// ============================================================
// SỰ KIỆN DÙNG CHUNG (uỷ quyền qua data-action vì DOM được render lại liên tục)
// ============================================================
document.addEventListener("click", async e => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;

  try {
    if (action === "mode") {
      const personId = btn.dataset.person;
      const mode = btn.dataset.mode;
      if (mode === "normal") {
        await api(`/api/people/${personId}/normal`, { method: "POST" });
        openModePanel = null;
        await refresh();
      } else if (openModePanel && openModePanel.personId === personId && openModePanel.mode === mode) {
        openModePanel = null;
        renderPeople();
      } else {
        openModePanel = { personId, mode };
        renderPeople();
      }
      return;
    }

    if (action === "apply-mode") {
      const personId = btn.dataset.person;
      const mode = btn.dataset.mode;
      const percent = Math.max(0, Math.min(100, Number(document.getElementById("mp-percent").value) || 0));
      const weeks = Math.max(1, Math.min(52, Number(document.getElementById("mp-weeks").value) || 1));
      await api(`/api/people/${personId}/mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, percent, weeks }),
      });
      openModePanel = null;
      await refresh();
      return;
    }

    if (action === "open-profile") { openProfile(btn.dataset.person); return; }

    if (action === "edit-task") { openTaskForm(btn.dataset.task); return; }

    if (action === "delete-task") {
      if (confirm("Xoá việc này khỏi danh sách? (cả lịch sử đánh dấu đã xong của việc này cũng sẽ mất)")) {
        await api(`/api/tasks/${btn.dataset.task}`, { method: "DELETE" });
        await refresh();
      }
      return;
    }

    if (action === "toggle-done") {
      const date = btn.dataset.date;
      const taskId = btn.dataset.task;

      if (btn.classList.contains("done")) {
        // Đang "đã xong" -> bấm lại để bỏ đánh dấu ngay, không cần chọn lại ai
        await api("/api/completions/toggle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date, taskId }),
        });
        await refresh();
        return;
      }

      // Chưa xong -> mở bảng nhỏ ngay tại chỗ để chọn AI thực sự đã làm việc này
      // (mặc định gợi ý người phụ trách, nhưng có thể chọn người khác nếu họ làm giúp).
      doerPickerFor = { date, taskId };
      renderSchedule();
      return;
    }

    if (action === "pick-doer") {
      const date = btn.dataset.date;
      const taskId = btn.dataset.task;
      const doneBy = btn.dataset.person;
      doerPickerFor = null;
      await api("/api/completions/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, taskId, doneBy }),
      });
      await refresh();
      const newBtn = document.querySelector(
        `.cross-btn[data-date="${date}"][data-task="${taskId}"]`
      );
      if (newBtn) {
        newBtn.classList.add("just-toggled");
        newBtn.addEventListener("animationend", () => newBtn.classList.remove("just-toggled"), { once: true });
      }
      return;
    }

    if (action === "cancel-pick-doer") {
      doerPickerFor = null;
      renderSchedule();
      return;
    }
  } catch (err) {
    alert("Có lỗi xảy ra: " + err.message);
  }
});

// ============================================================
// KHỞI ĐỘNG — lấy dữ liệu từ database qua server
// ============================================================
function showStartupError(message) {
  document.querySelector("main").innerHTML = `
    <section class="card">
      <h2>⚠️ Chưa kết nối được tới server</h2>
      <p>${message}</p>
      <p class="hint">
        Sau khi chạy <code>node server.js</code>, bạn cần mở trang qua địa chỉ:<br>
        👉 <strong>http://localhost:3000</strong><br>
        (chứ không phải mở trực tiếp file <code>index.html</code> bằng cách bấm đúp vào nó —
        cách đó trình duyệt sẽ không gọi được tới server/database).
      </p>
    </section>
  `;
  setFooterStatus(message, true);
}

if (location.protocol === "file:") {
  // Trang đang được mở trực tiếp từ file (vd: bấm đúp index.html) — fetch tới /api/... sẽ luôn lỗi.
  showStartupError(
    `Trang này đang được mở trực tiếp từ ổ đĩa (đường dẫn bắt đầu bằng "file://"), nên không gọi được tới server/database.`
  );
} else {
  showSkeletons();
  refresh().catch(err => {
    showStartupError(`Không gọi được API (${err.message}). Server có thể chưa chạy — hãy mở terminal tại thư mục dự án và chạy "node server.js".`);
  });
}
