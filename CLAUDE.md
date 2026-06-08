# Lịch việc nhà — ghi chú dự án

App quản lý & chia việc nhà cho 3 người (chị Nấm, Su, em Xoài). Tiếng Việt là ngôn ngữ giao tiếp chính với người dùng.

## Kiến trúc — KHÔNG dùng framework / npm package nào

- Frontend: HTML/CSS/JS thuần (`index.html`, `style.css`, `script.js`) — không React/Vue, không build tool.
- Backend: `server.js` — chỉ dùng module có sẵn của Node (`node:http`, `node:sqlite` `DatabaseSync`, `node:fs`, `node:path`). Zero npm dependencies (tránh lỗi build native trên Windows).
- Database: SQLite, file `housework.db` (KHÔNG commit — đã có trong `.gitignore`). Bảng: `people`, `tasks`, `completions`, `meta`.
- Frontend gọi REST-ish JSON API (`/api/state`, `/api/people/:id/mode`, `/api/tasks`, `/api/completions/toggle`...) — xem `server.js` để biết toàn bộ route.
- State-driven rendering: `script.js` có `let state = {...}`, `refresh()` lấy `/api/state` rồi gọi `renderAll()` → các hàm `render*()`.

## Chạy local

```
node server.js
```
rồi mở **http://localhost:3000** (KHÔNG mở trực tiếp file `index.html`, KHÔNG dùng "Go Live"/Live Server của VSCode — cổng 5500 chỉ phục vụ file tĩnh, không có server/database, sẽ luôn báo lỗi 404 khi gọi `/api/...`).

## Deploy

- Repo GitHub: https://github.com/lemk207-sketch/housework (nhánh `main`)
- Hosting: **Railway** — tự động deploy lại mỗi khi push lên `main`. Domain: `viecnha-tamconuong.up.railway.app`
- Đã gắn **Volume** tại mount path `/data` + biến môi trường `DATA_DIR=/data` để file `housework.db` không mất khi redeploy (xem `server.js` dòng khai báo `DATA_DIR`/`DB_PATH`).
- Quy trình cập nhật: sửa code → `git add` / `git commit` / `git push` → Railway tự build & deploy (không cần thao tác gì thêm trên Railway). Database giữ nguyên qua mỗi lần deploy nhờ Volume.

## Các tính năng đã có

1. Phân chia việc nhà theo % dựa trên độ "mệt" (weight: 1/2/4 điểm) × số ngày/tuần — tính trong `computeShares()` (server) và hiển thị ở mục "3. Tỉ trọng".
2. Chế độ **Bận thi** (chỉ làm ~10%, ghi nợ) / **Đang rảnh** (làm thêm 50-70%, ghi dư) — `activateMode()` trong `server.js`, là một **sổ nợ khép kín** (tổng `balance_weeks` của 3 người luôn = 0).
3. **Reset hàng tuần vào thứ 2** — `maybeResetWeek()`, đưa mọi người về "Bình thường" nhưng GIỮ NGUYÊN sổ nợ.
4. **Cross đánh dấu hoàn thành** việc theo từng ngày thực tế trong tuần, màu theo người phụ trách (`--cross-color`).
5. **Hồ sơ cá nhân** (bấm vào ô của mỗi người): xem % đã hoàn thành việc được giao hôm nay / tuần này, còn cần bao nhiêu % để đủ "chỉ tiêu" (= không bị tính nợ thêm).
6. **Tuyết AI 🧊**: gợi ý theo luật (rule-based, KHÔNG gọi AI/dịch vụ ngoài) dựa trên dữ liệu thật — nói rõ còn nợ/dư bao nhiêu tuần và gợi ý cụ thể nên làm việc gì, của ai, vào ngày nào để bù. Code: `computeProgress()`, `buildAiLines()`, `renderAiBoard()`, `renderProfile()` trong `script.js`.

## Lỗi đã gặp & cách nhận diện (để tránh lặp lại)

- **"Trang trắng" / "không kết nối được server"** → 90% là do mở sai cách: hoặc mở trực tiếp file (`file://`), hoặc dùng Live Server (`127.0.0.1:5500`) thay vì `http://localhost:3000`. Luôn hỏi "bạn đang mở ở địa chỉ nào" đầu tiên.
- **CSS `display: flex` đè lên thuộc tính `hidden`**: nếu thêm overlay/modal mới, PHẢI viết `.xxx[hidden] { display: none; }` và `.xxx:not([hidden]) { display: flex; }` — KHÔNG đặt `display: flex` thẳng trên class đó, vì class selector và `[hidden]` cùng độ ưu tiên (0,1,0) và CSS tác giả thắng UA stylesheet → phần tử sẽ hiện ngay cả khi có `hidden`.
- Race-condition khi UI tương tác được trước khi `state` có dữ liệu (vd nút "+ Thêm việc" / dropdown người phụ trách trống) → luôn disable/guard cho tới khi `refresh()` xong và `state.people.length > 0`.

## Cách làm việc với người dùng

- Người dùng không rành kỹ thuật — giải thích đơn giản, từng bước, bằng tiếng Việt.
- User nói "cứ làm rồi tôi fix tiếp" → ưu tiên ra bản chạy được nhanh, không cần hoàn hảo ngay.
- Khi user báo "lỗi" mà không rõ ràng, luôn hỏi: đang mở ở URL nào, ảnh chụp màn hình, và nội dung Console (F12) nếu cần.
