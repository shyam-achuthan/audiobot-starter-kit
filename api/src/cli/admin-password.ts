/**
 * Recovery: set an admin's password (creating an owner if the email doesn't exist) from the server.
 *   docker compose exec api node dist/cli/admin-password.js <email>
 * Reads the new password from the ADMIN_NEW_PASSWORD env var or prompts for it (hidden).
 */
import { createInterface } from 'node:readline';
import { Sequelize } from 'sequelize-typescript';
import { passwordProblem, hashPassword } from '../auth/password';
import { MODELS, AdminSession, AdminUser } from '../database/models';

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    out._writeToOutput = (s: string) => { if (s.includes(question)) out.output.write(s); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

async function main() {
  const email = (process.argv[2] ?? '').trim().toLowerCase();
  if (!email.includes('@')) {
    console.error('usage: node dist/cli/admin-password.js <email>');
    process.exit(2);
  }
  const password = process.env.ADMIN_NEW_PASSWORD || (await promptHidden('New password: '));
  const problem = passwordProblem(password);
  if (problem) {
    console.error(`✗ ${problem}`);
    process.exit(2);
  }
  const db = new Sequelize(process.env.DATABASE_URL!, { dialect: 'postgres', models: MODELS, logging: false, define: { underscored: true } });
  const passwordHash = await hashPassword(password);
  const user = await AdminUser.findOne({ where: { email } });
  if (user) {
    await user.update({ passwordHash, disabled: false });
    await AdminSession.destroy({ where: { userId: user.id } });
    console.log(`✓ password set for ${email} (account enabled, other sessions signed out)`);
  } else {
    await AdminUser.create({ email, passwordHash, role: 'owner' });
    console.log(`✓ created owner account ${email}`);
  }
  await db.close();
}

main().catch((e) => {
  console.error(`✗ ${(e as Error).message}`);
  process.exit(1);
});
