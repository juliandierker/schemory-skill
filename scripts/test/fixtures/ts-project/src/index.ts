export interface User {
  id: string
  email: string
  age?: number
}

export type Role = 'admin' | 'member'

export function greet(user: User, role: Role = 'member'): string {
  return `${role}: ${user.email}`
}
