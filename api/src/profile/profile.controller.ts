import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { AgentTokenGuard } from '../common/agent-token.guard';
import { BusinessProfile } from '../database/models';
import { UpdateProfileDto } from '../knowledge/knowledge.dto';

/** Business profile edited on the admin Setup page; agents read it at the start of each call. */
@Controller('v1/profile')
@UseGuards(AgentTokenGuard)
export class ProfileController {
  constructor(@InjectModel(BusinessProfile) private readonly profiles: typeof BusinessProfile) {}

  private async row() {
    const [profile] = await this.profiles.findOrCreate({ where: { id: 1 }, defaults: { id: 1, companyName: 'AudioBots Demo' } });
    return profile;
  }

  @Get()
  get() {
    return this.row();
  }

  @Put()
  async update(@Body() dto: UpdateProfileDto) {
    const profile = await this.row();
    const patch = Object.fromEntries(
      Object.entries(dto).map(([k, v]) => [k, typeof v === 'string' ? v.trim() || null : v]),
    ) as Partial<BusinessProfile>;
    if (patch.companyName === null) delete patch.companyName; // required
    return profile.update(patch);
  }
}
