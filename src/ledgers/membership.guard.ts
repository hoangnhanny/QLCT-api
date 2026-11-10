import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ledger as LedgerEntity } from '../database/entities/ledger.entity';
import { Member as MemberEntity } from '../database/entities/member.entity';
import { mapLedger, mapMember } from './ledgers.types';

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
  private readonly ledgerRepo?: Repository<LedgerEntity>;
  private readonly memberRepo?: Repository<MemberEntity>;
  private readonly reflector: Reflector;
  private readonly legacyDb?: any;

  constructor(
    @InjectRepository(LedgerEntity)
    ledgerRepo: Repository<LedgerEntity> | { db: any },
    @InjectRepository(MemberEntity)
    @Optional()
    memberRepo?: Repository<MemberEntity> | Reflector,
    @Optional()
    reflector?: Reflector,
  ) {
    if (memberRepo instanceof Reflector) {
      this.legacyDb = (ledgerRepo as any).db;
      this.reflector = memberRepo;
    } else if ((ledgerRepo as any)?.db) {
      this.legacyDb = (ledgerRepo as any).db;
      this.reflector = reflector!;
    } else {
      this.ledgerRepo = ledgerRepo as Repository<LedgerEntity>;
      this.memberRepo = memberRepo as Repository<MemberEntity>;
      this.reflector = reflector!;
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const ledgerId = request.params?.ledgerId;
    const userId = request.user?.id;

    let ledgerRow: any;
    let memberRow: any;

    if (this.legacyDb) {
      const ledgerResult = await this.legacyDb.query(
        `select * from public.ledgers where id = $1`,
        [ledgerId],
      );
      ledgerRow = ledgerResult.rows[0];
      if (!ledgerRow) {
        throw new NotFoundException('Ledger not found');
      }

      const memberResult = await this.legacyDb.query(
        `select * from public.members where ledger_id = $1 and user_id = $2`,
        [ledgerId, userId],
      );
      memberRow = memberResult.rows[0];
    } else {
      ledgerRow = await this.ledgerRepo!.findOne({ where: { id: ledgerId } });
      if (!ledgerRow) {
        throw new NotFoundException('Ledger not found');
      }

      memberRow = await this.memberRepo!.findOne({
        where: { ledgerId, userId },
      });
    }

    const ledger = mapLedger(ledgerRow);

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
