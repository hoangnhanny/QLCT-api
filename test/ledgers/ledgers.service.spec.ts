import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createTestUser, getPool, resetDb } from '../db';
import { SupabaseService } from '../../src/supabase/supabase.service';
import { LedgersService } from '../../src/ledgers/ledgers.service';
import { MembershipGuard } from '../../src/ledgers/membership.guard';

function fakeSupabaseService(): SupabaseService {
  // LedgersService/MembershipGuard only use `.db`; reuse the shared test
  // pool instead of constructing a real SupabaseService (which would open
  // a second pool and try to read storage env vars we don't set in tests).
  return { db: getPool() } as unknown as SupabaseService;
}

function noop() {}

function fakeContext(params: Record<string, string>, user: { id: string }) {
  const request: any = { params, user };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => noop,
    getClass: () => noop,
    request,
  };
}

describe('LedgersService', () => {
  let service: LedgersService;
  const supabase = fakeSupabaseService();

  beforeAll(() => {
    service = new LedgersService(supabase);
  });

  beforeEach(async () => {
    await resetDb();
  });

  describe('create', () => {
    it('creates the ledger, admin membership, and default family categories in one transaction', async () => {
      const userId = await createTestUser('alice');

      const ledger = await service.create(userId, {
        kind: 'family',
        name: 'Nhà mình',
      });

      expect(ledger.id).toBeDefined();
      expect(ledger.kind).toBe('family');
      expect(ledger.adminId).toBe(userId);

      const members = await service.listMembers(ledger.id);
      expect(members).toHaveLength(1);
      expect(members[0].userId).toBe(userId);
      expect(members[0].status).toBe('active');

      const categories = await service.listCategories(ledger.id);
      const topLevel = categories.filter((c) => !c.parentId);
      expect(topLevel.map((c) => c.name)).toEqual([
        'Ăn uống',
        'Đồ dùng',
        'Đi lại',
        'Hoá đơn',
        'Nhà cửa',
        'Con cái',
        'Sức khoẻ',
        'Cá nhân & Làm đẹp',
        'Giáo dục',
        'Giải trí',
        'Hiếu hỉ & Quà tặng',
        'Khác',
      ]);
      const food = topLevel.find((c) => c.name === 'Ăn uống');
      const foodSubs = categories.filter((c) => c.parentId === food?.id);
      expect(foodSubs.map((c) => c.name)).toEqual([
        'Đi chợ / Siêu thị',
        'Ăn ngoài',
        'Cà phê / Trà sữa',
        'Ăn sáng / Ăn trưa',
      ]);
    });

    it('seeds default business categories for a business ledger', async () => {
      const userId = await createTestUser('biz');

      const ledger = await service.create(userId, {
        kind: 'business',
        name: 'Quán cafe',
      });

      const categories = await service.listCategories(ledger.id);
      const topLevel = categories.filter((c) => !c.parentId);
      expect(topLevel.map((c) => c.name)).toEqual([
        'Doanh thu',
        'Thu khác',
        'Nhập hàng',
        'Nhân công',
        'Vận chuyển',
        'Thuê mặt bằng',
        'Điện nước',
        'Marketing',
        'Khác',
      ]);
      const revenue = topLevel.find((c) => c.name === 'Doanh thu');
      expect(
        categories.filter((c) => c.parentId === revenue?.id).map((c) => c.name),
      ).toEqual(['Bán trực tiếp', 'Bán online / Sàn', 'Chuyển khoản / Thu hộ']);
    });

    it('sets month to specified month or defaults to current month', async () => {
      const userId = await createTestUser('alice');

      const ledger10 = await service.create(userId, {
        kind: 'family',
        name: 'Sổ Tháng 10',
        month: '2026-10',
      });
      expect(ledger10.month).toBe('2026-10');

      const ledgerDefault = await service.create(userId, {
        kind: 'family',
        name: 'Sổ Mặc Định',
      });
      expect(ledgerDefault.month).toBeDefined();
      expect(ledgerDefault.month).toMatch(/^\d{4}-\d{2}$/);
    });

    it('extracts month string without runtime timezone drift', () => {
      const row = {
        id: 'l1',
        kind: 'family' as const,
        name: 'Nhà',
        admin_id: 'u1',
        month: '2026-11-01',
        created_at: new Date(),
      };
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { mapLedger } = require('../../src/ledgers/ledgers.types');
      const ledger = mapLedger(row);
      expect(ledger.month).toBe('2026-11');
    });
  });

  describe('listForUser', () => {
    it('only returns ledgers the user is an active member of', async () => {
      const alice = await createTestUser('alice');
      const bob = await createTestUser('bob');
      const ledger = await service.create(alice, {
        kind: 'family',
        name: 'Nhà alice',
      });
      await service.create(bob, { kind: 'family', name: 'Nhà bob' });

      const ledgers = await service.listForUser(alice);

      expect(ledgers).toHaveLength(1);
      expect(ledgers[0].id).toBe(ledger.id);
    });

    it('filters ledgers by month when month query is provided', async () => {
      const alice = await createTestUser('alice');
      const ledgerOct = await service.create(alice, {
        kind: 'family',
        name: 'Sổ Tháng 10',
        month: '2026-10',
      });
      const ledgerNov = await service.create(alice, {
        kind: 'family',
        name: 'Sổ Tháng 11',
        month: '2026-11',
      });

      // When in October, only Oct ledger is returned; Nov ledger is not visible
      const octLedgers = await service.listForUser(alice, '2026-10');
      expect(octLedgers).toHaveLength(1);
      expect(octLedgers[0].id).toBe(ledgerOct.id);
      expect(octLedgers[0].name).toBe('Sổ Tháng 10');

      // When in November, only Nov ledger is returned
      const novLedgers = await service.listForUser(alice, '2026-11');
      expect(novLedgers).toHaveLength(1);
      expect(novLedgers[0].id).toBe(ledgerNov.id);
      expect(novLedgers[0].name).toBe('Sổ Tháng 11');

      // Without month filter, all ledgers are returned
      const allLedgers = await service.listForUser(alice);
      expect(allLedgers).toHaveLength(2);
    });
  });

  describe('leave', () => {
    it('admin cannot leave without transfer', async () => {
      const admin = await createTestUser('admin');
      const ledger = await service.create(admin, {
        kind: 'family',
        name: 'Nhà',
      });

      await expect(service.leave(ledger.id, admin)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('a non-admin member can leave', async () => {
      const admin = await createTestUser('admin');
      const member = await createTestUser('member');
      const ledger = await service.create(admin, {
        kind: 'family',
        name: 'Nhà',
      });
      await getPool().query(
        `insert into public.members (ledger_id, user_id, status) values ($1, $2, 'active')`,
        [ledger.id, member],
      );

      await service.leave(ledger.id, member);

      const members = await service.listMembers(ledger.id);
      const updated = members.find((m) => m.userId === member);
      expect(updated?.status).toBe('removed');
    });
  });

  describe('removeMember', () => {
    it('admin cannot be removed', async () => {
      const admin = await createTestUser('admin');
      const other = await createTestUser('other');
      const ledger = await service.create(admin, {
        kind: 'family',
        name: 'Nhà',
      });
      await getPool().query(
        `insert into public.members (ledger_id, user_id, status) values ($1, $2, 'active')`,
        [ledger.id, other],
      );

      await expect(
        service.removeMember(ledger.id, admin, admin),
      ).rejects.toThrow(ForbiddenException);
    });

    it('non-admin cannot remove a member', async () => {
      const admin = await createTestUser('admin');
      const member = await createTestUser('member');
      const other = await createTestUser('other');
      const ledger = await service.create(admin, {
        kind: 'family',
        name: 'Nhà',
      });
      await getPool().query(
        `insert into public.members (ledger_id, user_id, status) values ($1, $2, 'active')`,
        [ledger.id, member],
      );
      await getPool().query(
        `insert into public.members (ledger_id, user_id, status) values ($1, $2, 'active')`,
        [ledger.id, other],
      );

      await expect(
        service.removeMember(ledger.id, member, other),
      ).rejects.toThrow(ForbiddenException);
    });

    it('admin can remove a non-admin member, keeping the row (expenses stay attributed)', async () => {
      const admin = await createTestUser('admin');
      const member = await createTestUser('member');
      const ledger = await service.create(admin, {
        kind: 'family',
        name: 'Nhà',
      });
      await getPool().query(
        `insert into public.members (ledger_id, user_id, status) values ($1, $2, 'active')`,
        [ledger.id, member],
      );

      await service.removeMember(ledger.id, admin, member);

      const members = await service.listMembers(ledger.id);
      const removed = members.find((m) => m.userId === member);
      expect(removed).toBeDefined();
      expect(removed?.status).toBe('removed');
    });
  });

  describe('transferAdmin', () => {
    it('transferAdmin to non-member throws', async () => {
      const admin = await createTestUser('admin');
      const stranger = await createTestUser('stranger');
      const ledger = await service.create(admin, {
        kind: 'family',
        name: 'Nhà',
      });

      await expect(
        service.transferAdmin(ledger.id, admin, stranger),
      ).rejects.toThrow(NotFoundException);
    });

    it('transferAdmin then old admin can leave', async () => {
      const admin = await createTestUser('admin');
      const member = await createTestUser('member');
      const ledger = await service.create(admin, {
        kind: 'family',
        name: 'Nhà',
      });
      await getPool().query(
        `insert into public.members (ledger_id, user_id, status) values ($1, $2, 'active')`,
        [ledger.id, member],
      );

      await service.transferAdmin(ledger.id, admin, member);
      await service.leave(ledger.id, admin);

      const members = await service.listMembers(ledger.id);
      const oldAdmin = members.find((m) => m.userId === admin);
      expect(oldAdmin?.status).toBe('removed');
    });

    it('only the current admin can transfer admin', async () => {
      const admin = await createTestUser('admin');
      const member = await createTestUser('member');
      const other = await createTestUser('other');
      const ledger = await service.create(admin, {
        kind: 'family',
        name: 'Nhà',
      });
      await getPool().query(
        `insert into public.members (ledger_id, user_id, status) values ($1, $2, 'active')`,
        [ledger.id, member],
      );
      await getPool().query(
        `insert into public.members (ledger_id, user_id, status) values ($1, $2, 'active')`,
        [ledger.id, other],
      );

      await expect(
        service.transferAdmin(ledger.id, member, other),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('categories', () => {
    it('non-admin cannot add category', async () => {
      const admin = await createTestUser('admin');
      const member = await createTestUser('member');
      const ledger = await service.create(admin, {
        kind: 'family',
        name: 'Nhà',
      });
      await getPool().query(
        `insert into public.members (ledger_id, user_id, status) values ($1, $2, 'active')`,
        [ledger.id, member],
      );

      await expect(
        service.addCategory(ledger.id, member, { name: 'Du lịch' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('admin can add, update, and delete a category', async () => {
      const admin = await createTestUser('admin');
      const ledger = await service.create(admin, {
        kind: 'family',
        name: 'Nhà',
      });

      const created = await service.addCategory(ledger.id, admin, {
        name: 'Du lịch',
        icon: '✈️',
      });
      expect(created.name).toBe('Du lịch');

      const updated = await service.updateCategory(
        ledger.id,
        admin,
        created.id,
        { name: 'Du lịch & nghỉ dưỡng' },
      );
      expect(updated.name).toBe('Du lịch & nghỉ dưỡng');

      await service.deleteCategory(ledger.id, admin, created.id);
      const categories = await service.listCategories(ledger.id);
      expect(categories.find((c) => c.id === created.id)).toBeUndefined();
    });

    it('admin can add a sub-category under a parent category and prevents multi-level nesting', async () => {
      const admin = await createTestUser('admin-sub');
      const ledger = await service.create(admin, {
        kind: 'family',
        name: 'Nhà',
      });
      const parent = (await service.listCategories(ledger.id)).find(
        (c) => !c.parentId && c.name === 'Ăn uống',
      )!;

      const sub = await service.addCategory(ledger.id, admin, {
        name: 'Ăn vặt đêm',
        icon: '🌙',
        parentId: parent.id,
      });
      expect(sub.parentId).toBe(parent.id);

      await expect(
        service.addCategory(ledger.id, admin, {
          name: 'Cấp 3',
          parentId: sub.id,
        }),
      ).rejects.toThrow();
    });
  });
});

describe('MembershipGuard', () => {
  let guard: MembershipGuard;
  const supabase = fakeSupabaseService();

  beforeAll(() => {
    guard = new MembershipGuard(supabase, new Reflector());
  });

  afterAll(async () => {
    await resetDb();
    await getPool().end();
  });

  beforeEach(async () => {
    await resetDb();
  });

  it('removed member rejected by MembershipGuard', async () => {
    const admin = await createTestUser('admin');
    const member = await createTestUser('member');
    const service = new LedgersService(supabase);
    const ledger = await service.create(admin, {
      kind: 'family',
      name: 'Nhà',
    });
    await getPool().query(
      `insert into public.members (ledger_id, user_id, status) values ($1, $2, 'removed')`,
      [ledger.id, member],
    );

    const context = fakeContext({ ledgerId: ledger.id }, { id: member });

    await expect(guard.canActivate(context as any)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('allows an active member and sets request.member', async () => {
    const admin = await createTestUser('admin');
    const service = new LedgersService(supabase);
    const ledger = await service.create(admin, {
      kind: 'family',
      name: 'Nhà',
    });

    const context = fakeContext({ ledgerId: ledger.id }, { id: admin });

    await expect(guard.canActivate(context as any)).resolves.toBe(true);
    expect(context.request.member.userId).toBe(admin);
  });

  it('throws NotFoundException for an unknown ledger', async () => {
    const admin = await createTestUser('admin');
    const context = fakeContext(
      { ledgerId: '00000000-0000-0000-0000-000000000000' },
      { id: admin },
    );

    await expect(guard.canActivate(context as any)).rejects.toThrow(
      NotFoundException,
    );
  });
});
