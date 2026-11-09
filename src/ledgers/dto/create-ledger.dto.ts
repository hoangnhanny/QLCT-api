import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { LedgerKind } from '../ledgers.types';

export class CreateLedgerDto {
  @IsIn(['family', 'business'])
  kind: LedgerKind;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])(-01)?$/, {
    message: 'month must be formatted as YYYY-MM or YYYY-MM-01',
  })
  month?: string;
}
