// ============================================================
// Server tối giản cho "Lịch việc nhà" — chỉ dùng module có sẵn của Node
// (http + node:sqlite), không cần npm install gì thêm.
//
// Chạy:  node server.js
// Mở:    http://localhost:3000
//
// Dữ liệu được lưu trong file housework.db (SQLite) ngay cạnh file này —
// đóng trình duyệt / tắt máy / mở lại đều còn nguyên.
// ============================================================
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");

const PORT = process.env.PORT || 3000;
// Khi deploy lên Railway: gắn một Volume rồi đặt biến môi trường DATA_DIR
// trỏ tới thư mục mount đó (vd: /data) để file database không bị mất khi
// app khởi động lại / deploy lại. Chạy local thì để mặc định (cạnh server.js).
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DB_PATH = path.join(DATA_DIR, "housework.db");
const db = new DatabaseSync(DB_PATH);

// ------------------------------------------------------------
// Khởi tạo schema + dữ liệu mặc định (chạy 1 lần khi DB còn trống)
// ------------------------------------------------------------
function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS people (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'normal',
      mode_percent REAL,
      mode_weeks INTEGER,
      balance_weeks REAL NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      weight INTEGER NOT NULL,
      block TEXT NOT NULL,
      days TEXT NOT NULL,
      person_id TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS completions (
      date TEXT NOT NULL,
      task_id TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (date, task_id)
    );
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  const peopleCount = db.prepare("SELECT COUNT(*) AS c FROM people").get().c;
  if (peopleCount === 0) seedDefaults();
}

function seedDefaults() {
  const insertPerson = db.prepare(
    "INSERT INTO people (id, name, color, mode, balance_weeks, sort_order) VALUES (?, ?, ?, 'normal', 0, ?)"
  );
  insertPerson.run("nam", "Chị Nấm", "#ff8fa3", 0);
  insertPerson.run("su", "Su", "#6fb1fc", 1);
  insertPerson.run("xoai", "Em Xoài", "#ffc966", 2);

  const insertTask = db.prepare(
    "INSERT INTO tasks (id, name, weight, block, days, person_id) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const allDays = JSON.stringify([0, 1, 2, 3, 4, 5, 6]);
  insertTask.run("t_bo", "Bỏ áo quần (vào máy giặt)", 1, "morning", allDays, "xoai");
  insertTask.run("t_giat", "Giặt áo quần", 1, "morning", allDays, "xoai");
  insertTask.run("t_phoi", "Phơi áo quần", 2, "morning", allDays, "su");
  insertTask.run("t_nau", "Nấu ăn", 4, "afternoon", allDays, "nam");
  insertTask.run("t_rua", "Rửa chén", 2, "afternoon", allDays, "xoai");
  insertTask.run("t_xep", "Xếp áo quần (đồ đã khô)", 2, "evening", allDays, "su");

  db.prepare("INSERT INTO meta (key, value) VALUES ('last_reset_week', ?)").run(mondayIso(new Date()));
}

initDb();

// ------------------------------------------------------------
// Tiện ích ngày tháng (tuần bắt đầu từ Thứ 2)
// ------------------------------------------------------------
function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function mondayOf(d) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay(); // 0 = CN ... 6 = T7
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date;
}
function mondayIso(d) { return isoDate(mondayOf(d)); }
function weekDates(mondayDate) {
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(mondayDate);
    d.setDate(d.getDate() + i);
    dates.push(isoDate(d));
  }
  return dates;
}

