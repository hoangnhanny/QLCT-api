import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SupabaseService } from '../supabase/supabase.service';
import { LedgerRow, mapLedger, mapMember, MemberRow } from './ledgers.types';

export const ADMIN_ONLY_KEY = 'ledgers:adminOnly';

/** Marks a route as requiring the caller to be the ledger's admin. */
export const AdminOnly = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ADMIN_ONLY_KEY, true);

/**
 * Requires an authenticated, active member of the `:ledgerId` route param.
 * Sets `request.member` and `request.ledger`. 404s for an unknown ledger,
 * 403s for a non-member or a removed member. Combine with `@AdminOnly()`
 * to additionally require the caller to be the ledger's admin.
 */
@Injectable()
export class MembershipGuard implements CanActivate {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const ledgerId = request.params?.ledgerId;
    const userId = request.user?.id;

    const ledgerResult = await this.supabase.db.query<LedgerRow>(
      `select * from public.ledgers where id = $1`,
      [ledgerId],
    );
    const ledgerRow = ledgerResult.rows[0];
    if (!ledgerRow) {
      throw new NotFoundException('Ledger not found');
    }
    const ledger = mapLedger(ledgerRow);

    const memberResult = await this.supabase.db.query<MemberRow>(
      `select * from public.members where ledger_id = $1 and user_id = $2`,
      [ledgerId, userId],
    );
    const memberRow = memberResult.rows[0];
    if (!memberRow || memberRow.status !== 'active') {
      throw new ForbiddenException('Not a member of this ledger');
    }
    const member = mapMember(memberRow);

    const adminOnly = this.reflector.getAllAndOverride<boolean>(
      ADMIN_ONLY_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (adminOnly && ledger.adminId !== userId) {
      throw new ForbiddenException('Only the ledger admin can do this');
    }

    request.ledger = ledger;
    request.member = member;
    return true;
  }
}
