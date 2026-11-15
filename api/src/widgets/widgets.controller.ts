import {
  Body, Controller, Delete, Get, Headers, Ip, Param, ParseUUIDPipe, Post, Put, Query, UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsHexColor, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { ApiAuthGuard, OwnerOnly } from '../auth/auth.guard';
import { WORKFLOWS } from '../config';
import { WidgetsService } from './widgets.service';

class AppearanceDto {
  @IsOptional() @IsString() @MaxLength(60) title?: string;
  @IsOptional() @IsString() @MaxLength(40) buttonLabel?: string;
  @IsOptional() @IsHexColor() color?: string;
  @IsOptional() @IsIn(['right', 'left']) position?: 'right' | 'left';
  @IsOptional() @IsBoolean() captions?: boolean;
}

export class WidgetDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(200, { each: true }) allowedOrigins?: string[];
  @IsOptional() @IsIn(WORKFLOWS) workflow?: string;
  @IsOptional() @ValidateNested() @Type(() => AppearanceDto) appearance?: AppearanceDto;
  @IsOptional() @IsInt() @Min(1) @Max(100) maxConcurrent?: number;
  @IsOptional() @IsInt() @Min(1) @Max(60) maxMinutes?: number;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

export class SessionDto {
  @IsString() @MaxLength(64) key!: string;
}

/** Public endpoints the embedded widget calls (through the web app's /backend proxy). */
@Controller('v1/widget')
export class WidgetPublicController {
  constructor(private readonly widgets: WidgetsService) {}

  @Get('config')
  config(@Query('key') key: string, @Headers('origin') origin?: string, @Headers('x-forwarded-host') host?: string) {
    return this.widgets.config(key ?? '', origin, host);
  }

  @Post('session')
  session(
    @Body() dto: SessionDto, @Headers('origin') origin: string | undefined, @Ip() ip: string,
    @Headers('x-forwarded-host') host?: string,
  ) {
    return this.widgets.session(dto.key, origin, ip, host);
  }
}

/** Admin -> Widgets (owners). */
@Controller('v1/widgets')
@UseGuards(ApiAuthGuard)
@OwnerOnly()
export class WidgetsController {
  constructor(private readonly widgets: WidgetsService) {}

  @Get()
  list() {
    return this.widgets.list();
  }

  @Post()
  create(@Body() dto: WidgetDto) {
    return this.widgets.create({
      name: dto.name ?? 'Website widget', allowedOrigins: dto.allowedOrigins ?? [], workflow: dto.workflow ?? 'router',
      appearance: dto.appearance ?? {}, maxConcurrent: dto.maxConcurrent ?? 5, maxMinutes: dto.maxMinutes ?? 15,
      enabled: dto.enabled ?? true,
    });
  }

  @Put(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: WidgetDto) {
    return this.widgets.update(id, dto);
  }

  @Post(':id/rotate-key')
  rotate(@Param('id', ParseUUIDPipe) id: string) {
    return this.widgets.rotateKey(id);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.widgets.remove(id);
  }
}
