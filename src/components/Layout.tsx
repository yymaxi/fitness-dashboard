import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { cx } from './ui';

type IconName = 'home' | 'checkin' | 'training' | 'todos' | 'more' | 'body' | 'settings';

const paths: Record<IconName, ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  checkin: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  training: <path d="M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12" />,
  todos: <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  body: <path d="M12 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6M6 21l2-9h8l2 9M8 12l-3-2M16 12l3-2" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
};

export function Icon({ name, className = 'size-6' }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {paths[name]}
    </svg>
  );
}

const mobileNav: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Start', icon: 'home' },
  { to: '/checkin', label: 'Check-in', icon: 'checkin' },
  { to: '/training', label: 'Training', icon: 'training' },
  { to: '/todos', label: 'To-Dos', icon: 'todos' },
  { to: '/mehr', label: 'Mehr', icon: 'more' },
];

export const sideNav: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Start', icon: 'home' },
  { to: '/checkin', label: 'Check-in', icon: 'checkin' },
  { to: '/training', label: 'Training', icon: 'training' },
  { to: '/todos', label: 'To-Dos', icon: 'todos' },
  { to: '/koerper', label: 'Körper', icon: 'body' },
  { to: '/einstellungen', label: 'Einstellungen', icon: 'settings' },
];

export function Layout() {
  return (
    <div className="min-h-dvh md:flex">
      <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 border-r border-line bg-surface p-4 md:block">
        <p className="mb-6 px-2 text-lg font-semibold">Fitness</p>
        <nav className="space-y-1">
          {sideNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cx('flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm', isActive ? 'bg-surface-2 font-medium text-fg' : 'text-muted hover:text-fg')
              }
            >
              <Icon name={item.icon} className="size-5" />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="mx-auto w-full max-w-3xl px-4 pt-6 pb-28 md:px-8 md:pb-10">
        <Outlet />
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-surface/95 backdrop-blur md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {mobileNav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) => cx('flex min-h-16 flex-col items-center justify-center gap-1 text-xs', isActive ? 'text-accent' : 'text-muted')}
          >
            <Icon name={item.icon} />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
