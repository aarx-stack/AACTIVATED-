import { redirect } from 'next/navigation'
import Link from 'next/link'
import { requireAdmin, signOut } from '@/lib/auth'

const nav = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/affiliates', label: 'Affiliates' },
  { href: '/admin/teams', label: 'Teams' },
  { href: '/admin/applications', label: 'Applications' },
  { href: '/admin/offers', label: 'Offers' },
  { href: '/admin/conversions', label: 'Conversions' },
  { href: '/admin/commissions', label: 'Commissions' },
  { href: '/admin/payouts', label: 'Payouts' },
  { href: '/admin/promo-codes', label: 'Promo Codes' },
  { href: '/admin/reports', label: 'Reports' },
  { href: '/admin/webhooks', label: 'Webhooks' },
  { href: '/admin/api-keys', label: 'API Keys' },
  { href: '/admin/fraud', label: 'Fraud' },
  { href: '/admin/settings', label: 'Settings' },
]

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdmin()
  if (!session) redirect('/login')

  return (
    <div className="flex min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <aside className="fixed inset-y-0 left-0 z-10 flex w-52 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">A</div>
          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Partner Platform</span>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
          {nav.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-lg px-3 py-1.5 text-sm text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <p className="truncate text-xs text-zinc-500">{session.user.email}</p>
          <form
            action={async () => {
              'use server'
              await signOut({ redirectTo: '/login' })
            }}
          >
            <button className="mt-1 text-xs font-medium text-indigo-600 hover:text-indigo-500">Sign out</button>
          </form>
        </div>
      </aside>
      <main className="ml-52 flex-1 px-8 py-8">{children}</main>
    </div>
  )
}
