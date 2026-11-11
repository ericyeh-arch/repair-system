# 維修網站使用說明

入口檔案：`index.html`

前端為純 HTML/CSS/JS（無建置步驟），資料庫使用 **Supabase**（PostgreSQL），透過 `@supabase/supabase-js`（CDN 載入）直接存取，權限由 Row Level Security (RLS) 控管。

## 檔案

| 檔案 | 說明 |
|---|---|
| `index.html` / `styles.css` / `app.js` | 前端頁面與邏輯 |
| `supabase-config.js` | Supabase Project URL 與 anon key（需自行填寫） |
| `repair_schema_supabase.sql` | Supabase 資料表、RLS、View、RPC 與種子資料 |
| `maintenance_website_spec.md` | 網站規格書 |
| `repair_schema.sql` | 舊版 MySQL schema，已由 Supabase 版取代 |

## 建置步驟

1. 在 [Supabase](https://supabase.com) 建立專案。
2. 到 SQL Editor 貼上並執行 `repair_schema_supabase.sql`。
3. 將 `supabase-config.js` 的 `SUPABASE_URL`、`SUPABASE_ANON_KEY` 改為專案值（Project Settings > API）。**不得放入 `service_role` key。**
4. 到 Authentication > Users 建立維修人員帳號，再於 SQL Editor 授予角色：

   ```sql
   insert into staff_profiles (user_id, display_name, role)
   values ('<auth user uuid>', '陳', 'admin');  -- role: 'technician' 或 'admin'
   ```

5. 用瀏覽器開啟 `index.html`，或以任何靜態主機（GitHub Pages、Netlify 等）部署。

## 頁面

- **線上報修**：必填驗證，問題描述至少 10 字；送出呼叫 RPC `submit_repair_request`，成功後顯示報修編號。
- **進度查詢**：只讀 `v_public_repair_requests`，支援關鍵字（編號、位置、問題描述、處理說明）與狀態篩選，最新案件在前。
- **處理後台**：需以維修人員帳號登入。可更新公開處理說明、內部備註、維修人員、狀態與是否公開；結案前必須填公開處理說明。狀態或說明變更時，資料庫 trigger 會自動寫入 `repair_request_logs`。
- **資料庫欄位**：顯示主表欄位、型別與公開性。

## 資料庫物件

- 資料表：`repair_requests`、`departments`、`issue_types`、`buildings`、`repair_statuses`、`repair_request_logs`、`staff_profiles`
- View：`v_public_repair_requests`（公開查詢唯一入口，不含個資）
- RPC：`submit_repair_request`（匿名送單，僅回傳編號）
- 函式：`is_staff()`、`is_admin()`（供 RLS 使用）

## 權限模型

| 角色 | 可做的事 |
|---|---|
| 匿名訪客 | 讀代碼表、讀公開 View、呼叫 `submit_repair_request` |
| 維修人員 (`technician`) | 讀寫案件、新增處理紀錄 |
| 管理者 (`admin`) | 維修人員權限，加上管理代碼表、`staff_profiles` 與刪除案件 |

匿名角色無法直接讀寫 `repair_requests`。

## 個資注意

公開頁不可輸出：

- `requester_email`
- `requester_name`
- `line_id`
- `private_note`

`repair_location` 與 `issue_description` 可能被使用者填入電話、Email 或 LINE ID，正式公開前建議做遮罩或人工檢查（後台可取消勾選「公開於進度查詢」）。

## 尚未包含

- Email / LINE 通知
- 匿名送單的防濫用機制（建議加 Cloudflare Turnstile 或 CAPTCHA）
- Google Sheets 舊資料匯入工具
