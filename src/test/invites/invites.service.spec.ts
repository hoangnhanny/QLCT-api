import {
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { createTestUser, getPool, resetDb } from '../db';
import { LedgersService } from '../../src/ledgers/ledgers.service';
import { SupabaseService } from '../../src/supabase/supabase.service';
import { InvitesService } from '../../src/invites/invites.service';

function fakeSupabaseService(): SupabaseService {
  // InvitesService only uses `.db`; reuse the shared test pool instead of
  // constructing a real SupabaseService (which would open a second pool and
  // try to read storage env vars we don't set in tests).
  return { db: getPool() } as unknown as SupabaseService;
}

describe('InvitesService', () => {
  let service: InvitesService;
  let ledgersService: LedgersService;
  const supabase = fakeSupabaseService();

  beforeAll(() => {
    service = new InvitesService(supabase);
    ledgersService = new LedgersService(supabase);
  });

  afterAll(async () => {
    await resetDb();
    await getPool().end();
  });

  beforeEach(async () => {
    await resetDb();
  });

  describe('create', () => {
    it('non-admin cannot create invite', async () => {
      const admin = await createTestUser('admin');
      const member = await createTestUser('member');
      const ledger = await ledgersService.create(admin, {
        kind: 'family',
        name: 'Nhà',
      });
      await getPool().query(
        `insert into public.members (ledger_id, user_id, status) values ($1, $2, 'active')`,
        [ledger.id, member],
      );

      await expect(service.create(ledger.id, member)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('creates an invite with a base64url token and a 7 day default expiry', async () => {
      const admin = await createTestUser('admin');
      const ledger = await ledgersService.create(admin, {
        kind: 'family',
        name: 'Nhà',
      });

      const before = Date.now();
      const invite = await service.create(ledger.id, admin);

      expect(invite.id).toBeDefined();
      expect(invite.token).toMatch(/^[A-Za-z0-9_-]+$/);
      const ttlMs = invite.expiresAt.getTime() - before;
      expect(ttlMs).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
      expect(ttlMs).toBeLessThan(8 * 24 * 60 * 60 * 1000);
    });

    it('honours a custom ttlDays', async () => {
      const admin = await createTestUser('admin');
      const ledger = await ledgersService.create(admin, {
        kind: 'family',
        name: 'Nhà',
      });

      const before = Date.now();
      const invite = await service.create(ledger.id, admin, 1);

      const ttlMs = invite.expiresAt.getTime() - before;
      expect(ttlMs).toBeGreaterThan(0);
      expect(ttlMs).toBeLessThan(2 * 24 * 60 * 60 * 1000);
    });
  });

  describe('revoke', () => {
    it('non-admin cannot revoke invite', async () => {
      const admin = await createTestUser('admin');
      const member = await createTestUser('member');
      const ledger = await ledgersService.create(admin, {
        kind: 'family',
        name: 'Nhà',
      });
      await getPool().query(
        `insert into public.members (ledger_id, user_id, status) values ($1, $2, 'active')`,
        [ledger.id, member],
      );
      const invite = await service.create(ledger.id, admin);

      await expect(
        service.revoke(ledger.id, member, invite.id),
      ).rejects.toThrow(ForbiddenException);
    });

    it("cannot revoke another ledger's invite", async () => {
      const admin = await createTestUser('admin');
      const ledgerA = await ledgersService.create(admin, {
        kind: 'family',
        name: 'Nhà A',
      });
      const ledgerB = await ledgersService.create(admin, {
        kind: 'family',
        name: 'Nhà B',
      });
      const invite = await service.create(ledgerA.id, admin);

      await expect(
        service.revoke(ledgerB.id, admin, invite.id),
      ).rejects.toThrow(NotFoundException);

      // The invite is still valid via the preview endpoint, i.e. not revoked.
      const preview = await service.preview(invite.token);
      expect(preview.ledgerName).toBe('Nhà A');
    });

    it('revoking marks the token as gone', async () => {
      const admin = await createTestUser('admin');
      const ledger = await ledgersService.create(admin, {
        kind: 'family',
        name: 'Nhà',
      });
      const invite = await service.create(ledger.id, admin);

      await service.revoke(ledger.id, admin, invite.id);

      await expect(service.preview(invite.token)).rejects.toThrow(
        GoneException,
      );
    });
  });

  describe('preview', () => {
    it('unknown token 404', async () => {
      await expect(service.preview('nonexistent-token')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns only ledgerName and kind', async () => {
      const admin = await createTestUser('admin');
      const ledger = await ledgersService.create(admin, {
        kind: 'business',
        name: 'Quán',
      });
      const invite = await service.create(ledger.id, admin);

      const preview = await service.preview(invite.token);

      expect(preview).toEqual({ ledgerName: 'Quán', kind: 'business' });
    });

    it('expired token rejected with 410', async () => {
      const admin = await createTestUser('admin');
      const ledger = await ledgersService.create(admin, {
        kind: 'family',
        name: 'Nhà',
      });
      const invite = await service.create(ledger.id, admin);
      await getPool().query(
        `update public.invites set expires_at = now() - interval '1 day' where id = $1`,
        [invite.id],
      );

      await expect(service.preview(invite.token)).rejects.toThrow(
        GoneException,
      );
    });

    it('revoked token rejected with 410', async () => {
      const admin = await createTestUser('admin');
      const ledger = await ledgersService.create(admin, {
        kind: 'family',
        name: 'Nhà',
      });
      const invite = await service.create(ledger.id, admin);
      await service.revoke(ledger.id, admin, invite.id);

      await expect(service.preview(invite.token)).rejects.toThrow(
        GoneException,
      );
    });
  });

  describe('accept', () => {
    it('accept adds active member', async () => {
      const admin = await createTestUser('admin');
      const newcomer = await createTestUser('newcomer');
      const ledger = await ledgersService.create(admin, {
        kind: 'family',
        name: 'Nhà',
      });
      const invite = await service.create(ledger.id, admin);

      const result = await service.accept(invite.token, newcomer);

      expect(result.id).toBe(ledger.id);
      const members = await ledgersService.listMembers(ledger.id);
      const member = members.find((m) => m.userId === newcomer);
      expect(member?.status).toBe('active');
    });

    it('accepting twice yields one membership', async () => {
      const admin = await createTestUser('admin');
      const newcomer = await createTestUser('newcomer');
      const ledger = await ledgersService.create(admin, {
        kind: 'family',
        name: 'Nhà',
      });
      const invite = await service.create(ledger.id, admin);

      await service.accept(invite.token, newcomer);
      await service.accept(invite.token, newcomer);

      const members = await ledgersService.listMembers(ledger.id);
      const matches = members.filter((m) => m.userId === newcomer);
      expect(matches).toHaveLength(1);
      expect(matches[0].status).toBe('active');
    });

    it('re-activates a removed member', async () => {
      const admin = await createTestUser('admin');
      const member = await createTestUser('member');
      const ledger = await ledgersService.create(admin, {
        kind: 'family',
        name: 'Nhà',
      });
      await getPool().query(
        `insert into public.members (ledger_id, user_id, status) values ($1, $2, 'active')`,
        [ledger.id, member],
      );
      await ledgersService.leave(ledger.id, member);
      const invite = await service.create(ledger.id, admin);

      await service.accept(invite.token, member);

      const members = await ledgersService.listMembers(ledger.id);
      const updated = members.find((m) => m.userId === member);
      expect(updated?.status).toBe('active');
    });

    it('expired invite does not create a membership', async () => {
      const admin = await createTestUser('admin');
      const newcomer = await createTestUser('newcomer');
      const ledger = await ledgersService.create(admin, {
        kind: 'family',
        name: 'Nhà',
      });
      const invite = await service.create(ledger.id, admin);
      await getPool().query(
        `update public.invites set expires_at = now() - interval '1 day' where id = $1`,
        [invite.id],
      );

      await expect(service.accept(invite.token, newcomer)).rejects.toThrow(
        GoneException,
      );

      const members = await ledgersService.listMembers(ledger.id);
      expect(members.find((m) => m.userId === newcomer)).toBeUndefined();
    });

    it('unknown token 404 on accept', async () => {
      const user = await createTestUser('user');
      await expect(service.accept('nonexistent-token', user)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
