import { Budget as BudgetEntity } from '../database/entities/budget.entity';

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
  ledger_id?: string;
  ledgerId?: string;
  member_user_id?: string | null;
  memberUserId?: string | null;
  category_id?: string | null;
  categoryId?: string | null;
  month: Date | string;
  amount: string | number | bigint;
  created_at?: Date | string;
  createdAt?: Date | string;
  category_name?: string | null;
  category_icon?: string | null;
  member_display_name?: string | null;
  member_avatar_url?: string | null;
  category?: { id: string; name: string; icon: string | null } | null;
  memberProfile?: {
    displayName?: string | null;
    avatarUrl?: string | null;
  } | null;
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

export function mapBudget(row: BudgetRow | BudgetEntity): Budget {
  const ledgerId = (
    'ledgerId' in row && row.ledgerId ? row.ledgerId : (row as any).ledger_id
  ) as string;
  const memberUserId = (
    'memberUserId' in row ? row.memberUserId : (row as any).member_user_id
  ) as string | null;
  const categoryId = (
    'categoryId' in row ? row.categoryId : (row as any).category_id
  ) as string | null;
  const rawCreatedAt = (
    'createdAt' in row && row.createdAt
      ? row.createdAt
      : (row as any).created_at
  ) as Date | string;
  const createdAt =
    rawCreatedAt instanceof Date ? rawCreatedAt : new Date(rawCreatedAt);

  const categoryName =
    (row as any).category?.name ?? (row as any).category_name ?? '';
  const categoryIcon =
    (row as any).category?.icon ?? (row as any).category_icon ?? null;
  const displayName =
    (row as any).memberProfile?.displayName ??
    (row as any).member_display_name ??
    null;
  const avatarUrl =
    (row as any).memberProfile?.avatarUrl ??
    (row as any).member_avatar_url ??
    null;

  return {
    id: row.id,
    ledgerId,
    memberUserId,
    categoryId,
    month: formatMonthDate(row.month),
    amount: Number(row.amount),
    createdAt,
    category: categoryId
      ? {
          id: categoryId,
          name: categoryName,
          icon: categoryIcon,
        }
      : null,
    member: memberUserId
      ? {
          id: memberUserId,
          displayName,
          avatarUrl,
        }
      : null,
  };
}
