import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UploadedFiles, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiAuthGuard } from '../auth/auth.guard';
import { MAX_FILE_BYTES, SUPPORTED_FILE_TYPES } from './extract';
import { AddFaqDto, AddUrlDto, CreateKbDto, SearchDto, UpdateKbDto } from './knowledge.dto';
import { KnowledgeService } from './knowledge.service';

@Controller('v1/knowledge')
@UseGuards(ApiAuthGuard)
export class KnowledgeController {
  constructor(private readonly kb: KnowledgeService) {}

  @Get('embedding-models')
  async models() {
    return { models: await this.kb.models(), fileTypes: SUPPORTED_FILE_TYPES, maxFileBytes: MAX_FILE_BYTES };
  }

  @Post('search')
  search(@Body() dto: SearchDto) {
    return this.kb.search(dto);
  }

  @Get()
  list() {
    return this.kb.list();
  }

  @Post()
  create(@Body() dto: CreateKbDto) {
    return this.kb.create(dto);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.kb.get(id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateKbDto) {
    return this.kb.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.kb.remove(id);
  }

  @Post(':id/files')
  @UseInterceptors(FilesInterceptor('files', 20, { limits: { fileSize: MAX_FILE_BYTES } }))
  upload(@Param('id', ParseUUIDPipe) id: string, @UploadedFiles() files: Express.Multer.File[]) {
    return this.kb.addFiles(id, files);
  }

  @Post(':id/faqs')
  addFaq(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddFaqDto) {
    return this.kb.addFaq(id, dto);
  }

  @Post(':id/urls')
  addUrl(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddUrlDto) {
    return this.kb.addUrl(id, dto);
  }

  @Post(':id/reindex')
  reindex(@Param('id', ParseUUIDPipe) id: string) {
    return this.kb.reindex(id);
  }

  @Delete(':id/documents/:docId')
  removeDoc(@Param('id', ParseUUIDPipe) id: string, @Param('docId', ParseUUIDPipe) docId: string) {
    return this.kb.removeDocument(id, docId);
  }

  @Post(':id/documents/:docId/retry')
  retry(@Param('id', ParseUUIDPipe) id: string, @Param('docId', ParseUUIDPipe) docId: string) {
    return this.kb.retry(id, docId);
  }
}