// Mỗi khi có người mở app: nếu đã sang tuần mới (qua Thứ 2) thì tự đưa
// mọi người về "Bình thường" — KHÔNG đụng tới sổ nợ (balance_weeks),
// vì đó là lịch sử tích luỹ cần giữ lại để bù trừ dần.
function maybeResetWeek() {
  const currentMonday = mondayIso(new Date());
  const row = db.prepare("SELECT value FROM meta WHERE key = 'last_reset_week'").get();
  if (!row || row.value !== currentMonday) {
    db.exec("UPDATE people SET mode = 'normal', mode_percent = NULL, mode_weeks = NULL");
    db.prepare(
      "INSERT INTO meta (key, value) VALUES ('last_reset_week', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).run(currentMonday);
  }
  return currentMonday;
}

// ------------------------------------------------------------
// Tính % khối lượng việc của mỗi người dựa trên danh sách việc hiện tại
// ------------------------------------------------------------
function computeShares() {
  const people = db.prepare("SELECT id FROM people ORDER BY sort_order").all();
  const tasks = db.prepare("SELECT weight, days, person_id FROM tasks").all();

  const totals = {};
  people.forEach(p => { totals[p.id] = 0; });

  let grand = 0;
  tasks.forEach(t => {
    const days = JSON.parse(t.days);
    const w = t.weight * days.length;
    totals[t.person_id] = (totals[t.person_id] || 0) + w;
    grand += w;
  });

  const result = {};
  people.forEach(p => {
    const w = totals[p.id] || 0;
    result[p.id] = { weight: w, percent: grand > 0 ? (w / grand) * 100 : 0 };
  });
  return result;
}

// ------------------------------------------------------------
// Chế độ Bận thi / Đang rảnh — ghi nợ & ghi dư vào sổ chung (balance_weeks)
//
// 1 "tuần" = làm đúng phần việc bình thường (fair share) của mình trong 1 tuần.
// Lệch đi (X% thay vì F% trong N tuần) -> (X - F)/F * N "tuần", và phần lệch
// luôn được 2 người còn lại gánh/đỡ ngược lại (chia đều) -> tổng sổ nợ = 0.
// ------------------------------------------------------------
function activateMode(personId, mode, percent, weeks) {
  const person = db.prepare("SELECT id FROM people WHERE id = ?").get(personId);
  if (!person) throw new Error("Không tìm thấy người này");
  if (mode !== "exam" && mode !== "free") throw new Error("Chế độ không hợp lệ");

  const shares = computeShares();
  const fairShare = shares[personId].percent || (100 / 3);
  const change = ((percent - fairShare) / fairShare) * weeks;

  db.prepare(
    "UPDATE people SET mode = ?, mode_percent = ?, mode_weeks = ?, balance_weeks = balance_weeks + ? WHERE id = ?"
  ).run(mode, percent, weeks, change, personId);

  const others = db.prepare("SELECT id FROM people WHERE id != ?").all(personId);
  const eachShare = (-change) / others.length;
  others.forEach(o => {
    db.prepare("UPDATE people SET balance_weeks = balance_weeks + ? WHERE id = ?").run(eachShare, o.id);
  });
}

function setNormalMode(personId) {
  db.prepare("UPDATE people SET mode = 'normal', mode_percent = NULL, mode_weeks = NULL WHERE id = ?").run(personId);
}

// ------------------------------------------------------------
// CRUD việc nhà
// ------------------------------------------------------------
function createTask({ name, weight, block, days, personId }) {
  validateTaskInput({ name, weight, block, days, personId });
  const id = "t_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  db.prepare("INSERT INTO tasks (id, name, weight, block, days, person_id) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, name, weight, block, JSON.stringify(days), personId);
}
function updateTask(id, { name, weight, block, days, personId }) {
  validateTaskInput({ name, weight, block, days, personId });
  db.prepare("UPDATE tasks SET name = ?, weight = ?, block = ?, days = ?, person_id = ? WHERE id = ?")
    .run(name, weight, block, JSON.stringify(days), personId, id);
}
function deleteTask(id) {
  db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
  db.prepare("DELETE FROM completions WHERE task_id = ?").run(id);
}
function validateTaskInput({ name, weight, block, days, personId }) {
  if (!name || typeof name !== "string" || !name.trim()) throw new Error("Thiếu tên việc");
  if (![1, 2, 4].includes(Number(weight))) throw new Error("Độ mệt không hợp lệ");
  if (!["morning", "afternoon", "evening"].includes(block)) throw new Error("Buổi không hợp lệ");
  if (!Array.isArray(days) || days.length === 0 || days.some(d => !Number.isInteger(d) || d < 0 || d > 6)) {
    throw new Error("Ngày trong tuần không hợp lệ");
  }
  if (!db.prepare("SELECT 1 FROM people WHERE id = ?").get(personId)) throw new Error("Người phụ trách không hợp lệ");
}

function toggleCompletion(date, taskId) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) throw new Error("Ngày không hợp lệ");
  if (!db.prepare("SELECT 1 FROM tasks WHERE id = ?").get(taskId)) throw new Error("Việc không tồn tại");
  const row = db.prepare("SELECT done FROM completions WHERE date = ? AND task_id = ?").get(date, taskId);
  if (row) {
    db.prepare("UPDATE completions SET done = ? WHERE date = ? AND task_id = ?").run(row.done ? 0 : 1, date, taskId);
  } else {
    db.prepare("INSERT INTO completions (date, task_id, done) VALUES (?, ?, 1)").run(date, taskId);
  }
}

