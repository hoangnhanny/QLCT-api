import { LedgerKind } from './ledgers.types';

interface DefaultCategory {
  name: string;
  icon: string;
}

/** Seeded on ledger creation; order determines `categories.sort`. */
export const DEFAULT_CATEGORIES: Record<LedgerKind, DefaultCategory[]> = {
  family: [
    { name: 'Ăn uống', icon: '🍚' },
    { name: 'Đồ dùng', icon: '🧺' },
    { name: 'Đi lại', icon: '🚗' },
    { name: 'Hoá đơn', icon: '🧾' },
    { name: 'Sức khoẻ', icon: '💊' },
    { name: 'Giáo dục', icon: '📚' },
    { name: 'Giải trí', icon: '🎮' },
    { name: 'Khác', icon: '🗂️' },
  ],
  business: [
    { name: 'Doanh thu', icon: '💵' },
    { name: 'Nhập hàng', icon: '📦' },
    { name: 'Nhân công', icon: '👷' },
    { name: 'Vận chuyển', icon: '🚚' },
    { name: 'Thuê mặt bằng', icon: '🏠' },
    { name: 'Điện nước', icon: '💡' },
    { name: 'Marketing', icon: '📢' },
    { name: 'Khác', icon: '🗂️' },
  ],
};
