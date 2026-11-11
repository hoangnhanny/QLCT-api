import { IsOptional, IsString, IsUUID, Matches } from 'class-validator';

export class ListAlertsQueryDto {
  @IsOptional()
  @IsUUID()
  ledgerId?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])(-\d{2})?$/, {
    message: 'month must be YYYY-MM or YYYY-MM-01',
  })
  month?: string;
}
