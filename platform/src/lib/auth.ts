import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { db } from './db'
import type { UserRole } from '@/generated/prisma/enums'

declare module 'next-auth' {
  interface User {
    role?: UserRole
    organizationId?: string
    affiliateId?: string | null
  }
  interface Session {
    user: {
      id: string
      email: string
      name: string
      role: UserRole
      organizationId: string
      affiliateId: string | null
    }
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        const email = String(credentials?.email ?? '').toLowerCase().trim()
        const password = String(credentials?.password ?? '')
        if (!email || !password) return null
        const user = await db.user.findUnique({ where: { email }, include: { affiliate: true } })
        if (!user || !user.isActive) return null
        const valid = await bcrypt.compare(password, user.passwordHash)
        if (!valid) return null
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          organizationId: user.organizationId,
          affiliateId: user.affiliate?.id ?? null,
        }
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = user.role
        token.organizationId = user.organizationId
        token.affiliateId = user.affiliateId
        token.id = user.id
      }
      return token
    },
    session({ session, token }) {
      session.user.id = token.id as string
      session.user.role = token.role as UserRole
      session.user.organizationId = token.organizationId as string
      session.user.affiliateId = (token.affiliateId as string | null) ?? null
      return session
    },
  },
})

export async function requireAdmin() {
  const session = await auth()
  if (!session?.user || (session.user.role !== 'SUPER_ADMIN' && session.user.role !== 'ADMIN')) {
    return null
  }
  return session
}

export async function requireAffiliate() {
  const session = await auth()
  if (!session?.user?.affiliateId) return null
  return session
}
