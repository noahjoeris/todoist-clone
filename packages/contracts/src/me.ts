import { z } from 'zod';

export const meResponseSchema = z.object({
  id: z.uuid(),
});

export type MeResponse = z.infer<typeof meResponseSchema>;
