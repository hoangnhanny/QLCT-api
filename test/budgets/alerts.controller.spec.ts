import { AlertsController } from '../../src/budgets/alerts.controller';
import { AlertsService } from '../../src/budgets/alerts.service';

describe('AlertsController', () => {
  it('delegates list to AlertsService.listForUser with current user and query filters', async () => {
    const mockAlertsService = {
      listForUser: jest.fn().mockResolvedValue([{ id: 'a1' }]),
    } as unknown as AlertsService;

    const controller = new AlertsController(mockAlertsService);
    const result = await controller.list(
      { id: 'user-1', email: 'u@example.com' } as any,
      { ledgerId: 'ledger-1', month: '2026-11' },
    );

    expect(mockAlertsService.listForUser).toHaveBeenCalledWith('user-1', {
      ledgerId: 'ledger-1',
      month: '2026-11',
    });
    expect(result).toEqual([{ id: 'a1' }]);
  });
});
