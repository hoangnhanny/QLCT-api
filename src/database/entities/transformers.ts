import { ValueTransformer } from 'typeorm';

/**
 * PostgreSQL bigint columns are returned as strings by node-pg to avoid
 * precision loss. This transformer converts them to JavaScript numbers.
 */
export const BigIntTransformer: ValueTransformer = {
  to: (entityValue: number | bigint | null | undefined) => entityValue,
  from: (databaseValue: string | number | null | undefined): number | null => {
    if (databaseValue === null || databaseValue === undefined) return null;
    return Number(databaseValue);
  },
};

/**
 * PostgreSQL DATE columns (YYYY-MM-DD) transformer.
 */
export const DateColumnTransformer: ValueTransformer = {
  to: (value: string | Date | null | undefined) => value,
  from: (value: string | Date | null | undefined): string | null => {
    if (!value) return null;
    if (value instanceof Date) {
      return value.toISOString().slice(0, 10);
    }
    return String(value).slice(0, 10);
  },
};
