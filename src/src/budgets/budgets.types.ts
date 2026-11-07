export interface BudgetCategory {
  id: string;
  name: string;
  icon: string | null;
}

export interface BudgetMember {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface BudgetRow {
  id: string;
  ledger_id: string;
  member_user_id: string | null;
  category_id: string | null;
  month: Date | string;
  amount: string | number | bigint;
  created_at: Date | string;
  category_name?: string | null;
  category_icon?: string | null;
  member_display_name?: string | null;
  member_avatar_url?: string | null;
}

export interface Budget {
  id: string;
  ledgerId: string;
  memberUserId: string | null;
  categoryId: string | null;
  month: string; // YYYY-MM-01
  amount: number;
  createdAt: Date;
  category?: BudgetCategory | null;
  member?: BudgetMember | null;
}

export function formatMonthDate(dateOrStr: Date | string): string {
  if (dateOrStr instanceof Date) {
    const year = dateOrStr.getUTCFullYear();
    const month = String(dateOrStr.getUTCMonth() + 1).padStart(2, '0');
    return `${year}-${month}-01`;
  }
  const match = String(dateOrStr).match(/^(\d{4})-(\d{2})/);
  if (match) {
    return `${match[1]}-${match[2]}-01`;
  }
  return String(dateOrStr);
}

export function mapBudget(row: BudgetRow): Budget {
  return {
    id: row.id,
    ledgerId: row.ledger_id,
    memberUserId: row.member_user_id,
    categoryId: row.category_id,
    month: formatMonthDate(row.month),
    amount: Number(row.amount),
    createdAt:
      row.created_at instanceof Date
        ? row.created_at
        : new Date(row.created_at),
    category: row.category_id
      ? {
          id: row.category_id,
          name: row.category_name ?? '',
          icon: row.category_icon ?? null,
        }
      : null,
    member: row.member_user_id
      ? {
          id: row.member_user_id,
          displayName: row.member_display_name ?? null,
          avatarUrl: row.member_avatar_url ?? null,
        }
      : null,
  };
}
