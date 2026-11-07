import { randomBytes } from 'crypto';
import {
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Ledger, LedgerRow, mapLedger } from '../ledgers/ledgers.types';
import { SupabaseService } from '../supabase/supabase.service';
import { InviteRow } from './invites.types';

const DEFAULT_TTL_DAYS = 7;

@Injectable()
export class InvitesService {
  constructor(private readonly supabase: SupabaseService) {}

  private get db() {
    return this.supabase.db;
  }

  /** Creates a random, time-limited invite link for a ledger. Admin-only. */
  async create(
    ledgerId: string,
    adminId: string,
    ttlDays = DEFAULT_TTL_DAYS,
  ): Promise<{ id: string; token: string; expiresAt: Date }> {
    await this.assertAdmin(ledgerId, adminId);

    const token = randomBytes(32).toString('base64url');
    const result = await this.db.query<InviteRow>(
      `insert into public.invites (ledger_id, token, expires_at, created_by)
       values ($1, $2, now() + make_interval(days => $3), $4)
       returning *`,
      [ledgerId, token, ttlDays, adminId],
    );
    const row = result.rows[0];
    return { id: row.id, token: row.token, expiresAt: row.expires_at };
  }

  /** Revokes an invite. Scoped by ledger so one ledger's admin cannot revoke another ledger's invite. */
  async revoke(
    ledgerId: string,
    adminId: string,
    inviteId: string,
  ): Promise<void> {
    await this.assertAdmin(ledgerId, adminId);

    const result = await this.db.query(
      `update public.invites set revoked_at = now()
       where id = $1 and ledger_id = $2
       returning id`,
      [inviteId, ledgerId],
    );
    if (result.rowCount === 0) {
      throw new NotFoundException('Invite not found');
    }
  }

  /** Public preview of an invite: only the ledger name and kind, no ids. */
  async preview(token: string): Promise<{ ledgerName: string; kind: string }> {
    const invite = await this.getInviteOrThrow(token);
    const ledger = await this.getLedgerOrThrow(invite.ledger_id);
    return { ledgerName: ledger.name, kind: ledger.kind };
  }

  /**
   * Adds the caller as an active member of the invite's ledger. Idempotent:
   * already-active members are unchanged, and a `removed` member is
   * reactivated only because the link is still valid.
   */
  async accept(token: string, userId: string): Promise<Ledger> {
    const invite = await this.getInviteOrThrow(token);

    await this.db.query(
      `insert into public.members (ledger_id, user_id, status)
       values ($1, $2, 'active')
       on conflict (ledger_id, user_id) do update
         set status = 'active'
         where public.members.status = 'removed'`,
      [invite.ledger_id, userId],
    );

    return this.getLedgerOrThrow(invite.ledger_id);
  }

  private async getInviteOrThrow(token: string): Promise<InviteRow> {
    const result = await this.db.query<InviteRow>(
      `select * from public.invites where token = $1`,
      [token],
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException('Không tìm thấy liên kết mời');
    }
    if (row.revoked_at) {
      throw new GoneException('Liên kết mời đã bị thu hồi');
    }
    if (row.expires_at.getTime() < Date.now()) {
      throw new GoneException('Liên kết mời đã hết hạn');
    }
    return row;
  }

  private async getLedgerOrThrow(ledgerId: string): Promise<Ledger> {
    const result = await this.db.query<LedgerRow>(
      `select * from public.ledgers where id = $1`,
      [ledgerId],
    );
    if (result.rowCount === 0) {
      throw new NotFoundException('Ledger not found');
    }
    return mapLedger(result.rows[0]);
  }

  private async assertAdmin(
    ledgerId: string,
    actorId: string,
  ): Promise<Ledger> {
    const ledger = await this.getLedgerOrThrow(ledgerId);
    if (ledger.adminId !== actorId) {
      throw new ForbiddenException('Only the ledger admin can do this');
    }
    return ledger;
  }
}
