import type { ReactNode } from 'react';
import { useAuth } from '@/contexts/useAuth';
import { hasPermission } from '@/contexts/auth-context';
import type { NavItem } from '@/lib/navConfig';
import NoAccess from '@/pages/NoAccess';

// Route-level counterpart to the sidebar's nav filtering (Layout.tsx) - both
// read the same NavItem permission fields, so a role that can't see a link
// also can't reach it by typing the URL directly. Previously only the
// sidebar was gated; the backend blocked the underlying data either way, but
// a direct route hit rendered a broken-looking page full of 403 error
// toasts instead of a clean "no access" screen.
export function RequirePermission({ item, children }: { item?: NavItem; children: ReactNode }) {
  const { user } = useAuth();

  if (!item) return <>{children}</>;

  const allowed = item.requiredPermission
    ? hasPermission(user, item.requiredPermission.module, item.requiredPermission.action)
    : item.requiredPermissionAny
    ? item.requiredPermissionAny.some(p => hasPermission(user, p.module, p.action))
    : item.requiredPermissionAll
    ? item.requiredPermissionAll.every(p => hasPermission(user, p.module, p.action))
    : true;

  return allowed ? <>{children}</> : <NoAccess />;
}
