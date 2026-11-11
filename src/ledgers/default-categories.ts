import { LedgerKind } from './ledgers.types';

export interface DefaultSubCategory {
  name: string;
  icon: string;
}

export interface DefaultCategory {
  name: string;
  icon: string;
  children?: DefaultSubCategory[];
}

/** Seeded on ledger creation; order determines `categories.sort`. */
export const DEFAULT_CATEGORIES: Record<LedgerKind, DefaultCategory[]> = {
  family: [
    {
      name: 'Ăn uống',
      icon: '🍚',
      children: [
        { name: 'Đi chợ / Siêu thị', icon: '🛒' },
        { name: 'Ăn ngoài', icon: '🍜' },
        { name: 'Cà phê / Trà sữa', icon: '☕' },
        { name: 'Ăn sáng / Ăn trưa', icon: '🥐' },
      ],
    },
    {
      name: 'Đồ dùng',
      icon: '🧺',
      children: [
        { name: 'Đồ gia dụng', icon: '🪑' },
        { name: 'Tạp hoá / Tiêu dùng', icon: '🧻' },
        { name: 'Thiết bị điện tử', icon: '📱' },
      ],
    },
    {
      name: 'Đi lại',
      icon: '🚗',
      children: [
        { name: 'Xăng xe', icon: '⛽' },
        { name: 'Gửi xe / Cầu đường', icon: '🅿️' },
        { name: 'Grab / Taxi', icon: '🚕' },
        { name: 'Bảo dưỡng / Sửa xe', icon: '🔧' },
      ],
    },
    {
      name: 'Hoá đơn',
      icon: '🧾',
      children: [
        { name: 'Tiền điện', icon: '⚡' },
        { name: 'Tiền nước', icon: '💧' },
        { name: 'Internet / Điện thoại', icon: '📶' },
        { name: 'Gas / Rác / Dịch vụ', icon: '🔥' },
      ],
    },
    {
      name: 'Nhà cửa',
      icon: '🏠',
      children: [
        { name: 'Thuê nhà / Phí quản lý', icon: '🔑' },
        { name: 'Sửa chữa & Nội thất', icon: '🛠️' },
        { name: 'Vệ sinh nhà cửa', icon: '🧹' },
      ],
    },
    {
      name: 'Con cái',
      icon: '👶',
      children: [
        { name: 'Sữa & Tã', icon: '🍼' },
        { name: 'Học phí / Trông trẻ', icon: '🎒' },
        { name: 'Đồ dùng / Đồ chơi', icon: '🧸' },
      ],
    },
    {
      name: 'Sức khoẻ',
      icon: '💊',
      children: [
        { name: 'Thuốc men', icon: '🩺' },
        { name: 'Khám bệnh', icon: '🏥' },
        { name: 'Thể thao / Gym', icon: '🏋️' },
      ],
    },
    {
      name: 'Cá nhân & Làm đẹp',
      icon: '✨',
      children: [
        { name: 'Quần áo & Giày dép', icon: '👕' },
        { name: 'Mỹ phẩm & Chăm sóc', icon: '🧴' },
        { name: 'Cắt tóc / Spa', icon: '💇' },
      ],
    },
    {
      name: 'Giáo dục',
      icon: '📚',
      children: [
        { name: 'Học phí', icon: '🎓' },
        { name: 'Sách vở / Tài liệu', icon: '📖' },
        { name: 'Khoá học kỹ năng', icon: '💻' },
      ],
    },
    {
      name: 'Giải trí',
      icon: '🎮',
      children: [
        { name: 'Xem phim / Nhạc', icon: '🎬' },
        { name: 'Du lịch / Cuối tuần', icon: '✈️' },
        { name: 'Thú cưng', icon: '🐾' },
      ],
    },
    {
      name: 'Hiếu hỉ & Quà tặng',
      icon: '🎁',
      children: [
        { name: 'Đám cưới / Thăm hỏi', icon: '💐' },
        { name: 'Quà tặng / Sinh nhật', icon: '🎂' },
        { name: 'Biếu gia đình', icon: '🧧' },
      ],
    },
    { name: 'Khác', icon: '🗂️' },
  ],
  business: [
    {
      name: 'Doanh thu',
      icon: '💵',
      children: [
        { name: 'Bán trực tiếp', icon: '🏪' },
        { name: 'Bán online / Sàn', icon: '🛒' },
        { name: 'Chuyển khoản / Thu hộ', icon: '💳' },
      ],
    },
    { name: 'Thu khác', icon: '💰' },
    {
      name: 'Nhập hàng',
      icon: '📦',
      children: [
        { name: 'Nguyên vật liệu', icon: '🧂' },
        { name: 'Hàng hoá tồn kho', icon: '📦' },
        { name: 'Bao bì / Đóng gói', icon: '🛍️' },
      ],
    },
    {
      name: 'Nhân công',
      icon: '👷',
      children: [
        { name: 'Lương nhân viên', icon: '💼' },
        { name: 'Thưởng / Hoa hồng', icon: '🏅' },
        { name: 'Bảo hiểm / Phúc lợi', icon: '🛡️' },
      ],
    },
    {
      name: 'Vận chuyển',
      icon: '🚚',
      children: [
        { name: 'Phí ship / Giao hàng', icon: '📮' },
        { name: 'Xăng xe giao nhận', icon: '⛽' },
        { name: 'Phí sàn / COD', icon: '🧾' },
      ],
    },
    { name: 'Thuê mặt bằng', icon: '🏠' },
    {
      name: 'Điện nước',
      icon: '💡',
      children: [
        { name: 'Tiền điện', icon: '⚡' },
        { name: 'Tiền nước', icon: '💧' },
        { name: 'Internet / Phần mềm', icon: '📶' },
      ],
    },
    {
      name: 'Marketing',
      icon: '📢',
      children: [
        { name: 'Quảng cáo Ads', icon: '📣' },
        { name: 'Khuyến mãi / Voucher', icon: '🏷️' },
        { name: 'In ấn / Thiết kế', icon: '🎨' },
      ],
    },
    { name: 'Khác', icon: '🗂️' },
  ],
};
