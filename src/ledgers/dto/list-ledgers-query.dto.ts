import { IsOptional, IsString, Matches } from 'class-validator';

export class ListLedgersQueryDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])(-01)?$/, {
    message: 'month must be formatted as YYYY-MM or YYYY-MM-01',
  })
  month?: string;
}
