import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { BudgetsService } from '../../src/budgets/budgets.service';
import { SupabaseService } from '../../src/supabase/supabase.service';

describe('BudgetsService', () => {
  let service: BudgetsService;
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      query: jest.fn(),
    };

    const mockSupabaseService = {
      db: mockDb,
    } as unknown as SupabaseService;

    service = new BudgetsService(mockSupabaseService);
  });

  describe('upsert', () => {
    it('member cannot upsert (ForbiddenException if not admin)', async () => {
      // Mock ledger lookup returning admin_id !== caller
      mockDb.query.mockImplementation((sql: string) => {
        if (sql.includes('public.ledgers')) {
          return Promise.resolve({
            rows: [{ id: 'ledger-1', admin_id: 'real-admin' }],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(
        service.upsert('ledger-1', 'not-admin', {
          month: '2026-11-01',
          amount: 5000000,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects amount <= 0 (BadRequestException)', async () => {
      mockDb.query.mockImplementation((sql: string) => {
        if (sql.includes('public.ledgers')) {
          return Promise.resolve({
            rows: [{ id: 'ledger-1', admin_id: 'admin-1' }],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(
        service.upsert('ledger-1', 'admin-1', {
          month: '2026-11-01',
          amount: 0,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('member budget requires active member', async () => {
      mockDb.query.mockImplementation((sql: string) => {
        if (sql.includes('public.ledgers')) {
          return Promise.resolve({
            rows: [{ id: 'ledger-1', admin_id: 'admin-1' }],
          });
        }
        if (sql.includes('public.members')) {
          // Member not found or inactive
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(
        service.upsert('ledger-1', 'admin-1', {
          memberUserId: 'non-member-user',
          month: '2026-11-01',
          amount: 1000000,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('category budget requires category belonging to ledger', async () => {
      mockDb.query.mockImplementation((sql: string) => {
        if (sql.includes('public.ledgers')) {
          return Promise.resolve({
            rows: [{ id: 'ledger-1', admin_id: 'admin-1' }],
          });
        }
        if (sql.includes('public.categories')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(
        service.upsert('ledger-1', 'admin-1', {
          categoryId: 'foreign-category',
          month: '2026-11-01',
          amount: 1000000,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('upsert twice same key updates amount', async () => {
      const budgetRow = {
        id: 'b-1',
        ledger_id: 'ledger-1',
        member_user_id: null,
        category_id: null,
        month: new Date('2026-11-01T00:00:00Z'),
        amount: '3000000',
        created_at: new Date(),
        category_name: null,
        category_icon: null,
        member_display_name: null,
        member_avatar_url: null,
      };

      mockDb.query.mockImplementation((sql: string) => {
        if (sql.includes('public.ledgers')) {
          return Promise.resolve({
            rows: [{ id: 'ledger-1', admin_id: 'admin-1' }],
          });
        }
        if (
          sql.includes('INSERT INTO public.budgets') ||
          sql.includes('FROM public.budgets')
        ) {
          return Promise.resolve({
            rows: [budgetRow],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const result = await service.upsert('ledger-1', 'admin-1', {
        month: '2026-11',
        amount: 3000000,
      });

      expect(result.id).toBe('b-1');
      expect(result.amount).toBe(3000000);
      expect(result.month).toBe('2026-11-01');
      expect(
        mockDb.query.mock.calls.some(
          ([sql]: [string]) =>
            sql.includes('ON CONFLICT') && sql.includes('DO UPDATE'),
        ),
      ).toBe(true);
    });
  });

  describe('list', () => {
    it('list returns ledger and member budgets', async () => {
      mockDb.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM public.budgets')) {
          return Promise.resolve({
            rows: [
              {
                id: 'b-total',
                ledger_id: 'ledger-1',
                member_user_id: null,
                category_id: null,
                month: new Date('2026-11-01T00:00:00Z'),
                amount: '10000000',
                created_at: new Date(),
                category_name: null,
                category_icon: null,
                member_display_name: null,
                member_avatar_url: null,
              },
              {
                id: 'b-member',
                ledger_id: 'ledger-1',
                member_user_id: 'user-2',
                category_id: null,
                month: new Date('2026-11-01T00:00:00Z'),
                amount: '3000000',
                created_at: new Date(),
                category_name: null,
                category_icon: null,
                member_display_name: 'Member 2',
                member_avatar_url: null,
              },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const budgets = await service.list('ledger-1', '2026-11');
      expect(budgets).toHaveLength(2);
      expect(budgets[0].id).toBe('b-total');
      expect(budgets[0].memberUserId).toBeNull();
      expect(budgets[0].amount).toBe(10000000);
      expect(budgets[1].id).toBe('b-member');
      expect(budgets[1].memberUserId).toBe('user-2');
      expect(budgets[1].member?.displayName).toBe('Member 2');
    });
  });

  describe('remove', () => {
    it('non-admin cannot remove budget (ForbiddenException)', async () => {
      mockDb.query.mockImplementation((sql: string) => {
        if (sql.includes('public.ledgers')) {
          return Promise.resolve({
            rows: [{ id: 'ledger-1', admin_id: 'admin-1' }],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(
        service.remove('ledger-1', 'non-admin', 'b-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException if budget does not exist in ledger', async () => {
      mockDb.query.mockImplementation((sql: string) => {
        if (sql.includes('public.ledgers')) {
          return Promise.resolve({
            rows: [{ id: 'ledger-1', admin_id: 'admin-1' }],
          });
        }
        if (sql.includes('DELETE FROM public.budgets')) {
          return Promise.resolve({ rowCount: 0 });
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(
        service.remove('ledger-1', 'admin-1', 'non-existent-b'),
      ).rejects.toThrow(NotFoundException);
    });

    it('admin successfully removes budget', async () => {
      mockDb.query.mockImplementation((sql: string) => {
        if (sql.includes('public.ledgers')) {
          return Promise.resolve({
            rows: [{ id: 'ledger-1', admin_id: 'admin-1' }],
          });
        }
        if (sql.includes('DELETE FROM public.budgets')) {
          return Promise.resolve({ rowCount: 1 });
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(
        service.remove('ledger-1', 'admin-1', 'b-1'),
      ).resolves.toBeUndefined();
    });
  });
});
