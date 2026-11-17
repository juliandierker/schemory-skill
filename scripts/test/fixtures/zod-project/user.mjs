import { z } from 'zod'

export const User = z.object({ id: z.string(), email: z.string().email() })
export const notASchema = 42
