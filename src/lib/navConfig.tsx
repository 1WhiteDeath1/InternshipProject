import {
  LayoutDashboard, Package, BedDouble, Receipt,
  Shield, Users, UserCog, ClipboardList, Bell, BarChart3,
  Settings, FileUp, IdCard, UtensilsCrossed, Wallet, ChefHat, LayoutGrid, Contact, UserCircle2,
  TrendingUp, ClipboardCheck, CalendarDays, MessageSquare, Percent, Scale,
} from 'lucide-react';

export interface Permission { module: string; action: string }

export interface NavItem {
  path: string;
  label: string;
  icon: typeof LayoutDashboard;
  feature?: string | null;
  badge?: 'alertCount' | 'directiveCount';
  requiredPermission?: Permission;
  requiredPermissionAny?: Permission[];
  requiredPermissionAll?: Permission[];
}

// Single source of truth for "which permission does this screen need" -
// drives both the sidebar (Layout.tsx, filters what's shown) and route
// guards (App.tsx, blocks direct navigation to a URL the role can't use).
// Keeping these as one array means the two can never drift out of sync the
// way the old duplicated logic could.
//
// ARRAY ORDER matters: every role's sidebar is this same list filtered down
// to what that role can see, so this order becomes each role's actual menu
// order. It's deliberately grouped, not alphabetical or historical:
//   1. Dashboard (home)
//   2. Money & desk operations (Clerk's world, in the order they're used)
//   3. Kitchen & stock operations (Kitchen NCO's world)
//   4. Front desk & roster (Booking NCO's world, then shared roster modules)
//   5. Events / Security (secondary operational hubs, each mostly one role)
//   6. Reference & lookup (Guests, Attendants - read against, not run day-to-day)
//   7. Policy & standing authority (discount rates, tariffs)
//   8. Act-on-this (Approvals, Alerts, Directives - today's queue)
//   9. Analysis (Reports - the deep dive, not a daily stop)
//  10. Administration (Users/Roles/Audit/Import-Export/Settings - least frequent)
// Where two roles disagree on a module's priority (e.g. Bookings is Booking
// NCO's entire job but Kitchen NCO's minor lookup), the role with no other
// options wins the tie - Booking NCO has only 5 modules total, so Bookings
// stays ahead of Members here even though Kitchen NCO would rank them the
// other way round.
export const navItems: NavItem[] = [
  { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },

  // --- Money & desk operations (Clerk) ---
  { path: '/clerk-desk', label: 'Clerk Desk', icon: LayoutGrid, feature: 'clerk_desk', requiredPermission: { module: 'clerk_desk', action: 'view' } },
  { path: '/billing', label: 'Billing', icon: Receipt, feature: null, requiredPermission: { module: 'billing', action: 'view' } },
  // Clerk owns mess_billing end-to-end now (generate, issue, collect) - this
  // standalone page is their entry point for generating the period's bills
  // and logging guest meal charges; Clerk Desk's Members tab is where they
  // issue/collect/discount/print what gets generated here.
  { path: '/mess-billing', label: 'Mess Billing', icon: Wallet, feature: 'mess_billing', requiredPermission: { module: 'mess_billing', action: 'view' } },
  { path: '/billing-reports', label: 'Income & Cost', icon: Scale, feature: null, requiredPermission: { module: 'billing', action: 'view' } },

  // --- Kitchen & stock operations (Kitchen NCO) ---
  { path: '/kitchen', label: 'Kitchen', icon: ChefHat, feature: 'kitchen_module', requiredPermission: { module: 'kitchen', action: 'view' } },
  { path: '/stock', label: 'Inventory & Procurement', icon: Package, feature: null, requiredPermission: { module: 'inventory', action: 'view' } },
  { path: '/attendance', label: 'Attendance', icon: UtensilsCrossed, feature: 'mess_attendance', requiredPermission: { module: 'attendance', action: 'view' } },

  // --- Front desk & roster (Booking NCO, then shared roster modules) ---
  { path: '/bookings', label: 'Bookings', icon: BedDouble, feature: null, requiredPermission: { module: 'bookings', action: 'view' } },
  { path: '/members', label: 'Members', icon: IdCard, feature: 'mess_members', requiredPermission: { module: 'members', action: 'view' } },

  // --- Secondary operational hubs (each mostly one role's own module) ---
  { path: '/events', label: 'Events', icon: CalendarDays, requiredPermission: { module: 'events', action: 'view' } },
  { path: '/security', label: 'Security', icon: Shield, feature: null, requiredPermission: { module: 'security', action: 'view' } },

  // --- Reference & lookup ---
  { path: '/guests', label: 'Guests', icon: Contact, feature: null, requiredPermission: { module: 'guests', action: 'view' } },
  { path: '/attendants', label: 'Attendants', icon: UserCircle2, feature: null, requiredPermission: { module: 'attendants', action: 'view' } },

  // --- Policy & standing authority (Manager) ---
  // Manager's direct discount/category authority over in-house guests -
  // reuses the existing bookings:approve permission (the same lever the
  // category override already used), no new RBAC permission needed.
  { path: '/guest-discounts', label: 'Guest Discounts', icon: Percent, requiredPermission: { module: 'bookings', action: 'approve' } },
  // Standing HRA/mess-member discount rate - members:edit is shared with
  // Kitchen NCO, so this also requires bookings:approve (Manager-only
  // today) to keep it off Kitchen NCO's nav.
  { path: '/member-discounts', label: 'Member Discounts', icon: Percent, requiredPermissionAll: [{ module: 'bookings', action: 'approve' }, { module: 'members', action: 'edit' }] },
  { path: '/tariffs', label: 'Tariffs', icon: TrendingUp, requiredPermission: { module: 'tariffs', action: 'view' } },

  // --- Act-on-this: today's queue ---
  // No procurement approval anymore (the mess buys and restocks itself,
  // no PO to sign off on) - gated instead on the two things that actually
  // land here: bill corrections (Manager) and menu changes (Manager/Deputy).
  { path: '/approvals', label: 'Approvals', icon: ClipboardCheck, requiredPermissionAny: [{ module: 'billing', action: 'approve' }, { module: 'menu', action: 'approve' }] },
  { path: '/alerts', label: 'Alerts', icon: Bell, badge: 'alertCount', requiredPermission: { module: 'alerts', action: 'view' } },
  { path: '/directives', label: 'Directives', icon: MessageSquare, badge: 'directiveCount', requiredPermission: { module: 'directives', action: 'view' } },

  // --- Analysis: the deep dive, not a daily stop ---
  { path: '/reports', label: 'Reports', icon: BarChart3, requiredPermission: { module: 'reports', action: 'view' } },

  // --- Administration: least frequent ---
  { path: '/audit-log', label: 'Audit Log', icon: ClipboardList, requiredPermission: { module: 'audit', action: 'view' } },
  { path: '/users', label: 'Users', icon: Users, requiredPermission: { module: 'users', action: 'view' } },
  { path: '/roles', label: 'Roles', icon: UserCog, requiredPermission: { module: 'roles', action: 'view' } },
  { path: '/import-export', label: 'Import / Export', icon: FileUp, requiredPermission: { module: 'import_export', action: 'view' } },
  { path: '/settings', label: 'Settings', icon: Settings, requiredPermission: { module: 'settings', action: 'view' } },
];

export const navItemByPath = (path: string): NavItem | undefined => navItems.find(i => i.path === path);
