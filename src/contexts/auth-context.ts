import { createContext } from 'react';

export interface Permission {
  module: string;
  action: string;
}

export interface User {
  id: number;
  username: string;
  full_name: string;
  email: string;
  role_id: number;
  is_supervisor: boolean;
  role_name: string;
  preferences: string | null;
  permissions: Permission[];
}

export interface AuthContextType {
  user: User | null;
  login: (username: string, password: string, rememberMe: boolean) => Promise<User>;
  logout: () => Promise<void>;
  loading: boolean;
}

export const AuthContext = createContext<AuthContextType | null>(null);

// Mirrors backend check_permission() - is_supervisor short-circuits (kept for
// a hypothetical break-glass account), otherwise an explicit module+action
// row must exist. None of the seeded roles set is_supervisor: it's a total
// bypass that can't be scoped, so real access differences (e.g. Manager vs
// Deputy Manager) live entirely in the permissions list.
export function hasPermission(user: User | null | undefined, module: string, action: string): boolean {
  if (!user) return false;
  if (user.is_supervisor) return true;
  return user.permissions?.some(p => p.module === module && p.action === action) ?? false;
}

// Booking NCO (bookings:view but neither reports:view, clerk_desk:view, nor
// kitchen:view) has no Dashboard of its own - Bookings is home instead.
// Kitchen NCO also holds bookings:view now (read-only, for guest lookup) but
// DOES have its own tailored Dashboard, hence the added kitchen:view carve-out.
// Keyed off permissions, not role name, so a cloned custom role follows suit.
export function getHomePath(user: User | null | undefined): string {
  if (hasPermission(user, 'bookings', 'view') && !hasPermission(user, 'reports', 'view')
      && !hasPermission(user, 'clerk_desk', 'view') && !hasPermission(user, 'kitchen', 'view')) {
    return '/bookings';
  }
  return '/dashboard';
}
