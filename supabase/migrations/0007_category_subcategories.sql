-- Migration 0007: Add parent_id for category sub-categories and seed essential daily categories

alter table public.categories
  add column if not exists parent_id uuid references public.categories (id) on delete cascade;

create index if not exists categories_ledger_parent_idx
  on public.categories (ledger_id, parent_id);

-- Backfill new essential top-level daily categories for existing family ledgers
insert into public.categories (ledger_id, name, icon, sort, parent_id)
select l.id, v.name, v.icon, v.sort, null
from public.ledgers l
cross join (
  values
    ('Nhà cửa', '🏠', 4),
    ('Con cái', '👶', 5),
    ('Cá nhân & Làm đẹp', '✨', 7),
    ('Hiếu hỉ & Quà tặng', '🎁', 10)
) as v(name, icon, sort)
where l.kind = 'family'
  and not exists (
    select 1
    from public.categories c
    where c.ledger_id = l.id
      and c.parent_id is null
      and lower(c.name) = lower(v.name)
  );

-- Backfill default sub-categories for existing family ledgers
insert into public.categories (ledger_id, name, icon, sort, parent_id)
select p.ledger_id, v.sub_name, v.icon, v.sort, p.id
from public.categories p
join public.ledgers l on l.id = p.ledger_id
join (
  values
    ('Ăn uống', 'Đi chợ / Siêu thị', '🛒', 0),
    ('Ăn uống', 'Ăn ngoài', '🍜', 1),
    ('Ăn uống', 'Cà phê / Trà sữa', '☕', 2),
    ('Ăn uống', 'Ăn sáng / Ăn trưa', '🥐', 3),
    ('Đồ dùng', 'Đồ gia dụng', '🪑', 0),
    ('Đồ dùng', 'Tạp hoá / Tiêu dùng', '🧻', 1),
    ('Đồ dùng', 'Thiết bị điện tử', '📱', 2),
    ('Đi lại', 'Xăng xe', '⛽', 0),
    ('Đi lại', 'Gửi xe / Cầu đường', '🅿️', 1),
    ('Đi lại', 'Grab / Taxi', '🚕', 2),
    ('Đi lại', 'Bảo dưỡng / Sửa xe', '🔧', 3),
    ('Hoá đơn', 'Tiền điện', '⚡', 0),
    ('Hoá đơn', 'Tiền nước', '💧', 1),
    ('Hoá đơn', 'Internet / Điện thoại', '📶', 2),
    ('Hoá đơn', 'Gas / Rác / Dịch vụ', '🔥', 3),
    ('Nhà cửa', 'Thuê nhà / Phí quản lý', '🔑', 0),
    ('Nhà cửa', 'Sửa chữa & Nội thất', '🛠️', 1),
    ('Nhà cửa', 'Vệ sinh nhà cửa', '🧹', 2),
    ('Con cái', 'Sữa & Tã', '🍼', 0),
    ('Con cái', 'Học phí / Trông trẻ', '🎒', 1),
    ('Con cái', 'Đồ dùng / Đồ chơi', '🧸', 2),
    ('Sức khoẻ', 'Thuốc men', '🩺', 0),
    ('Sức khoẻ', 'Khám bệnh', '🏥', 1),
    ('Sức khoẻ', 'Thể thao / Gym', '🏋️', 2),
    ('Cá nhân & Làm đẹp', 'Quần áo & Giày dép', '👕', 0),
    ('Cá nhân & Làm đẹp', 'Mỹ phẩm & Chăm sóc', '🧴', 1),
    ('Cá nhân & Làm đẹp', 'Cắt tóc / Spa', '💇', 2),
    ('Giáo dục', 'Học phí', '🎓', 0),
    ('Giáo dục', 'Sách vở / Tài liệu', '📖', 1),
    ('Giáo dục', 'Khoá học kỹ năng', '💻', 2),
    ('Giải trí', 'Xem phim / Nhạc', '🎬', 0),
    ('Giải trí', 'Du lịch / Cuối tuần', '✈️', 1),
    ('Giải trí', 'Thú cưng', '🐾', 2),
    ('Hiếu hỉ & Quà tặng', 'Đám cưới / Thăm hỏi', '💐', 0),
    ('Hiếu hỉ & Quà tặng', 'Quà tặng / Sinh nhật', '🎂', 1),
    ('Hiếu hỉ & Quà tặng', 'Biếu gia đình', '🧧', 2)
) as v(parent_name, sub_name, icon, sort)
  on lower(p.name) = lower(v.parent_name)
where l.kind = 'family'
  and p.parent_id is null
  and not exists (
    select 1
    from public.categories c
    where c.ledger_id = p.ledger_id
      and c.parent_id = p.id
      and lower(c.name) = lower(v.sub_name)
  );

-- Backfill default sub-categories for existing business ledgers
insert into public.categories (ledger_id, name, icon, sort, parent_id)
select p.ledger_id, v.sub_name, v.icon, v.sort, p.id
from public.categories p
join public.ledgers l on l.id = p.ledger_id
join (
  values
    ('Doanh thu', 'Bán trực tiếp', '🏪', 0),
    ('Doanh thu', 'Bán online / Sàn', '🛒', 1),
    ('Doanh thu', 'Chuyển khoản / Thu hộ', '💳', 2),
    ('Nhập hàng', 'Nguyên vật liệu', '🧂', 0),
    ('Nhập hàng', 'Hàng hoá tồn kho', '📦', 1),
    ('Nhập hàng', 'Bao bì / Đóng gói', '🛍️', 2),
    ('Nhân công', 'Lương nhân viên', '💼', 0),
    ('Nhân công', 'Thưởng / Hoa hồng', '🏅', 1),
    ('Nhân công', 'Bảo hiểm / Phúc lợi', '🛡️', 2),
    ('Vận chuyển', 'Phí ship / Giao hàng', '📮', 0),
    ('Vận chuyển', 'Xăng xe giao nhận', '⛽', 1),
    ('Vận chuyển', 'Phí sàn / COD', '🧾', 2),
    ('Điện nước', 'Tiền điện', '⚡', 0),
    ('Điện nước', 'Tiền nước', '💧', 1),
    ('Điện nước', 'Internet / Phần mềm', '📶', 2),
    ('Marketing', 'Quảng cáo Ads', '📣', 0),
    ('Marketing', 'Khuyến mãi / Voucher', '🏷️', 1),
    ('Marketing', 'In ấn / Thiết kế', '🎨', 2)
) as v(parent_name, sub_name, icon, sort)
  on lower(p.name) = lower(v.parent_name)
where l.kind = 'business'
  and p.parent_id is null
  and not exists (
    select 1
    from public.categories c
    where c.ledger_id = p.ledger_id
      and c.parent_id = p.id
      and lower(c.name) = lower(v.sub_name)
  );
