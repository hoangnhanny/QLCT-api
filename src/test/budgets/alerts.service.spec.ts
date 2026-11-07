import { AlertsService } from '../../src/budgets/alerts.service';
import { PushService } from '../../src/push/push.service';
import { SupabaseService } from '../../src/supabase/supabase.service';

describe('AlertsService', () => {
  let service: AlertsService;
  let mockDb: any;
  let mockPushService: any;

  beforeEach(() => {
    mockDb = {
      query: jest.fn(),
    };

    const mockSupabaseService = {
      db: mockDb,
    } as unknown as SupabaseService;

    mockPushService = {
      send: jest.fn().mockResolvedValue(undefined),
    };

    service = new AlertsService(mockSupabaseService, mockPushService as PushService);
  });

  it('evaluates budgets and sends alert when threshold reached (80%)', async () => {
    // 1. Ledger lookup
    // 2. Budgets lookup
    // 3. Active members lookup
    // 4. Spent lookup
    // 5. Insert budget_alerts ON CONFLICT DO NOTHING RETURNING id
    mockDb.query.mockImplementation((sql: string) => {
      if (sql.includes('SELECT admin_id FROM public.ledgers')) {
        return Promise.resolve({ rows: [{ admin_id: 'admin-1' }] });
      }
      if (sql.includes('SELECT * FROM public.budgets') || sql.includes('FROM public.budgets')) {
        return Promise.resolve({
          rows: [
            {
              id: 'budget-ledger-total',
              ledger_id: 'ledger-1',
              member_user_id: null,
              category_id: null,
              month: '2026-11-01',
              amount: 1000000,
            },
          ],
        });
      }
      if (sql.includes('SELECT user_id FROM public.members')) {
        return Promise.resolve({
          rows: [{ user_id: 'admin-1' }, { user_id: 'member-2' }],
        });
      }
      if (sql.includes('SUM(amount)') || sql.includes('SELECT coalesce(sum(amount)')) {
        return Promise.resolve({
          rows: [{ spent: '850000' }], // 85% of 1,000,000
        });
      }
      if (sql.includes('INSERT INTO public.budget_alerts')) {
        return Promise.resolve({
          rows: [{ id: 'alert-1' }], // successfully inserted
        });
      }
      return Promise.resolve({ rows: [] });
    });

    await service.evaluate('ledger-1', '2026-11-01', ['admin-1']);

    expect(mockPushService.send).toHaveBeenCalledTimes(1);
    expect(mockPushService.send).toHaveBeenCalledWith(
      expect.arrayContaining(['admin-1', 'member-2']),
      expect.objectContaining({
        title: expect.any(String),
        body: expect.stringContaining('80%'),
      }),
    );
  });

  it('evaluates and sends once per threshold per month (conflict returns no rows -> no push)', async () => {
    mockDb.query.mockImplementation((sql: string) => {
      if (sql.includes('SELECT admin_id FROM public.ledgers')) {
        return Promise.resolve({ rows: [{ admin_id: 'admin-1' }] });
      }
      if (sql.includes('FROM public.budgets')) {
        return Promise.resolve({
          rows: [
            {
              id: 'budget-ledger-total',
              ledger_id: 'ledger-1',
              member_user_id: null,
              category_id: null,
              month: '2026-11-01',
              amount: 1000000,
            },
          ],
        });
      }
      if (sql.includes('SELECT user_id FROM public.members')) {
        return Promise.resolve({ rows: [{ user_id: 'admin-1' }] });
      }
      if (sql.includes('sum(amount)')) {
        return Promise.resolve({ rows: [{ spent: '850000' }] });
      }
      if (sql.includes('INSERT INTO public.budget_alerts')) {
        return Promise.resolve({ rows: [] }); // ON CONFLICT DO NOTHING -> 0 rows returned
      }
      return Promise.resolve({ rows: [] });
    });

    await service.evaluate('ledger-1', '2026-11-01', ['admin-1']);

    expect(mockPushService.send).not.toHaveBeenCalled();
  });

  it('member-level breach notifies that member and admin only', async () => {
    mockDb.query.mockImplementation((sql: string) => {
      if (sql.includes('SELECT admin_id FROM public.ledgers')) {
        return Promise.resolve({ rows: [{ admin_id: 'admin-1' }] });
      }
      if (sql.includes('FROM public.budgets')) {
        return Promise.resolve({
          rows: [
            {
              id: 'budget-member-total',
              ledger_id: 'ledger-1',
              member_user_id: 'member-3',
              category_id: null,
              month: '2026-11-01',
              amount: 500000,
            },
          ],
        });
      }
      if (sql.includes('SELECT user_id FROM public.members')) {
        return Promise.resolve({
          rows: [{ user_id: 'admin-1' }, { user_id: 'member-2' }, { user_id: 'member-3' }],
        });
      }
      if (sql.includes('sum(amount)')) {
        return Promise.resolve({ rows: [{ spent: '500000' }] }); // 100%
      }
      if (sql.includes('INSERT INTO public.budget_alerts')) {
        return Promise.resolve({ rows: [{ id: 'alert-1' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    await service.evaluate('ledger-1', '2026-11-01', ['member-3']);

    // Should notify admin-1 and member-3, but NOT member-2
    expect(mockPushService.send).toHaveBeenCalled();
    const calledUserIds = mockPushService.send.mock.calls[0][0];
    expect(calledUserIds).toContain('admin-1');
    expect(calledUserIds).toContain('member-3');
    expect(calledUserIds).not.toContain('member-2');
  });

  it('uncategorised expense does not affect category budget', async () => {
    // When category_id is set on budget, sum query must filter category_id = $catId
    mockDb.query.mockImplementation((sql: string) => {
      if (sql.includes('SELECT admin_id FROM public.ledgers')) {
        return Promise.resolve({ rows: [{ admin_id: 'admin-1' }] });
      }
      if (sql.includes('FROM public.budgets')) {
        return Promise.resolve({
          rows: [
            {
              id: 'budget-category',
              ledger_id: 'ledger-1',
              member_user_id: null,
              category_id: 'cat-food',
              month: '2026-11-01',
              amount: 500000,
            },
          ],
        });
      }
      if (sql.includes('sum(amount)')) {
        // Query should include category_id
        expect(sql).toContain('category_id =');
        return Promise.resolve({ rows: [{ spent: '100000' }] }); // Only 20%
      }
      return Promise.resolve({ rows: [] });
    });

    await service.evaluate('ledger-1', '2026-11-01', ['admin-1']);

    // No threshold reached -> no push
    expect(mockPushService.send).not.toHaveBeenCalled();
  });
});
