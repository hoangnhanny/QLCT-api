import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { types } from 'pg';
import { resolveDatabaseUrl } from '../supabase/database-url';
import { ALL_ENTITIES } from './entities';

// Return Postgres DATE (OID 1082) directly as 'YYYY-MM-DD' string to prevent runtime timezone drift
types.setTypeParser(1082, (val: string) => val);

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        type: 'postgres',
        url: resolveDatabaseUrl(),
        entities: ALL_ENTITIES,
        synchronize: false,
      }),
    }),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
