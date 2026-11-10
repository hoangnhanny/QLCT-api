import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as webpush from 'web-push';
import { SupabaseService } from '../supabase/supabase.service';
import { PushSubscription as PushSubscriptionEntity } from '../database/entities/push-subscription.entity';

export interface PushPayload {
  title: string;
  body: string;
  url: string;
}

export interface PushSubscriptionItem {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

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
    this.configureVapid();
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

  getPublicKey(): string {
    return process.env.VAPID_PUBLIC_KEY ?? '';
  }

  /**
   * Upserts a push subscription for the user by endpoint.
   */
  async subscribe(userId: string, sub: PushSubscriptionItem): Promise<void> {
    if (this.legacyDb) {
      await this.legacyDb.query(
        `INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4) ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
        [userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth],
      );
      return;
    }

    await this.pushRepo!.upsert(
      {
        userId,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
      },
      ['endpoint'],
    );
  }

  /**
   * Removes a subscription by user and endpoint.
   */
  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    if (this.legacyDb) {
      await this.legacyDb.query(
        `DELETE FROM public.push_subscriptions WHERE user_id = $1 AND endpoint = $2`,
        [userId, endpoint],
      );
      return;
    }

    await this.pushRepo!.delete({ userId, endpoint });
  }

  /**
   * Sends push notification payload to all subscriptions belonging to `userIds`.
   * Deletes subscriptions that return 404 or 410.
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

    this.configureVapid();

    const payloadString = JSON.stringify(payload);

    await Promise.all(
      subscriptions.map(async (sub) => {
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
            if (this.legacyDb) {
              await this.legacyDb
                .query(
                  `DELETE FROM public.push_subscriptions WHERE endpoint = $1`,
                  [sub.endpoint],
                )
                .catch(() => {});
            } else {
              await this.pushRepo!.delete({ endpoint: sub.endpoint }).catch(
                () => {},
              );
            }
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
