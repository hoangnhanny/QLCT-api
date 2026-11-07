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
  ledger_id: string;
  created_by: string;
  amount: string | number | bigint;
  content: string;
  category_id: string | null;
  image_path: string | null;
  spent_at: Date | string;
  created_at: Date | string;
  category_name?: string | null;
  category_icon?: string | null;
  creator_display_name?: string | null;
  creator_avatar_url?: string | null;
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

export function mapExpense(row: ExpenseRow): Expense {
  return {
    type: row.type ?? 'expense',
    id: row.id,
    ledgerId: row.ledger_id,
    createdBy: row.created_by,
    amount: Number(row.amount),
    content: row.content,
    categoryId: row.category_id,
    imagePath: row.image_path ?? null,
    spentAt:
      row.spent_at instanceof Date ? row.spent_at : new Date(row.spent_at),
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
    creator: {
      id: row.created_by,
      displayName: row.creator_display_name ?? null,
      avatarUrl: row.creator_avatar_url ?? null,
    },
  };
}
