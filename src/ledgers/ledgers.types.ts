import { formatMonthDate } from '../budgets/budgets.types';
import { Category as CategoryEntity } from '../database/entities/category.entity';
import { Ledger as LedgerEntity } from '../database/entities/ledger.entity';
import { Member as MemberEntity } from '../database/entities/member.entity';

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
  admin_id?: string;
  adminId?: string;
  month?: Date | string | null;
  created_at?: Date;
  createdAt?: Date;
}

export interface MemberRow {
  id: string;
  ledger_id?: string;
  ledgerId?: string;
  user_id?: string;
  userId?: string;
  status: MemberStatus;
  created_at?: Date;
  createdAt?: Date;
}

export interface CategoryRow {
  id: string;
  ledger_id?: string;
  ledgerId?: string;
  name: string;
  icon: string | null;
  sort: number | null;
  created_at?: Date;
  createdAt?: Date;
}

export function mapLedger(row: LedgerRow | LedgerEntity): Ledger {
  const adminId = (
    'adminId' in row && row.adminId ? row.adminId : (row as any).admin_id
  ) as string;
  const createdAt = (
    'createdAt' in row && row.createdAt
      ? row.createdAt
      : (row as any).created_at
  ) as Date;
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
    adminId,
    month: monthStr,
    createdAt,
  };
}

export function mapMember(row: MemberRow | MemberEntity): Member {
  return {
    id: row.id,
    ledgerId: ('ledgerId' in row && row.ledgerId
      ? row.ledgerId
      : (row as any).ledger_id) as string,
    userId: ('userId' in row && row.userId
      ? row.userId
      : (row as any).user_id) as string,
    status: row.status,
    createdAt: ('createdAt' in row && row.createdAt
      ? row.createdAt
      : (row as any).created_at) as Date,
  };
}

export function mapCategory(row: CategoryRow | CategoryEntity): Category {
  return {
    id: row.id,
    ledgerId: ('ledgerId' in row && row.ledgerId
      ? row.ledgerId
      : (row as any).ledger_id) as string,
    name: row.name,
    icon: row.icon ?? null,
    sort: row.sort ?? null,
    createdAt: ('createdAt' in row && row.createdAt
      ? row.createdAt
      : (row as any).created_at) as Date,
  };
}