// ------------------------------------------------------------
// Gói toàn bộ state trả về cho frontend
// ------------------------------------------------------------
function getFullState() {
  const currentMonday = maybeResetWeek();
  const days = weekDates(new Date(currentMonday + "T00:00:00"));

  const people = db.prepare("SELECT * FROM people ORDER BY sort_order").all().map(p => ({
    id: p.id,
    name: p.name,
    color: p.color,
    mode: p.mode,
    modeDetail: p.mode === "normal" ? null : { percent: p.mode_percent, weeks: p.mode_weeks },
    balanceWeeks: p.balance_weeks,
  }));

  const tasks = db.prepare("SELECT * FROM tasks").all().map(t => ({
    id: t.id,
    name: t.name,
    weight: t.weight,
    block: t.block,
    days: JSON.parse(t.days),
    personId: t.person_id,
  }));

  const placeholders = days.map(() => "?").join(",");
  const completionRows = db
    .prepare(`SELECT date, task_id, done FROM completions WHERE date IN (${placeholders})`)
    .all(...days);
  const completions = {};
  completionRows.forEach(r => {
    if (!completions[r.date]) completions[r.date] = {};
    completions[r.date][r.task_id] = !!r.done;
  });

  return { people, tasks, completions, weekStart: currentMonday, weekDates: days, shares: computeShares() };
}

// ------------------------------------------------------------
// HTTP server: phục vụ file tĩnh + API JSON
// ------------------------------------------------------------
const STATIC_FILES = {
  "/": "index.html",
  "/index.html": "index.html",
  "/style.css": "style.css",
  "/script.js": "script.js",
};
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(new Error("JSON gửi lên không hợp lệ")); }
    });
    req.on("error", reject);
  });
}

function serveStatic(res, pathname) {
  const file = STATIC_FILES[pathname];
  if (!file) { res.writeHead(404); res.end("Not found"); return; }
  const filePath = path.join(__dirname, file);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}

async function handleApi(req, res, pathname) {
  let m;
  try {
    if (req.method === "GET" && pathname === "/api/state") {
      return sendJson(res, 200, getFullState());
    }

    if (req.method === "POST" && (m = pathname.match(/^\/api\/people\/([^/]+)\/mode$/))) {
      const body = await readJsonBody(req);
      activateMode(m[1], body.mode, Number(body.percent), Number(body.weeks));
      return sendJson(res, 200, getFullState());
    }

    if (req.method === "POST" && (m = pathname.match(/^\/api\/people\/([^/]+)\/normal$/))) {
      setNormalMode(m[1]);
      return sendJson(res, 200, getFullState());
    }

    if (req.method === "POST" && pathname === "/api/tasks") {
      const body = await readJsonBody(req);
      createTask(body);
      return sendJson(res, 200, getFullState());
    }

    if (req.method === "PUT" && (m = pathname.match(/^\/api\/tasks\/([^/]+)$/))) {
      const body = await readJsonBody(req);
      updateTask(m[1], body);
      return sendJson(res, 200, getFullState());
    }

    if (req.method === "DELETE" && (m = pathname.match(/^\/api\/tasks\/([^/]+)$/))) {
      deleteTask(m[1]);
      return sendJson(res, 200, getFullState());
    }

    if (req.method === "POST" && pathname === "/api/completions/toggle") {
      const body = await readJsonBody(req);
      toggleCompletion(body.date, body.taskId);
      return sendJson(res, 200, getFullState());
    }

    sendJson(res, 404, { error: "Không tìm thấy đường dẫn API này" });
  } catch (err) {
    sendJson(res, 400, { error: err.message });
  }
}

const server = http.createServer((req, res) => {
  const pathname = (req.url || "/").split("?")[0];
  if (pathname.startsWith("/api/")) {
    handleApi(req, res, pathname);
  } else {
    serveStatic(res, pathname);
  }
});

server.listen(PORT, () => {
  console.log(`✅ Lịch việc nhà đang chạy tại http://localhost:${PORT}`);
  console.log(`   Dữ liệu lưu tại: ${DB_PATH}`);
});
