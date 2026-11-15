import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ADMIN_ROLES } from '../database/models';

export class LoginDto {
  @IsString() @MaxLength(254) email!: string;
  @IsString() @MinLength(1) @MaxLength(200) password!: string;
}

export class SetupDto {
  @IsString() @MaxLength(254) email!: string;
  @IsString() @MaxLength(200) password!: string;
  @IsOptional() @IsString() @MaxLength(120) name?: string;
}

export class ChangePasswordDto {
  @IsString() @MaxLength(200) currentPassword!: string;
  @IsString() @MaxLength(200) newPassword!: string;
}

export class CreateUserDto {
  @IsString() @MaxLength(254) email!: string;
  @IsString() @MaxLength(200) password!: string;
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsIn(ADMIN_ROLES) role?: (typeof ADMIN_ROLES)[number];
}

export class UpdateUserDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsIn(ADMIN_ROLES) role?: (typeof ADMIN_ROLES)[number];
  @IsOptional() @IsBoolean() disabled?: boolean;
  /** Owner sets a new password for this user (signs them out everywhere). */
  @IsOptional() @IsString() @MaxLength(200) password?: string;
}
