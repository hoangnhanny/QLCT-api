import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  cert,
  getApps,
  initializeApp,
  ServiceAccount,
} from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { In, Repository } from 'typeorm';
import * as webpush from 'web-push';
import { SupabaseService } from '../supabase/supabase.service';
import { PushSubscription as PushSubscriptionEntity } from '../database/entities/push-subscription.entity';

export interface PushPayload {
  title: string;
  body: string;
  url: string;
}

export type PushSubscriptionItem =
  | {
      token: string;
      endpoint?: string;
      keys?: {
        p256dh: string;
        auth: string;
      };
    }
  | {
      token?: string;
      endpoint: string;
      keys: {
        p256dh: string;
        auth: string;
      };
    };

const FCM_PREFIX = 'fcm:';
const STALE_FCM_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private readonly legacyDb?: {
    query: (sql: string, params?: any[]) => Promise<any>;
  };
  private readonly pushRepo?: Repository<PushSubscriptionEntity>;

  constructor(
    @InjectRepository(PushSubscriptionEntity)
    pushRepoOrSupabase:
      Repository<PushSubscriptionEntity> | SupabaseService | any,
  ) {
    if (pushRepoOrSupabase?.db) {
      this.legacyDb = pushRepoOrSupabase.db;
    } else {
      this.pushRepo = pushRepoOrSupabase as Repository<PushSubscriptionEntity>;
    }
  }

  onModuleInit() {
    this.configureFirebase();
    this.configureVapid();
  }

  private resolveFirebaseServiceAccount(): ServiceAccount | null {
    const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (rawJson) {
      try {
        const decoded = rawJson.trim().startsWith('{')
          ? rawJson
          : Buffer.from(rawJson, 'base64').toString('utf8');
        const parsed = JSON.parse(decoded) as ServiceAccount & {
          private_key?: string;
          client_email?: string;
          project_id?: string;
        };
        if (parsed.private_key) {
          parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
        }
        return parsed;
      } catch (err) {
        this.logger.warn('Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON', err);
      }
    }

    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (projectId && clientEmail && privateKey) {
      return {
        projectId,
        clientEmail,
        privateKey,
      };
    }

    return null;
  }

  private configureFirebase(): boolean {
    if (getApps().length > 0) {
      return true;
    }

    const serviceAccount = this.resolveFirebaseServiceAccount();
    if (!serviceAccount) {
      return false;
    }

    try {
      initializeApp({
        credential: cert(serviceAccount),
      });
      return true;
    } catch (err) {
      this.logger.warn('Failed to initialize Firebase Admin SDK', err);
      return false;
    }
  }

  private configureVapid() {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT ?? 'mailto:admin@example.com';

    if (publicKey && privateKey) {
      try {
        webpush.setVapidDetails(subject, publicKey, privateKey);
      } catch (err) {
        this.logger.warn('Failed to configure VAPID details', err);
      }
    }
  }

  isFirebaseEnabled(): boolean {
    return (
      getApps().length > 0 || Boolean(this.resolveFirebaseServiceAccount())
    );
  }

  getPublicKey(): string {
    return process.env.VAPID_PUBLIC_KEY ?? '';
  }

  private normalizeSubscription(sub: PushSubscriptionItem): {
    endpoint: string;
    p256dh: string;
    auth: string;
  } {
    if (sub.token) {
      const endpoint = sub.token.startsWith(FCM_PREFIX)
        ? sub.token
        : `${FCM_PREFIX}${sub.token}`;
      return {
        endpoint,
        p256dh: 'fcm',
        auth: 'fcm',
      };
    }

    return {
      endpoint: sub.endpoint!,
      p256dh: sub.keys!.p256dh,
      auth: sub.keys!.auth,
    };
  }

  private async deleteSubscriptionByEndpoint(endpoint: string): Promise<void> {
    if (this.legacyDb) {
      await this.legacyDb
        .query(`DELETE FROM public.push_subscriptions WHERE endpoint = $1`, [
          endpoint,
        ])
        .catch(() => {});
    } else if (this.pushRepo) {
      await this.pushRepo.delete({ endpoint }).catch(() => {});
    }
  }

  /**
   * Upserts a push subscription (FCM token or standard Web Push endpoint) for the user.
   */
  async subscribe(userId: string, sub: PushSubscriptionItem): Promise<void> {
    const normalized = this.normalizeSubscription(sub);

    if (this.legacyDb) {
      await this.legacyDb.query(
        `INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4) ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
        [userId, normalized.endpoint, normalized.p256dh, normalized.auth],
      );
      return;
    }

    await this.pushRepo!.upsert(
      {
        userId,
        endpoint: normalized.endpoint,
        p256dh: normalized.p256dh,
        auth: normalized.auth,
      },
      ['endpoint'],
    );
  }

  /**
   * Removes a subscription by user and endpoint (or FCM token).
   */
  async unsubscribe(userId: string, endpointOrToken: string): Promise<void> {
    const candidates = endpointOrToken.startsWith('http')
      ? [endpointOrToken]
      : endpointOrToken.startsWith(FCM_PREFIX)
        ? [endpointOrToken, endpointOrToken.slice(FCM_PREFIX.length)]
        : [`${FCM_PREFIX}${endpointOrToken}`, endpointOrToken];

    if (this.legacyDb) {
      await this.legacyDb.query(
        `DELETE FROM public.push_subscriptions WHERE user_id = $1 AND endpoint = ANY($2::text[])`,
        [userId, candidates],
      );
      return;
    }

    await this.pushRepo!.delete({ userId, endpoint: In(candidates) });
  }

  /**
   * Sends push notification payload to all subscriptions belonging to `userIds`.
   * Dispatches FCM tokens via Firebase Admin SDK and standard endpoints via web-push.
   * Deletes stale/expired subscriptions automatically.
   */
  async send(userIds: string[], payload: PushPayload): Promise<void> {
    if (!userIds || userIds.length === 0) {
      return;
    }

    let subscriptions: Array<{
      id: string;
      user_id?: string;
      userId?: string;
      endpoint: string;
      p256dh: string;
      auth: string;
    }>;

    if (this.legacyDb) {
      const res = await this.legacyDb.query(
        `SELECT id, user_id, endpoint, p256dh, auth FROM public.push_subscriptions WHERE user_id = ANY($1::uuid[])`,
        [userIds],
      );
      subscriptions = res.rows;
    } else {
      subscriptions = await this.pushRepo!.find({
        where: { userId: In(userIds) },
      });
    }

    if (!subscriptions || subscriptions.length === 0) {
      return;
    }

    const fcmSubs = subscriptions.filter(
      (sub) => sub.endpoint.startsWith(FCM_PREFIX) || sub.p256dh === 'fcm',
    );
    const vapidSubs = subscriptions.filter(
      (sub) => !sub.endpoint.startsWith(FCM_PREFIX) && sub.p256dh !== 'fcm',
    );

    if (fcmSubs.length > 0) {
      await this.sendViaFcm(fcmSubs, payload);
    }

    if (vapidSubs.length > 0) {
      await this.sendViaVapid(vapidSubs, payload);
    }
  }

  private async sendViaFcm(
    fcmSubs: Array<{ endpoint: string }>,
    payload: PushPayload,
  ): Promise<void> {
    if (!this.configureFirebase()) {
      this.logger.warn(
        'FCM subscriptions found but Firebase Admin is not configured',
      );
      return;
    }

    const tokens = fcmSubs.map((sub) =>
      sub.endpoint.startsWith(FCM_PREFIX)
        ? sub.endpoint.slice(FCM_PREFIX.length)
        : sub.endpoint,
    );

    try {
      const response = await getMessaging().sendEachForMulticast({
        tokens,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: {
          title: payload.title,
          body: payload.body,
          url: payload.url,
        },
        webpush: {
          notification: {
            title: payload.title,
            body: payload.body,
            icon: '/icons/icon-192.png',
            badge: '/icons/icon-192.png',
          },
          fcmOptions: {
            link: payload.url,
          },
        },
      });

      await Promise.all(
        response.responses.map(async (res, idx) => {
          if (!res.success && res.error?.code) {
            if (STALE_FCM_CODES.has(res.error.code)) {
              const endpoint = fcmSubs[idx].endpoint;
              this.logger.warn(
                `Stale FCM token (${res.error.code}), deleting: ${endpoint}`,
              );
              await this.deleteSubscriptionByEndpoint(endpoint);
            } else {
              this.logger.error(
                `FCM send error for ${fcmSubs[idx].endpoint}`,
                res.error,
              );
            }
          }
        }),
      );
    } catch (err) {
      this.logger.error('Failed to send multicast FCM notification', err);
    }
  }

  private async sendViaVapid(
    vapidSubs: Array<{ endpoint: string; p256dh: string; auth: string }>,
    payload: PushPayload,
  ): Promise<void> {
    this.configureVapid();
    const payloadString = JSON.stringify(payload);

    await Promise.all(
      vapidSubs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: {
                p256dh: sub.p256dh,
                auth: sub.auth,
              },
            },
            payloadString,
          );
        } catch (err: any) {
          const statusCode = err?.statusCode ?? err?.status;
          if (statusCode === 404 || statusCode === 410) {
            this.logger.warn(
              `Stale subscription returned ${statusCode}, deleting: ${sub.endpoint}`,
            );
            await this.deleteSubscriptionByEndpoint(sub.endpoint);
          } else {
            this.logger.error(
              `Error sending push notification to ${sub.endpoint}`,
              err,
            );
          }
        }
      }),
    );
  }
}
