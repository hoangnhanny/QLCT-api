import { ReportsService } from '../../src/reports/reports.service';
import { SupabaseService } from '../../src/supabase/supabase.service';

describe('ReportsService', () => {
  let service: ReportsService;
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      query: jest.fn(),
    };

    const mockSupabaseService = {
      db: mockDb,
    } as unknown as SupabaseService;

    service = new ReportsService(mockSupabaseService);
  });

  describe('monthly', () => {
    it('monthly total equals sum of byCategory and uncategorised appears with categoryId null', async () => {
      mockDb.query.mockImplementation((sql: string) => {
        if (sql.includes('SELECT coalesce(sum(e.amount), 0) as total')) {
          return Promise.resolve({ rows: [{ total: '350000' }] });
        }
        if (sql.includes('GROUP BY e.category_id')) {
          return Promise.resolve({
            rows: [
              {
                category_id: 'cat-food',
                category_name: 'Ăn uống',
                total: '200000',
              },
              { category_id: null, category_name: null, total: '150000' },
            ],
          });
        }
        if (sql.includes('GROUP BY e.created_by')) {
          return Promise.resolve({
            rows: [{ user_id: 'u-1', display_name: 'User 1', total: '350000' }],
          });
        }
        if (sql.includes('GROUP BY to_char(')) {
          return Promise.resolve({
            rows: [
              { date: '2026-11-01', total: '100000' },
              { date: '2026-11-05', total: '250000' },
            ],
          });
        }
        if (sql.includes('GROUP BY coalesce(e.payment_method')) {
          return Promise.resolve({
            rows: [
              { payment_method: 'transfer', total: '250000' },
              { payment_method: 'cash', total: '100000' },
            ],
          });
        }
        if (sql.includes('FROM public.budgets')) {
          return Promise.resolve({
            rows: [
              {
                id: 'b-1',
                ledger_id: 'ledger-1',
                member_user_id: null,
                category_id: null,
                month: '2026-11-01',
                amount: '1000000',
              },
            ],
          });
        }
        if (sql.includes('as spent') && sql.includes('FROM public.expenses')) {
          return Promise.resolve({ rows: [{ spent: '350000' }] });
        }
        return Promise.resolve({ rows: [] });
      });

      const report = await service.monthly('ledger-1', '2026-11');

      expect(report.total).toBe(350000);
      const catSum = report.byCategory.reduce((acc, c) => acc + c.total, 0);
      expect(catSum).toBe(report.total);

      const uncat = report.byCategory.find((c) => c.categoryId === null);
      expect(uncat).toBeDefined();
      expect(uncat?.total).toBe(150000);
      expect(report.budgets).toHaveLength(1);
      expect(report.budgets[0].spent).toBe(350000);
      expect(report.budgets[0].percent).toBe(35);
      expect(report.byPaymentMethod).toEqual([
        { paymentMethod: 'transfer', total: 250000 },
        { paymentMethod: 'cash', total: 100000 },
      ]);
    });

    it("removed member's expenses still counted with their name", async () => {
      mockDb.query.mockImplementation((sql: string) => {
        if (sql.includes('SELECT coalesce(sum(e.amount), 0) as total')) {
          return Promise.resolve({ rows: [{ total: '500000' }] });
        }
        if (sql.includes('GROUP BY e.created_by')) {
          return Promise.resolve({
            rows: [
              {
                user_id: 'removed-user-id',
                display_name: 'Nguyen Van Removed',
                total: '500000',
              },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const report = await service.monthly('ledger-1', '2026-11');
      expect(report.byMember).toHaveLength(1);
      expect(report.byMember[0].userId).toBe('removed-user-id');
      expect(report.byMember[0].displayName).toBe('Nguyen Van Removed');
      expect(report.byMember[0].total).toBe(500000);
    });

    it('filter by userId narrows total and appends condition', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });

      await service.monthly('ledger-1', '2026-11', { userId: 'user-specific' });

      expect(mockDb.query).toHaveBeenCalled();
      const totalCall = mockDb.query.mock.calls.find(([sql]: [string]) =>
        sql.includes('sum(e.amount)'),
      );
      expect(totalCall[0]).toContain('e.created_by =');
      expect(totalCall[1]).toContain('user-specific');
    });
  });

  describe('range', () => {
    it('aggregates expenses by bucket', async () => {
      mockDb.query.mockResolvedValue({
        rows: [
          { bucket: '2026-11-01', total: '100000' },
          { bucket: '2026-11-02', total: '150000' },
        ],
      });

      const res = await service.range(
        'ledger-1',
        '2026-11-01',
        '2026-11-10',
        'day',
      );
      expect(res).toEqual([
        { bucket: '2026-11-01', total: 100000 },
        { bucket: '2026-11-02', total: 150000 },
      ]);
    });
  });
});
