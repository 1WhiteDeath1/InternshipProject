import {
  LayoutDashboard, Package, BedDouble, Receipt,
  Shield, Users, UserCog, ClipboardList, Bell, BarChart3,
  Settings, FileUp, IdCard, Wallet, ChefHat, LayoutGrid, Contact, UserCircle2,
  TrendingUp, CalendarDays, MessageSquare, Scale, Banknote, Landmark,
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
  // Sidebar section label (shadcn's SidebarGroup pattern) - undefined for
  // Dashboard only, which renders ungrouped above every section. Groups
  // render in first-appearance order, so this list's existing ordering
  // (see the numbered comment below) IS the group order too - no separate
  // list to keep in sync.
  group?: string;
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
  { path: '/clerk-desk', label: 'Clerk Desk', icon: LayoutGrid, feature: 'clerk_desk', requiredPermission: { module: 'clerk_desk', action: 'view' }, group: 'Front Desk & Billing' },
  { path: '/billing', label: 'Billing', icon: Receipt, feature: null, requiredPermission: { module: 'billing', action: 'view' }, group: 'Front Desk & Billing' },
  // Clerk owns mess_billing end-to-end now (generate, issue, collect) - this
  // standalone page is their entry point for generating the period's bills
  // and logging guest meal charges; Clerk Desk's Members tab is where they
  // issue/collect/discount/print what gets generated here.
  { path: '/mess-billing', label: 'Mess Billing', icon: Wallet, feature: 'mess_billing', requiredPermission: { module: 'mess_billing', action: 'view' }, group: 'Front Desk & Billing' },
  { path: '/billing-reports', label: 'Income & Cost', icon: Scale, feature: null, requiredPermission: { module: 'billing', action: 'view' }, group: 'Front Desk & Billing' },
  // Same page as Income & Cost above (AG Branch is one card within it) -
  // a second, distinctly-labeled entry point so it's directly reachable
  // from the sidebar by its own name, not just as a scroll-down inside a
  // broader financial-summary page.
  { path: '/billing-reports#ag-branch', label: 'AG Branch Advance Report', icon: Landmark, feature: null, requiredPermission: { module: 'billing', action: 'view' }, group: 'Front Desk & Billing' },
  { path: '/expenses', label: 'Expenses', icon: Banknote, feature: null, requiredPermission: { module: 'clerk_desk', action: 'view' }, group: 'Front Desk & Billing' },

  // --- Kitchen & stock operations (Kitchen NCO) ---
  { path: '/kitchen', label: 'Kitchen', icon: ChefHat, feature: 'kitchen_module', requiredPermission: { module: 'kitchen', action: 'view' }, group: 'Kitchen & Stock' },
  { path: '/stock', label: 'Inventory & Procurement', icon: Package, feature: null, requiredPermission: { module: 'inventory', action: 'view' }, group: 'Kitchen & Stock' },
  // No separate Attendance entry: marking who's eating and cooking for them
  // is one task, so it lives on Kitchen's Meals board. /attendance redirects
  // there (see App.tsx).

  // --- Front desk & roster (Booking NCO, then shared roster modules) ---
  { path: '/bookings', label: 'Bookings', icon: BedDouble, feature: null, requiredPermission: { module: 'bookings', action: 'view' }, group: 'Bookings & Roster' },
  // View-only room status/calendar/booking-history for Manager/Deputy
  // Manager - a distinct module from "bookings" on purpose (see access.py)
  // so it can never also unlock Booking NCO's write-capable Bookings page.
  { path: '/rooms-overview', label: 'Rooms', icon: BedDouble, feature: null, requiredPermission: { module: 'rooms_overview', action: 'view' }, group: 'Bookings & Roster' },
  { path: '/members', label: 'Members', icon: IdCard, feature: 'mess_members', requiredPermission: { module: 'members', action: 'view' }, group: 'Bookings & Roster' },

  // --- Secondary operational hubs (each mostly one role's own module) ---
  { path: '/events', label: 'Events', icon: CalendarDays, requiredPermission: { module: 'events', action: 'view' }, group: 'Operations' },
  { path: '/security', label: 'Security', icon: Shield, feature: null, requiredPermission: { module: 'security', action: 'view' }, group: 'Operations' },

  // --- Reference & lookup ---
  { path: '/guests', label: 'Guests', icon: Contact, feature: null, requiredPermission: { module: 'guests', action: 'view' }, group: 'Directory' },
  { path: '/attendants', label: 'Attendants', icon: UserCircle2, feature: null, requiredPermission: { module: 'attendants', action: 'view' }, group: 'Directory' },

  // --- Policy & standing authority (Manager) ---
  // Guest Discounts and Member Discounts live as tabs inside Tariffs now
  // (decluttered off the sidebar - same pricing-policy people touch all
  // three) rather than as their own nav items; each tab still enforces its
  // own original permission internally (bookings:approve, and
  // bookings:approve+members:edit) - see Tariffs.tsx. The nav item itself
  // is gated on either permission so a role with discount authority but no
  // tariffs:view (none exist today, but nothing stops one being added)
  // still reaches its tab instead of losing the page entirely.
  { path: '/tariffs', label: 'Tariffs', icon: TrendingUp, requiredPermissionAny: [{ module: 'tariffs', action: 'view' }, { module: 'bookings', action: 'approve' }], group: 'Policy' },

  // --- Act-on-this: today's queue ---
  // No procurement approval anymore (the mess buys and restocks itself,
  // no PO to sign off on) - gated instead on the two things that actually
  // land here: bill corrections (Manager) and menu changes (Manager/Deputy).
  // Alerts and Approvals share one page (Alerts.tsx, tabbed) - gate on any
  // of the three permissions that unlock a tab there, so e.g. Deputy
  // Manager (menu:approve only, no alerts:view) still reaches their Menu
  // Changes queue instead of losing the nav item entirely.
  { path: '/alerts', label: 'Alerts & Approvals', icon: Bell, badge: 'alertCount', requiredPermissionAny: [{ module: 'alerts', action: 'view' }, { module: 'billing', action: 'approve' }, { module: 'menu', action: 'approve' }], group: 'Action Queue' },
  { path: '/directives', label: 'Directives', icon: MessageSquare, badge: 'directiveCount', requiredPermission: { module: 'directives', action: 'view' }, group: 'Action Queue' },

  // --- Analysis: the deep dive, not a daily stop ---
  { path: '/reports', label: 'Reports', icon: BarChart3, requiredPermission: { module: 'reports', action: 'view' }, group: 'Analysis' },

  // --- Administration: least frequent ---
  { path: '/audit-log', label: 'Audit Log', icon: ClipboardList, requiredPermission: { module: 'audit', action: 'view' }, group: 'Administration' },
  { path: '/users', label: 'Users', icon: Users, requiredPermission: { module: 'users', action: 'view' }, group: 'Administration' },
  { path: '/roles', label: 'Roles', icon: UserCog, requiredPermission: { module: 'roles', action: 'view' }, group: 'Administration' },
  { path: '/import-export', label: 'Import / Export', icon: FileUp, requiredPermission: { module: 'import_export', action: 'view' }, group: 'Administration' },
  { path: '/settings', label: 'Settings', icon: Settings, requiredPermission: { module: 'settings', action: 'view' }, group: 'Administration' },
];

export const navItemByPath = (path: string): NavItem | undefined => navItems.find(i => i.path === path);
