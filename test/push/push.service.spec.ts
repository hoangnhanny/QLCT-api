import { getApps, initializeApp } from 'firebase-admin/app';
import * as webpush from 'web-push';
import { PushService } from '../../src/push/push.service';
import { SupabaseService } from '../../src/supabase/supabase.service';

const mockSendEachForMulticast = jest.fn();

jest.mock('web-push');
jest.mock('firebase-admin/app', () => ({
  getApps: jest.fn(() => []),
  initializeApp: jest.fn(),
  cert: jest.fn((sa) => sa),
}));
jest.mock('firebase-admin/messaging', () => ({
  getMessaging: jest.fn(() => ({
    sendEachForMulticast: mockSendEachForMulticast,
  })),
}));

describe('PushService', () => {
  let service: PushService;
  let mockDb: any;

  beforeEach(() => {
    jest.clearAllMocks();
    (getApps as jest.Mock).mockReturnValue([]);

    mockDb = {
      query: jest.fn(),
    };

    const mockSupabaseService = {
      db: mockDb,
    } as unknown as SupabaseService;

    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_CLIENT_EMAIL;
    delete process.env.FIREBASE_PRIVATE_KEY;
    process.env.VAPID_PUBLIC_KEY = 'test-vapid-public-key';
    process.env.VAPID_PRIVATE_KEY = 'test-vapid-private-key';
    process.env.VAPID_SUBJECT = 'mailto:test@example.com';

    service = new PushService(mockSupabaseService);
  });

  describe('getPublicKey', () => {
    it('returns the configured VAPID public key', () => {
      expect(service.getPublicKey()).toBe('test-vapid-public-key');
    });

    it('reports Firebase enabled when Firebase Admin is configured', () => {
      process.env.FIREBASE_PROJECT_ID = 'qlct-test';
      process.env.FIREBASE_CLIENT_EMAIL =
        'bot@qlct-test.iam.gserviceaccount.com';
      process.env.FIREBASE_PRIVATE_KEY =
        '-----BEGIN PRIVATE KEY-----\\nkey\\n-----END PRIVATE KEY-----\\n';

      expect(service.isFirebaseEnabled()).toBe(true);
    });
  });

  describe('subscribe', () => {
    it('subscribe same endpoint twice keeps one row (upsert by endpoint)', async () => {
      mockDb.query.mockResolvedValue({ rowCount: 1 });

      await service.subscribe('user-1', {
        endpoint: 'https://push.example.com/sub/123',
        keys: {
          p256dh: 'p256dh-key',
          auth: 'auth-secret',
        },
      });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT (endpoint) DO UPDATE'),
        [
          'user-1',
          'https://push.example.com/sub/123',
          'p256dh-key',
          'auth-secret',
        ],
      );
    });

    it('stores FCM token with fcm: prefix', async () => {
      mockDb.query.mockResolvedValue({ rowCount: 1 });

      await service.subscribe('user-1', {
        token: 'fcm-device-token-123',
      });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT (endpoint) DO UPDATE'),
        ['user-1', 'fcm:fcm-device-token-123', 'fcm', 'fcm'],
      );
    });
  });

  describe('unsubscribe', () => {
    it('deletes subscription for the user and endpoint', async () => {
      mockDb.query.mockResolvedValue({ rowCount: 1 });

      await service.unsubscribe('user-1', 'https://push.example.com/sub/123');

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM public.push_subscriptions'),
        ['user-1', ['https://push.example.com/sub/123']],
      );
    });

    it('deletes FCM subscription for either prefixed or raw token', async () => {
      mockDb.query.mockResolvedValue({ rowCount: 1 });

      await service.unsubscribe('user-1', 'fcm-device-token-123');

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM public.push_subscriptions'),
        ['user-1', ['fcm:fcm-device-token-123', 'fcm-device-token-123']],
      );
    });
  });

  describe('send', () => {
    it('send delivers to all subscriptions of listed users', async () => {
      mockDb.query.mockImplementation((sql: string) => {
        if (
          sql.includes('SELECT') &&
          sql.includes('FROM public.push_subscriptions')
        ) {
          return Promise.resolve({
            rows: [
              {
                id: 'sub-1',
                user_id: 'user-1',
                endpoint: 'https://push.example.com/1',
                p256dh: 'k1',
                auth: 'a1',
              },
              {
                id: 'sub-2',
                user_id: 'user-2',
                endpoint: 'https://push.example.com/2',
                p256dh: 'k2',
                auth: 'a2',
              },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      (webpush.sendNotification as jest.Mock).mockResolvedValue({});

      await service.send(['user-1', 'user-2'], {
        title: 'Cảnh báo hạn mức',
        body: 'Đã đạt 80% hạn mức',
        url: '/ledger-1',
      });

      expect(webpush.sendNotification).toHaveBeenCalledTimes(2);
      expect(webpush.sendNotification).toHaveBeenCalledWith(
        {
          endpoint: 'https://push.example.com/1',
          keys: { p256dh: 'k1', auth: 'a1' },
        },
        JSON.stringify({
          title: 'Cảnh báo hạn mức',
          body: 'Đã đạt 80% hạn mức',
          url: '/ledger-1',
        }),
      );
    });

    it('410 response deletes the subscription', async () => {
      mockDb.query.mockImplementation((sql: string) => {
        if (
          sql.includes('SELECT') &&
          sql.includes('FROM public.push_subscriptions')
        ) {
          return Promise.resolve({
            rows: [
              {
                id: 'sub-1',
                user_id: 'user-1',
                endpoint: 'https://push.example.com/expired-410',
                p256dh: 'k1',
                auth: 'a1',
              },
            ],
          });
        }
        if (sql.includes('DELETE FROM public.push_subscriptions')) {
          return Promise.resolve({ rowCount: 1 });
        }
        return Promise.resolve({ rows: [] });
      });

      const error410: any = new Error('Gone');
      error410.statusCode = 410;
      (webpush.sendNotification as jest.Mock).mockRejectedValue(error410);

      await service.send(['user-1'], {
        title: 'Title',
        body: 'Body',
        url: '/url',
      });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining(
          'DELETE FROM public.push_subscriptions WHERE endpoint = $1',
        ),
        ['https://push.example.com/expired-410'],
      );
    });

    it('404 response deletes the subscription', async () => {
      mockDb.query.mockImplementation((sql: string) => {
        if (
          sql.includes('SELECT') &&
          sql.includes('FROM public.push_subscriptions')
        ) {
          return Promise.resolve({
            rows: [
              {
                id: 'sub-2',
                user_id: 'user-2',
                endpoint: 'https://push.example.com/notfound-404',
                p256dh: 'k2',
                auth: 'a2',
              },
            ],
          });
        }
        if (sql.includes('DELETE FROM public.push_subscriptions')) {
          return Promise.resolve({ rowCount: 1 });
        }
        return Promise.resolve({ rows: [] });
      });

      const error404: any = new Error('Not Found');
      error404.statusCode = 404;
      (webpush.sendNotification as jest.Mock).mockRejectedValue(error404);

      await service.send(['user-2'], {
        title: 'Title',
        body: 'Body',
        url: '/url',
      });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining(
          'DELETE FROM public.push_subscriptions WHERE endpoint = $1',
        ),
        ['https://push.example.com/notfound-404'],
      );
    });

    it('sends FCM subscriptions via Firebase Admin and deletes stale tokens', async () => {
      process.env.FIREBASE_PROJECT_ID = 'qlct-test';
      process.env.FIREBASE_CLIENT_EMAIL =
        'bot@qlct-test.iam.gserviceaccount.com';
      process.env.FIREBASE_PRIVATE_KEY =
        '-----BEGIN PRIVATE KEY-----\\nkey\\n-----END PRIVATE KEY-----\\n';

      mockDb.query.mockImplementation((sql: string) => {
        if (
          sql.includes('SELECT') &&
          sql.includes('FROM public.push_subscriptions')
        ) {
          return Promise.resolve({
            rows: [
              {
                id: 'sub-fcm-1',
                user_id: 'user-1',
                endpoint: 'fcm:token-valid',
                p256dh: 'fcm',
                auth: 'fcm',
              },
              {
                id: 'sub-fcm-2',
                user_id: 'user-2',
                endpoint: 'fcm:token-stale',
                p256dh: 'fcm',
                auth: 'fcm',
              },
            ],
          });
        }
        return Promise.resolve({ rowCount: 1, rows: [] });
      });

      mockSendEachForMulticast.mockResolvedValue({
        successCount: 1,
        failureCount: 1,
        responses: [
          { success: true, messageId: 'msg-1' },
          {
            success: false,
            error: {
              code: 'messaging/registration-token-not-registered',
            },
          },
        ],
      });

      await service.send(['user-1', 'user-2'], {
        title: 'Vượt hạn mức chi tiêu',
        body: 'Đi lại vượt hạn mức',
        url: '/ledger-1/budgets',
      });

      expect(initializeApp).toHaveBeenCalledTimes(1);
      expect(mockSendEachForMulticast).toHaveBeenCalledWith(
        expect.objectContaining({
          tokens: ['token-valid', 'token-stale'],
          notification: {
            title: 'Vượt hạn mức chi tiêu',
            body: 'Đi lại vượt hạn mức',
          },
          data: {
            title: 'Vượt hạn mức chi tiêu',
            body: 'Đi lại vượt hạn mức',
            url: '/ledger-1/budgets',
          },
        }),
      );

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining(
          'DELETE FROM public.push_subscriptions WHERE endpoint = $1',
        ),
        ['fcm:token-stale'],
      );
    });
  });
});
