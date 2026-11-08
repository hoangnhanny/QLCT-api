import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
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
  @IsNotEmpty()
  @IsString()
  endpoint: string;

  @IsNotEmpty()
  @IsObject()
  @ValidateNested()
  @Type(() => PushSubscriptionKeysDto)
  keys: PushSubscriptionKeysDto;
}

export class UnsubscribeDto {
  @IsOptional()
  @IsString()
  endpoint?: string;
}
