-- 線上電腦及網路報修系統 Supabase (PostgreSQL 15) 資料庫規格
-- 於 Supabase Dashboard > SQL Editor 執行。

-- ========== 共用 ==========
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ========== 代碼表 ==========
create table departments (
  id bigint generated always as identity primary key,
  name text not null unique,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table issue_types (like departments including all);
create table buildings   (like departments including all);

create table repair_statuses (
  id bigint generated always as identity primary key,
  code text not null unique,
  label text not null unique,
  sort_order int not null default 0,
  is_closed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ========== 維修人員 / 管理者 ==========
create table staff_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null check (role in ('technician', 'admin')),
  created_at timestamptz not null default now()
);

create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff_profiles where user_id = auth.uid());
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff_profiles where user_id = auth.uid() and role = 'admin');
$$;

-- ========== 主表 ==========
create table repair_requests (
  id bigint generated always as identity primary key,
  source_response_id text unique,
  submitted_at timestamptz not null default now(),
  requester_email text not null,
  department_id bigint not null references departments(id),
  requester_name text not null,
  line_id text not null,
  preferred_repair_date date not null,
  issue_type_id bigint not null references issue_types(id),
  building_id bigint not null references buildings(id),
  repair_location text not null,
  issue_description text not null check (char_length(issue_description) >= 10),
  public_response text,
  assignee_name text,
  status_id bigint references repair_statuses(id),
  private_note text,
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_rr_submitted_at on repair_requests (submitted_at desc);
create index idx_rr_preferred_date on repair_requests (preferred_repair_date);
create index idx_rr_department on repair_requests (department_id);
create index idx_rr_issue_type on repair_requests (issue_type_id);
create index idx_rr_building on repair_requests (building_id);
create index idx_rr_status on repair_requests (status_id);
create index idx_rr_public_status_time on repair_requests (is_public, status_id, submitted_at desc);

create trigger trg_rr_updated_at before update on repair_requests
  for each row execute function set_updated_at();

-- ========== 處理紀錄 ==========
create table repair_request_logs (
  id bigint generated always as identity primary key,
  repair_request_id bigint not null references repair_requests(id) on delete cascade,
  status_id bigint references repair_statuses(id),
  handler_name text,
  public_note text,
  private_note text,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
create index idx_rrl_request on repair_request_logs (repair_request_id);

-- 案件狀態或說明變更時自動寫入歷程
create or replace function log_repair_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.status_id is distinct from old.status_id)
     or (new.public_response is distinct from old.public_response)
     or (new.assignee_name is distinct from old.assignee_name)
     or (new.private_note is distinct from old.private_note) then
    insert into repair_request_logs
      (repair_request_id, status_id, handler_name, public_note, private_note)
    values
      (new.id, new.status_id, new.assignee_name, new.public_response, new.private_note);
  end if;
  return new;
end $$;

create trigger trg_rr_log after update on repair_requests
  for each row execute function log_repair_change();

-- ========== 種子資料 ==========
insert into departments (name, sort_order) values
('其他單位',10),('副校長室/副校長室',20),('秘書室',30),('人事室',40),('主計室',50),
('教務處',60),('學生事務處',70),('總務處',80),('研究發展處',90),('資訊中心',100),
('圖書暨體育博物館',110),('體育處',120),('運動訓練科學暨大數據中心',130),('體育學院',140),
('競技學院',150),('運動與健康科學學院',160),('管理學院',170),('通識教育中心',180),
('師資培育中心',190),('進修推廣部',200);

insert into issue_types (name, sort_order) values
('宿舍網路',10),('無線網路',20),('電腦網路',30),('電腦問題',40),
('印表機問題',50),('軟體問題',60),('郵件帳號問題',70),('其他問題',80);

insert into buildings (name, sort_order) values
('行政大樓',10),('科技大樓',20),('教學大樓',30),('學生宿舍',40),('棒球場',50),
('田徑場',60),('游泳池',70),('體育館',80),('其他場館',90);

insert into repair_statuses (code, label, sort_order, is_closed) values
('acknowledged','瞭解問題',10,false),
('processing','正在處理',20,false),
('closed','己經結案',30,true);

-- ========== 公開 View（不含個資） ==========
-- 以 view owner 權限執行，讓 anon 只能讀到 view 內的欄位，而不能讀主表。
create or replace view v_public_repair_requests as
select
  rr.id, rr.submitted_at,
  d.name  as department_name,
  rr.preferred_repair_date,
  it.name as issue_type_name,
  b.name  as building_name,
  rr.repair_location, rr.issue_description, rr.public_response,
  rr.assignee_name,
  rs.label as status_label,
  rr.updated_at
from repair_requests rr
join departments d  on d.id  = rr.department_id
join issue_types it on it.id = rr.issue_type_id
join buildings b    on b.id  = rr.building_id
left join repair_statuses rs on rs.id = rr.status_id
where rr.is_public;

-- ========== 公開報修 RPC（匿名送單，僅回傳編號） ==========
create or replace function submit_repair_request(
  p_requester_email text, p_department_id bigint, p_requester_name text,
  p_line_id text, p_preferred_repair_date date, p_issue_type_id bigint,
  p_building_id bigint, p_repair_location text, p_issue_description text
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
  v_status bigint;
begin
  if p_requester_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid email';
  end if;
  select id into v_status from repair_statuses order by sort_order limit 1;
  insert into repair_requests
    (requester_email, department_id, requester_name, line_id, preferred_repair_date,
     issue_type_id, building_id, repair_location, issue_description, status_id)
  values
    (trim(p_requester_email), p_department_id, trim(p_requester_name), trim(p_line_id),
     p_preferred_repair_date, p_issue_type_id, p_building_id,
     trim(p_repair_location), trim(p_issue_description), v_status)
  returning id into v_id;
  return v_id;
end $$;

-- ========== Row Level Security ==========
alter table departments          enable row level security;
alter table issue_types          enable row level security;
alter table buildings            enable row level security;
alter table repair_statuses      enable row level security;
alter table repair_requests      enable row level security;
alter table repair_request_logs  enable row level security;
alter table staff_profiles       enable row level security;

-- 代碼表：所有人可讀，僅管理者可寫
do $$
declare t text;
begin
  foreach t in array array['departments','issue_types','buildings','repair_statuses'] loop
    execute format('create policy "%1$s_read" on %1$s for select using (true)', t);
    execute format('create policy "%1$s_admin_write" on %1$s for all to authenticated using (is_admin()) with check (is_admin())', t);
  end loop;
end $$;

-- 主表：僅 staff 可讀寫（匿名一律透過 RPC / View）
create policy rr_staff_select on repair_requests for select to authenticated using (is_staff());
create policy rr_staff_update on repair_requests for update to authenticated using (is_staff()) with check (is_staff());
create policy rr_admin_delete on repair_requests for delete to authenticated using (is_admin());

create policy rrl_staff_select on repair_request_logs for select to authenticated using (is_staff());
create policy rrl_staff_insert on repair_request_logs for insert to authenticated with check (is_staff());

create policy staff_self_select on staff_profiles for select to authenticated using (user_id = auth.uid() or is_admin());
create policy staff_admin_write on staff_profiles for all to authenticated using (is_admin()) with check (is_admin());

-- ========== 權限 ==========
revoke all on repair_requests, repair_request_logs, staff_profiles from anon;
-- 登入角色(authenticated)的資料表權限；實際可存取範圍仍由上方 RLS policy 限制為 staff / admin
grant select, update, delete on repair_requests to authenticated;
grant select, insert on repair_request_logs to authenticated;
grant select, insert, update, delete on staff_profiles to authenticated;
grant insert, update, delete on departments, issue_types, buildings, repair_statuses to authenticated;
grant select on v_public_repair_requests to anon, authenticated;
grant select on departments, issue_types, buildings, repair_statuses to anon, authenticated;
grant execute on function submit_repair_request(text,bigint,text,text,date,bigint,bigint,text,text) to anon, authenticated;
