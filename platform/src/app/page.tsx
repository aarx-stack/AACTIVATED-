import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'

export default async function Home() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (session.user.role === 'SUPER_ADMIN' || session.user.role === 'ADMIN') redirect('/admin')
  if (session.user.affiliateId) redirect('/portal')
  redirect('/login')
}
