import {
  BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, Logger, NotFoundException,
  OnApplicationBootstrap, UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { config } from '../config';
import { AdminSession, AdminUser } from '../database/models';
import { hashPassword, newSessionToken, passwordProblem, sha256, verifyPassword } from './password';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// Burns similar time to a real check when the email doesn't exist (no user enumeration via timing).
const DUMMY_HASH = 'scrypt$16384$8$1$c2FsdHNhbHRzYWx0c2FsdA$' + 'A'.repeat(86);

@Injectable()
export class AuthService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Auth');
  private readonly failures = new Map<string, { count: number; until: number }>();

  constructor(
    @InjectModel(AdminUser) private readonly users: typeof AdminUser,
    @InjectModel(AdminSession) private readonly sessions: typeof AdminSession,
  ) {}

  /** ADMIN_EMAIL + ADMIN_PASSWORD create the first owner account if none exists yet. */
  async onApplicationBootstrap() {
    if (!config.admin.email || !config.admin.password) return;
    if (await this.users.count()) return;
    try {
      await this.createUser({ email: config.admin.email, password: config.admin.password, role: 'owner', name: null });
      this.logger.log(`created owner account ${config.admin.email} from ADMIN_EMAIL`);
    } catch (e) {
      this.logger.error(`could not create the owner account from ADMIN_EMAIL: ${(e as Error).message}`);
    }
  }

  async needsSetup() {
    return (await this.users.count()) === 0;
  }

  normalizeEmail(email: string) {
    const e = email.trim().toLowerCase();
    if (!EMAIL_RE.test(e)) throw new BadRequestException('enter a valid email address');
    return e;
  }

  async createUser(input: { email: string; password: string; role: string; name: string | null }) {
    const email = this.normalizeEmail(input.email);
    const problem = passwordProblem(input.password);
    if (problem) throw new BadRequestException(problem);
    if (await this.users.findOne({ where: { email } })) throw new ConflictException('an account with this email already exists');
    return this.users.create({
      email, name: input.name?.trim() || null, role: input.role, passwordHash: await hashPassword(input.password),
    });
  }

  async setPassword(user: AdminUser, password: string) {
    const problem = passwordProblem(password);
    if (problem) throw new BadRequestException(problem);
    await user.update({ passwordHash: await hashPassword(password) });
  }

  // ---- login throttling: 5 failures per key locks for 15 minutes ----
  private checkThrottle(key: string) {
    const f = this.failures.get(key);
    if (f && f.count >= 5 && f.until > Date.now()) {
      const mins = Math.ceil((f.until - Date.now()) / 60000);
      throw new HttpException(`too many failed sign-ins; try again in ${mins} minute${mins > 1 ? 's' : ''}`, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private recordFailure(key: string) {
    const f = this.failures.get(key);
    const fresh = !f || f.until < Date.now();
    this.failures.set(key, { count: fresh ? 1 : f.count + 1, until: Date.now() + 15 * 60_000 });
    if (this.failures.size > 10_000) this.failures.clear(); // bound memory
  }

  async login(emailRaw: string, password: string, meta: { ip?: string; userAgent?: string }) {
    const email = emailRaw.trim().toLowerCase();
    const keys = [`e:${email}`, `i:${meta.ip ?? '?'}`];
    keys.forEach((k) => this.checkThrottle(k));

    const user = await this.users.findOne({ where: { email } });
    const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok || user.disabled) {
      keys.forEach((k) => this.recordFailure(k));
      throw new UnauthorizedException(user?.disabled && ok ? 'this account is disabled' : 'wrong email or password');
    }
    keys.forEach((k) => this.failures.delete(k));
    await user.update({ lastLoginAt: new Date() });
    return this.startSession(user, meta.userAgent);
  }

  async startSession(user: AdminUser, userAgent?: string) {
    const { token, hash } = newSessionToken();
    const expiresAt = new Date(Date.now() + config.admin.sessionHours * 3600_000);
    await this.sessions.create({ userId: user.id, tokenHash: hash, expiresAt, userAgent: userAgent?.slice(0, 300) ?? null });
    // Opportunistic cleanup of expired sessions.
    void this.sessions.destroy({ where: { expiresAt: { [Op.lt]: new Date() } } }).catch(() => undefined);
    return { token, expiresAt, user };
  }

  async resolveSession(token: string) {
    const session = await this.sessions.findOne({ where: { tokenHash: sha256(token) }, include: [AdminUser] });
    if (!session || !session.user || session.expiresAt < new Date() || session.user.disabled) return null;
    // Touch at most once a minute.
    if (Date.now() - session.lastSeenAt.getTime() > 60_000) void session.update({ lastSeenAt: new Date() }).catch(() => undefined);
    return session as AdminSession & { user: AdminUser };
  }

  async logout(sessionId: string) {
    await this.sessions.destroy({ where: { id: sessionId } });
  }

  async revokeAll(userId: string, exceptSessionId?: string) {
    await this.sessions.destroy({
      where: { userId, ...(exceptSessionId ? { id: { [Op.ne]: exceptSessionId } } : {}) },
    });
  }

  async getUser(id: string) {
    const user = await this.users.findByPk(id);
    if (!user) throw new NotFoundException('user not found');
    return user;
  }

  listUsers() {
    return this.users.findAll({ order: [['createdAt', 'ASC']] });
  }

  async ownerCount(excludeId?: string) {
    return this.users.count({
      where: { role: 'owner', disabled: false, ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}) },
    });
  }

  verify(password: string, user: AdminUser) {
    return verifyPassword(password, user.passwordHash);
  }
}
