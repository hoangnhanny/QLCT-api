import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class PushSubscriptionKeysDto {
  @IsNotEmpty()
  @IsString()
  p256dh: string;

  @IsNotEmpty()
  @IsString()
  auth: string;
}

export class SubscribeDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  token?: string;

  @ValidateIf((o: SubscribeDto) => !o.token)
  @IsNotEmpty()
  @IsString()
  endpoint?: string;

  @ValidateIf((o: SubscribeDto) => !o.token)
  @IsNotEmpty()
  @IsObject()
  @ValidateNested()
  @Type(() => PushSubscriptionKeysDto)
  keys?: PushSubscriptionKeysDto;
}

export class UnsubscribeDto {
  @IsOptional()
  @IsString()
  token?: string;

  @IsOptional()
  @IsString()
  endpoint?: string;
}
