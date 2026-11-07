import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ExpensesService } from '../../src/expenses/expenses.service';
import { SupabaseService } from '../../src/supabase/supabase.service';

describe('ExpensesService', () => {
  let service: ExpensesService;
  let mockDb: any;
  let mockClient: any;
  let mockAlertsService: any;

  beforeEach(() => {
    mockClient = {
      query: jest.fn(),
      release: jest.fn(),
    };

    mockDb = {
      connect: jest.fn().mockResolvedValue(mockClient),
      query: jest.fn(),
    };

    const mockSupabaseService = {
      db: mockDb,
    } as unknown as SupabaseService;

    mockAlertsService = {
      evaluate: jest.fn().mockResolvedValue(undefined),
    };

    service = new ExpensesService(
      mockSupabaseService,
      mockAlertsService as any,
    );
  });

  describe('createBatch', () => {
    it('rejects income on family ledgers', async () => {
      mockClient.query.mockResolvedValue({ rows: [{ kind: 'family' }] });
      const item = { amount: 100000, content: 'Thu', type: 'income' as const };
      await expect(
        service.createBatch('ledger-1', 'user-1', [item]),
      ).rejects.toThrow(BadRequestException);
    });

    it('persists business income separately and does not trigger expense alerts', async () => {
      mockClient.query.mockImplementation((sql: string) =>
        Promise.resolve({
          rows: sql.includes('public.ledgers')
            ? [{ kind: 'business' }]
            : [{ id: 'income-1' }],
        }),
      );
      mockDb.query.mockResolvedValue({
        rows: [
          {
            id: 'income-1',
            ledger_id: 'ledger-1',
            created_by: 'user-1',
            amount: 100000,
            content: 'Doanh thu',
            type: 'income',
            spent_at: new Date(),
            created_at: new Date(),
          },
        ],
      });
      const item = {
        amount: 100000,
        content: 'Doanh thu',
        type: 'income' as const,
      };
      const result = await service.createBatch('ledger-1', 'user-1', [item]);
      expect(result[0]).toMatchObject({ type: 'income', amount: 100000 });
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO public.expenses'),
        expect.arrayContaining(['income']),
      );
      expect(mockAlertsService.evaluate).not.toHaveBeenCalled();
    });

    it('rejects amount <= 0', async () => {
      await expect(
        service.createBatch('ledger-1', 'user-1', [
          { amount: 0, content: 'Invalid' },
        ]),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects empty content', async () => {
      await expect(
        service.createBatch('ledger-1', 'user-1', [
          { amount: 50000, content: '   ' },
        ]),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects category from another ledger', async () => {
      // Mock category lookup returning no matching category for this ledger
      mockClient.query.mockImplementation((sql: string) => {
        if (sql.includes('public.categories')) {
          return Promise.resolve({ rows: [] }); // category not found in ledger-1
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(
        service.createBatch('ledger-1', 'user-1', [
          { amount: 50000, content: 'Lunch', categoryId: 'foreign-cat' },
        ]),
      ).rejects.toThrow(BadRequestException);
    });

    it('is atomic when one item in the batch is invalid (rolls back)', async () => {
      mockClient.query.mockImplementation((sql: string) => {
        if (sql === 'BEGIN') return Promise.resolve();
        if (sql.includes('public.categories')) {
          return Promise.resolve({ rows: [{ id: 'valid-cat' }] });
        }
        return Promise.resolve({ rows: [] });
      });

      // Item 1 is valid, item 2 has amount <= 0
      await expect(
        service.createBatch('ledger-1', 'user-1', [
          { amount: 50000, content: 'Lunch', categoryId: 'valid-cat' },
          { amount: -100, content: 'Invalid' },
        ]),
      ).rejects.toThrow(BadRequestException);

      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('createBatch triggers alerts evaluation', async () => {
      mockClient.query.mockImplementation((sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') return Promise.resolve();
        if (sql.includes('INSERT INTO public.expenses')) {
          return Promise.resolve({ rows: [{ id: 'new-exp' }] });
        }
        return Promise.resolve({ rows: [] });
      });
      mockDb.query.mockResolvedValue({
        rows: [
          {
            id: 'new-exp',
            ledger_id: 'ledger-1',
            created_by: 'user-1',
            amount: 50000,
            content: 'Lunch',
            spent_at: new Date('2026-11-05T00:00:00Z'),
            created_at: new Date(),
          },
        ],
      });

      await service.createBatch('ledger-1', 'user-1', [
        { amount: 50000, content: 'Lunch', spentAt: '2026-11-05T00:00:00Z' },
      ]);

      expect(mockAlertsService.evaluate).toHaveBeenCalledWith(
        'ledger-1',
        '2026-11-01',
        ['user-1'],
      );
    });
  });

  describe('update', () => {
    it('editing an expense never triggers alerts', async () => {
      mockDb.query.mockImplementation((sql: string) => {
        if (
          sql.includes('SELECT * FROM public.expenses') ||
          sql.includes('UPDATE public.expenses') ||
          sql.includes('WHERE e.id = $1')
        ) {
          return Promise.resolve({
            rows: [
              {
                id: 'exp-1',
                ledger_id: 'ledger-1',
                created_by: 'creator-user',
                amount: 10000,
                content: 'Test',
                spent_at: new Date(),
                created_at: new Date(),
              },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      await service.update('ledger-1', 'creator-user', 'exp-1', {
        amount: 50000,
      });
      expect(mockAlertsService.evaluate).not.toHaveBeenCalled();
    });
    it('rejects update if caller is not creator (ForbiddenException)', async () => {
      mockDb.query.mockImplementation((sql: string) => {
        if (sql.includes('SELECT * FROM public.expenses')) {
          return Promise.resolve({
            rows: [
              {
                id: 'exp-1',
                ledger_id: 'ledger-1',
                created_by: 'original-creator',
                amount: 10000,
                content: 'Test',
              },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(
        service.update('ledger-1', 'different-user', 'exp-1', {
          amount: 20000,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException if expense does not exist in ledger', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });

      await expect(
        service.update('ledger-1', 'user-1', 'non-existent', {
          content: 'Updated',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('rejects deletion if caller is not creator (ForbiddenException)', async () => {
      mockDb.query.mockResolvedValue({
        rows: [
          {
            id: 'exp-1',
            ledger_id: 'ledger-1',
            created_by: 'creator-user',
          },
        ],
      });

      await expect(
        service.remove('ledger-1', 'other-user', 'exp-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows deletion if caller is creator', async () => {
      mockDb.query.mockImplementation((sql: string) => {
        if (sql.includes('SELECT * FROM public.expenses')) {
          return Promise.resolve({
            rows: [
              {
                id: 'exp-1',
                ledger_id: 'ledger-1',
                created_by: 'creator-user',
              },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(
        service.remove('ledger-1', 'creator-user', 'exp-1'),
      ).resolves.toBeUndefined();
      expect(mockAlertsService.evaluate).not.toHaveBeenCalled();
    });

    it('deleting an expense never triggers alerts', async () => {
      mockDb.query.mockImplementation((sql: string) => {
        if (sql.includes('SELECT * FROM public.expenses')) {
          return Promise.resolve({
            rows: [
              {
                id: 'exp-1',
                ledger_id: 'ledger-1',
                created_by: 'creator-user',
              },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      await service.remove('ledger-1', 'creator-user', 'exp-1');
      expect(mockAlertsService.evaluate).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('filters by month, category, user', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });

      await service.list('ledger-1', {
        month: '2026-11',
        categoryId: 'cat-1',
        userId: 'user-1',
      });

      expect(mockDb.query).toHaveBeenCalled();
      const [sql, params] = mockDb.query.mock.calls[0];
      expect(sql).toContain('e.ledger_id = $1');
      expect(sql).toContain('e.spent_at >=');
      expect(sql).toContain('e.spent_at <');
      expect(sql).toContain('e.category_id =');
      expect(sql).toContain('e.created_by =');
      expect(params).toContain('ledger-1');
      expect(params).toContain('cat-1');
      expect(params).toContain('user-1');
    });
  });
});
