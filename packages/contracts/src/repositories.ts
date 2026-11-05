import { z } from 'zod';

const repositoryUrl = z
  .string()
  .max(2048)
  .regex(/^https:\/\//iu)
  .refine(
    (value) => !/[?#\s\\]/u.test(value),
    'Repository URL must not include query, fragment or whitespace',
  )
  .pipe(z.url({ protocol: /^https$/u }))
  .refine((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return !url.username && !url.password && !/[?#\s\\]/u.test(value);
  }, 'Repository URL must not include credentials, query, fragment or whitespace')
  .transform((value) => new URL(value).href)
  .pipe(z.string().max(2048));

export const registerRepositorySchema = z.strictObject({
  name: z
    .string()
    .transform((value) => value.normalize('NFC').trim().replace(/\s+/gu, ' '))
    .pipe(z.string().min(1).max(120)),
  url: repositoryUrl,
});

export const repositoryQuerySchema = z.strictObject({
  limit: z
    .union([z.number(), z.string().regex(/^\d+$/u).transform(Number)])
    .pipe(z.number().int().min(1).max(100))
    .default(20),
  cursor: z.string().min(1).max(1024).optional(),
});
