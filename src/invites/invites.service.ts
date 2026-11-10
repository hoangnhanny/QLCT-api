import { randomBytes } from 'crypto';
import {
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ledger, mapLedger } from '../ledgers/ledgers.types';
import { SupabaseService } from '../supabase/supabase.service';
import { InviteRow } from './invites.types';
import { Invite as InviteEntity } from '../database/entities/invite.entity';
import { Ledger as LedgerEntity } from '../database/entities/ledger.entity';
import { Member as MemberEntity } from '../database/entities/member.entity';

const DEFAULT_TTL_DAYS = 7;

@Injectable()
export class InvitesService {
  private readonly legacyDb?: {
    query: (sql: string, params?: any[]) => Promise<any>;
  };
  private readonly inviteRepo?: Repository<InviteEntity>;
  private readonly ledgerRepo?: Repository<LedgerEntity>;
  private readonly memberRepo?: Repository<MemberEntity>;

  constructor(
    @InjectRepository(InviteEntity)
    inviteRepoOrSupabase: Repository<InviteEntity> | SupabaseService | any,
    @InjectRepository(LedgerEntity)
    @Optional()
    ledgerRepo?: Repository<LedgerEntity>,
    @InjectRepository(MemberEntity)
    @Optional()
    memberRepo?: Repository<MemberEntity>,
  ) {
    if (inviteRepoOrSupabase?.db) {
      this.legacyDb = inviteRepoOrSupabase.db;
    } else {
      this.inviteRepo = inviteRepoOrSupabase as Repository<InviteEntity>;
      this.ledgerRepo = ledgerRepo;
      this.memberRepo = memberRepo;
    }
  }

  /** Creates a random, time-limited invite link for a ledger. Admin-only. */
  async create(
    ledgerId: string,
    adminId: string,
    ttlDays = DEFAULT_TTL_DAYS,
  ): Promise<{ id: string; token: string; expiresAt: Date }> {
    await this.assertAdmin(ledgerId, adminId);

    const token = randomBytes(32).toString('base64url');

    if (this.legacyDb) {
      const result = await this.legacyDb.query(
        `insert into public.invites (ledger_id, token, expires_at, created_by)
         values ($1, $2, now() + make_interval(days => $3), $4)
         returning *`,
        [ledgerId, token, ttlDays, adminId],
      );
      const row = result.rows[0];
      return { id: row.id, token: row.token, expiresAt: row.expires_at };
    }

    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
    const invite = this.inviteRepo!.create({
      ledgerId,
      token,
      expiresAt,
      createdBy: adminId,
    });
    const saved = await this.inviteRepo!.save(invite);
    return { id: saved.id, token: saved.token, expiresAt: saved.expiresAt };
  }

  /** Revokes an invite. Scoped by ledger so one ledger's admin cannot revoke another ledger's invite. */
  async revoke(
    ledgerId: string,
    adminId: string,
    inviteId: string,
  ): Promise<void> {
    await this.assertAdmin(ledgerId, adminId);

    if (this.legacyDb) {
      const result = await this.legacyDb.query(
        `update public.invites set revoked_at = now()
         where id = $1 and ledger_id = $2
         returning id`,
        [inviteId, ledgerId],
      );
      if (result.rowCount === 0) {
        throw new NotFoundException('Invite not found');
      }
      return;
    }

    const result = await this.inviteRepo!.update(
      { id: inviteId, ledgerId },
      { revokedAt: new Date() },
    );
    if (result.affected === 0) {
      throw new NotFoundException('Invite not found');
    }
  }

  /** Public preview of an invite: only the ledger name and kind, no ids. */
  async preview(token: string): Promise<{ ledgerName: string; kind: string }> {
    const invite = await this.getInviteOrThrow(token);
    const ledger = await this.getLedgerOrThrow(
      invite.ledger_id ?? invite.ledgerId,
    );
    return { ledgerName: ledger.name, kind: ledger.kind };
  }

  /**
   * Adds the caller as an active member of the invite's ledger. Idempotent:
   * already-active members are unchanged, and a `removed` member is
   * reactivated only because the link is still valid.
   */
  async accept(token: string, userId: string): Promise<Ledger> {
    const invite = await this.getInviteOrThrow(token);
    const ledgerId = invite.ledger_id ?? invite.ledgerId;

    if (this.legacyDb) {
      await this.legacyDb.query(
        `insert into public.members (ledger_id, user_id, status)
         values ($1, $2, 'active')
         on conflict (ledger_id, user_id) do update
           set status = 'active'
           where public.members.status = 'removed'`,
        [ledgerId, userId],
      );
    } else {
      const existing = await this.memberRepo!.findOne({
        where: { ledgerId, userId },
      });
      if (!existing) {
        await this.memberRepo!.insert({
          ledgerId,
          userId,
          status: 'active',
        });
      } else if (existing.status === 'removed') {
        await this.memberRepo!.update(
          { id: existing.id },
          { status: 'active' },
        );
      }
    }

    return this.getLedgerOrThrow(ledgerId);
  }

  private async getInviteOrThrow(
    token: string,
  ): Promise<InviteRow & { ledgerId?: string }> {
    if (this.legacyDb) {
      const result = await this.legacyDb.query(
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

    const invite = await this.inviteRepo!.findOne({ where: { token } });
    if (!invite) {
      throw new NotFoundException('Không tìm thấy liên kết mời');
    }
    if (invite.revokedAt) {
      throw new GoneException('Liên kết mời đã bị thu hồi');
    }
    if (invite.expiresAt.getTime() < Date.now()) {
      throw new GoneException('Liên kết mời đã hết hạn');
    }
    return {
      id: invite.id,
      ledger_id: invite.ledgerId,
      ledgerId: invite.ledgerId,
      token: invite.token,
      expires_at: invite.expiresAt,
      revoked_at: invite.revokedAt,
      created_by: invite.createdBy,
      created_at: invite.createdAt,
    };
  }

  private async getLedgerOrThrow(ledgerId: string): Promise<Ledger> {
    if (this.legacyDb) {
      const result = await this.legacyDb.query(
        `select * from public.ledgers where id = $1`,
        [ledgerId],
      );
      if (result.rowCount === 0) {
        throw new NotFoundException('Ledger not found');
      }
      return mapLedger(result.rows[0]);
    }

    const ledger = await this.ledgerRepo!.findOne({
      where: { id: ledgerId },
    });
    if (!ledger) {
      throw new NotFoundException('Ledger not found');
    }
    return mapLedger(ledger);
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
