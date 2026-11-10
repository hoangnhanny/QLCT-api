import { Expense as ExpenseEntity } from '../database/entities/expense.entity';

export interface ExpenseCategory {
  id: string;
  name: string;
  icon: string | null;
}

export interface ExpenseCreator {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface ExpenseRow {
  type?: 'expense' | 'income';
  id: string;
  ledger_id?: string;
  ledgerId?: string;
  created_by?: string;
  createdBy?: string;
  amount: string | number | bigint;
  content: string;
  category_id?: string | null;
  categoryId?: string | null;
  image_path?: string | null;
  imagePath?: string | null;
  spent_at?: Date | string;
  spentAt?: Date | string;
  created_at?: Date | string;
  createdAt?: Date | string;
  category_name?: string | null;
  category_icon?: string | null;
  creator_display_name?: string | null;
  creator_avatar_url?: string | null;
  category?: { id: string; name: string; icon: string | null } | null;
  creatorProfile?: {
    displayName?: string | null;
    avatarUrl?: string | null;
  } | null;
}

export interface Expense {
  type: 'expense' | 'income';
  id: string;
  ledgerId: string;
  createdBy: string;
  amount: number;
  content: string;
  categoryId: string | null;
  imagePath: string | null;
  spentAt: Date;
  createdAt: Date;
  category?: ExpenseCategory | null;
  creator?: ExpenseCreator | null;
}

export function mapExpense(row: ExpenseRow | ExpenseEntity): Expense {
  const ledgerId = (
    'ledgerId' in row && row.ledgerId ? row.ledgerId : (row as any).ledger_id
  ) as string;
  const createdBy = (
    'createdBy' in row && row.createdBy
      ? row.createdBy
      : (row as any).created_by
  ) as string;
  const categoryId = (
    'categoryId' in row ? row.categoryId : (row as any).category_id
  ) as string | null;
  const imagePath =
    ('imagePath' in row ? row.imagePath : (row as any).image_path) ?? null;
  const rawSpentAt = (
    'spentAt' in row && row.spentAt ? row.spentAt : (row as any).spent_at
  ) as Date | string;
  const rawCreatedAt = (
    'createdAt' in row && row.createdAt
      ? row.createdAt
      : (row as any).created_at
  ) as Date | string;

  const spentAt =
    rawSpentAt instanceof Date ? rawSpentAt : new Date(rawSpentAt);
  const createdAt =
    rawCreatedAt instanceof Date ? rawCreatedAt : new Date(rawCreatedAt);

  const categoryName =
    (row as any).category?.name ?? (row as any).category_name ?? '';
  const categoryIcon =
    (row as any).category?.icon ?? (row as any).category_icon ?? null;
  const displayName =
    (row as any).creatorProfile?.displayName ??
    (row as any).creator_display_name ??
    null;
  const avatarUrl =
    (row as any).creatorProfile?.avatarUrl ??
    (row as any).creator_avatar_url ??
    null;

  return {
    type: row.type ?? 'expense',
    id: row.id,
    ledgerId,
    createdBy,
    amount: Number(row.amount),
    content: row.content,
    categoryId,
    imagePath,
    spentAt,
    createdAt,
    category: categoryId
      ? {
          id: categoryId,
          name: categoryName,
          icon: categoryIcon,
        }
      : null,
    creator: {
      id: createdBy,
      displayName,
      avatarUrl,
    },
  };
}
