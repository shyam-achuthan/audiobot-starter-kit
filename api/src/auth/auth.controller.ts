import {
  BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiAuthGuard, OwnerOnly, type AuthedRequest } from './auth.guard';
import { ChangePasswordDto, CreateUserDto, LoginDto, SetupDto, UpdateUserDto } from './auth.dto';
import { AuthService } from './auth.service';

function meta(req: Request) {
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
}

function signedInUser(req: AuthedRequest) {
  if (req.principal?.kind !== 'user') throw new ForbiddenException('sign in as an admin user');
  return req.principal;
}

/** Sign-in for the admin dashboard. The web app keeps the token in an httpOnly cookie. */
@Controller('v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Get('status')
  async status() {
    return { needsSetup: await this.auth.needsSetup() };
  }

  /** Creates the first (owner) account. Only works while there are no accounts at all. */
  @Post('setup')
  async setup(@Body() dto: SetupDto, @Req() req: Request) {
    if (!(await this.auth.needsSetup())) throw new ForbiddenException('setup is already complete; sign in instead');
    const user = await this.auth.createUser({ email: dto.email, password: dto.password, name: dto.name ?? null, role: 'owner' });
    return this.auth.startSession(user, meta(req).userAgent);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto.email, dto.password, meta(req));
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(ApiAuthGuard)
  async logout(@Req() req: AuthedRequest) {
    await this.auth.logout(signedInUser(req).sessionId);
    return { ok: true };
  }

  @Get('me')
  @UseGuards(ApiAuthGuard)
  me(@Req() req: AuthedRequest) {
    return signedInUser(req).user;
  }

  @Post('password')
  @HttpCode(200)
  @UseGuards(ApiAuthGuard)
  async changePassword(@Body() dto: ChangePasswordDto, @Req() req: AuthedRequest) {
    const { user, sessionId } = signedInUser(req);
    if (!(await this.auth.verify(dto.currentPassword, user))) throw new BadRequestException('current password is wrong');
    await this.auth.setPassword(user, dto.newPassword);
    await this.auth.revokeAll(user.id, sessionId); // sign out other devices
    return { ok: true };
  }
}

/** Admin accounts (owners only). */
@Controller('v1/admin-users')
@UseGuards(ApiAuthGuard)
@OwnerOnly()
export class AdminUsersController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  list() {
    return this.auth.listUsers();
  }

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.auth.createUser({ email: dto.email, password: dto.password, name: dto.name ?? null, role: dto.role ?? 'admin' });
  }

  @Patch(':id')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto, @Req() req: AuthedRequest) {
    const me = signedInUser(req).user;
    const user = await this.auth.getUser(id);
    const losesOwner = (dto.role && dto.role !== 'owner') || dto.disabled === true;
    if (user.role === 'owner' && losesOwner && (await this.auth.ownerCount(user.id)) === 0) {
      throw new BadRequestException('keep at least one active owner');
    }
    if (user.id === me.id && dto.disabled) throw new BadRequestException("you can't disable your own account");
    if (dto.password) {
      await this.auth.setPassword(user, dto.password);
      await this.auth.revokeAll(user.id, user.id === me.id ? signedInUser(req).sessionId : undefined);
    }
    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name.trim() || null;
    if (dto.role) patch.role = dto.role;
    if (dto.disabled !== undefined) patch.disabled = dto.disabled;
    await user.update(patch);
    if (dto.disabled) await this.auth.revokeAll(user.id);
    return user;
  }

  @Delete(':id')
  async remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthedRequest) {
    const me = signedInUser(req).user;
    if (id === me.id) throw new BadRequestException("you can't delete your own account");
    const user = await this.auth.getUser(id);
    if (user.role === 'owner' && (await this.auth.ownerCount(user.id)) === 0) {
      throw new BadRequestException('keep at least one active owner');
    }
    await user.destroy();
    return { ok: true };
  }
}
