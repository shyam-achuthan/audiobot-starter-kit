import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Op, type WhereOptions } from 'sequelize';

/** Shared query params for dashboard lists: paging, free-text search and a date range. */
export class ListQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsIn(['asc', 'desc']) order?: 'asc' | 'desc';
}

export function paging(q: ListQuery) {
  return { limit: q.limit ?? 50, offset: q.offset ?? 0 };
}

/** ILIKE across the given columns; escapes % and _ so they match literally. */
export function search(q: string | undefined, columns: string[]): WhereOptions | undefined {
  const text = q?.trim();
  if (!text) return undefined;
  const pattern = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return { [Op.or]: columns.map((c) => ({ [c]: { [Op.iLike]: pattern } })) };
}

export function dateRange(column: string, q: ListQuery): WhereOptions | undefined {
  if (!q.from && !q.to) return undefined;
  const range: Record<symbol, Date> = {};
  if (q.from) range[Op.gte] = new Date(q.from);
  if (q.to) range[Op.lt] = new Date(q.to);
  return { [column]: range };
}

export function and(...parts: (WhereOptions | undefined | false | null | "")[]): WhereOptions {
  const list = parts.filter(Boolean) as WhereOptions[];
  return list.length ? { [Op.and]: list } : {};
}
