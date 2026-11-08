import { formatMonthDate } from '../budgets/budgets.types';

export type LedgerKind = 'family' | 'business';
export type MemberStatus = 'active' | 'removed';

export interface Ledger {
  id: string;
  kind: LedgerKind;
  name: string;
  adminId: string;
  month?: string;
  createdAt: Date;
}

export interface Member {
  id: string;
  ledgerId: string;
  userId: string;
  status: MemberStatus;
  createdAt: Date;
}

export interface Category {
  id: string;
  ledgerId: string;
  name: string;
  icon: string | null;
  sort: number | null;
  createdAt: Date;
}

export interface LedgerRow {
  id: string;
  kind: LedgerKind;
  name: string;
  admin_id: string;
  month?: Date | string | null;
  created_at: Date;
}

export interface MemberRow {
  id: string;
  ledger_id: string;
  user_id: string;
  status: MemberStatus;
  created_at: Date;
}

export interface CategoryRow {
  id: string;
  ledger_id: string;
  name: string;
  icon: string | null;
  sort: number | null;
  created_at: Date;
}

export function mapLedger(row: LedgerRow): Ledger {
  let monthStr: string | undefined;
  if (row.month) {
    if (typeof row.month === 'string') {
      const match = row.month.match(/^(\d{4})-(\d{2})/);
      monthStr = match ? `${match[1]}-${match[2]}` : row.month;
    } else {
      monthStr = formatMonthDate(row.month).slice(0, 7);
    }
  }

  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    adminId: row.admin_id,
    month: monthStr,
    createdAt: row.created_at,
  };
}

export function mapMember(row: MemberRow): Member {
  return {
    id: row.id,
    ledgerId: row.ledger_id,
    userId: row.user_id,
    status: row.status,
    createdAt: row.created_at,
  };
}

export function mapCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    ledgerId: row.ledger_id,
    name: row.name,
    icon: row.icon,
    sort: row.sort,
    createdAt: row.created_at,
  };
}
