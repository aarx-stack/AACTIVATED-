import { redirect } from 'next/navigation'
import Link from 'next/link'
import { requireAffiliate, signOut } from '@/lib/auth'

const nav = [
  { href: '/portal', label: 'Dashboard' },
  { href: '/portal/conversions', label: 'My Sales' },
  { href: '/portal/team', label: 'My Team' },
  { href: '/portal/payouts', label: 'Payouts' },
]

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAffiliate()
  if (!session) redirect('/login')

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">A</div>
              <span className="text-sm font-semibold">Partner Portal</span>
            </div>
            <nav className="flex gap-1">
              {nav.map(item => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-lg px-3 py-1.5 text-sm text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <form
            action={async () => {
              'use server'
              await signOut({ redirectTo: '/login' })
            }}
          >
            <button className="text-xs font-medium text-indigo-600 hover:text-indigo-500">Sign out</button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  )
}
