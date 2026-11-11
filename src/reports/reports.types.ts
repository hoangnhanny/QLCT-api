export interface BudgetStatus {
  budgetId: string;
  scope: 'ledger' | 'member';
  memberUserId?: string;
  categoryId?: string;
  limit: number;
  spent: number;
  percent: number;
}

export interface MonthlyCategorySummary {
  categoryId: string | null;
  categoryName?: string | null;
  total: number;
}

export interface MonthlyMemberSummary {
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
  total: number;
}

export interface MonthlyDaySummary {
  date: string;
  total: number;
}

export interface MonthlyPaymentMethodSummary {
  paymentMethod: 'cash' | 'transfer';
  total: number;
}

export interface MonthlyReport {
  income: number;
  total: number;
  byCategory: MonthlyCategorySummary[];
  byMember: MonthlyMemberSummary[];
  byDay: MonthlyDaySummary[];
  byPaymentMethod?: MonthlyPaymentMethodSummary[];
  budgets: BudgetStatus[];
}

export interface RangeBucketSummary {
  bucket: string;
  total: number;
}

export interface MonthlyReportFilter {
  categoryId?: string;
  userId?: string;
}
