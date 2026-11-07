import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Pool, types } from 'pg';
import { resolveDatabaseUrl } from './database-url';

// Return Postgres DATE (OID 1082) directly as 'YYYY-MM-DD' string to prevent runtime timezone drift
types.setTypeParser(1082, (val: string) => val);

/**
 * Provides data access for the API. `db` is a `pg` Pool connected to the
 * local Supabase Postgres instance (used for all table reads/writes). The
 * lazily-created supabase-js `client` getter is reserved for Storage access
 * (see Task 9); it throws until `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`
 * are configured.
 */
@Injectable()
export class SupabaseService implements OnModuleDestroy {
  readonly db: Pool;

  private supabaseClient?: SupabaseClient;

  constructor() {
    const databaseUrl = resolveDatabaseUrl();
    this.db = new Pool({ connectionString: databaseUrl });
  }

  get client(): SupabaseClient {
    if (!this.supabaseClient) {
      const url = process.env.SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !key) {
        throw new Error(
          'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to use the supabase-js client',
        );
      }
      this.supabaseClient = createClient(url, key);
    }
    return this.supabaseClient;
  }

  async onModuleDestroy(): Promise<void> {
    await this.db.end();
  }
}
