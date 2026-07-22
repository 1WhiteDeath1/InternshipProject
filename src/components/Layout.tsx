import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/useAuth';
import { hasPermission } from '@/contexts/auth-context';
import { useTheme } from '@/contexts/useTheme';
import { useFeatures } from '@/contexts/useFeatures';
import api from '@/lib/api';
import {
  LayoutDashboard, Package, BedDouble, Receipt,
  Shield, Users, UserCog, ClipboardList, Bell, BarChart3,
  Settings, FileUp, LogOut, Sun, Moon, ChevronLeft, ChevronRight,
  IdCard, UtensilsCrossed, Wallet, ChefHat, LayoutGrid, Menu, X, Contact, UserCircle2, TrendingUp, ClipboardCheck,
  Plus, Receipt as ReceiptIcon, Camera, ShieldAlert, RefreshCw, UtensilsCrossed as OrderIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QuickBookingModal } from '@/components/QuickBookingModal';
import { QuickChargeModal } from '@/components/QuickChargeModal';
import { QuickAddAttendantModal } from '@/components/QuickAddAttendantModal';
import { QuickAddMemberModal } from '@/components/QuickAddMemberModal';
import { QuickIncidentModal } from '@/components/QuickIncidentModal';

// Top-bar "fast action" shortcuts - each is a create/act-now action for one
// module, restricted to the pages that belong to that module (matched by
// path prefix) so a Kitchen order button never shows up while looking at
// Security, and vice versa. `variant` defaults to 'default'.
const quickActionDefs: {
  key: string; label: string; icon: typeof Plus; match: (path: string) => boolean; variant?: 'default' | 'secondary';
}[] = [
  { key: 'booking', label: 'New Booking', icon: Plus, match: p => p.startsWith('/bookings') || p.startsWith('/clerk-desk') },
  { key: 'charge', label: 'Log Charge', icon: ReceiptIcon, match: p => p.startsWith('/billing') || p.startsWith('/clerk-desk'), variant: 'secondary' },
  { key: 'scan', label: 'Scan Receipt', icon: Camera, match: p => p.startsWith('/stock') },
  { key: 'attendant', label: 'Add Attendant', icon: UserCircle2, match: p => p.startsWith('/attendants') },
  { key: 'member', label: 'Add Member', icon: IdCard, match: p => p.startsWith('/members') },
  { key: 'incident', label: 'Report Incident', icon: ShieldAlert, match: p => p.startsWith('/security') },
  { key: 'alacarte', label: 'New À La Carte', icon: OrderIcon, match: p => p.startsWith('/kitchen') },
  { key: 'generate', label: 'Generate Bills', icon: RefreshCw, match: p => p.startsWith('/mess-billing') },
];

const navItems = [
  { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/stock', label: 'Inventory & Procurement', icon: Package, feature: null, requiredPermission: { module: 'inventory', action: 'view' } },
  { path: '/bookings', label: 'Bookings', icon: BedDouble, feature: null, requiredPermission: { module: 'bookings', action: 'view' } },
  { path: '/billing', label: 'Billing', icon: Receipt, feature: null, requiredPermission: { module: 'billing', action: 'view' } },
  { path: '/clerk-desk', label: 'Clerk Desk', icon: LayoutGrid, feature: 'clerk_desk', requiredPermission: { module: 'clerk_desk', action: 'view' } },
  { path: '/guests', label: 'Guests', icon: Contact, feature: null, requiredPermission: { module: 'guests', action: 'view' } },
  { path: '/attendants', label: 'Attendants', icon: UserCircle2, feature: null, requiredPermission: { module: 'attendants', action: 'view' } },
  { path: '/members', label: 'Members', icon: IdCard, feature: 'mess_members', requiredPermission: { module: 'members', action: 'view' } },
  { path: '/attendance', label: 'Attendance', icon: UtensilsCrossed, feature: 'mess_attendance', requiredPermission: { module: 'attendance', action: 'view' } },
  { path: '/mess-billing', label: 'Mess Billing', icon: Wallet, feature: 'mess_billing', requiredPermission: { module: 'mess_billing', action: 'view' } },
  { path: '/kitchen', label: 'Kitchen', icon: ChefHat, feature: 'kitchen_module', requiredPermission: { module: 'kitchen', action: 'view' } },
  { path: '/security', label: 'Security', icon: Shield, feature: null, requiredPermission: { module: 'security', action: 'view' } },
  { path: '/approvals', label: 'Approvals', icon: ClipboardCheck, requiredPermission: { module: 'procurement', action: 'approve' } },
  { path: '/users', label: 'Users', icon: Users, requiredPermission: { module: 'users', action: 'view' } },
  { path: '/roles', label: 'Roles', icon: UserCog, requiredPermission: { module: 'roles', action: 'view' } },
  { path: '/audit-log', label: 'Audit Log', icon: ClipboardList, requiredPermission: { module: 'audit', action: 'view' } },
  { path: '/alerts', label: 'Alerts', icon: Bell, badge: 'alertCount', requiredPermission: { module: 'alerts', action: 'view' } },
  { path: '/tariffs', label: 'Tariffs', icon: TrendingUp, requiredPermission: { module: 'tariffs', action: 'view' } },
  { path: '/reports', label: 'Reports', icon: BarChart3, requiredPermission: { module: 'reports', action: 'view' } },
  { path: '/import-export', label: 'Import / Export', icon: FileUp, requiredPermission: { module: 'import_export', action: 'view' } },
  { path: '/settings', label: 'Settings', icon: Settings, requiredPermission: { module: 'settings', action: 'view' } },
];

export default function Layout() {
  const { user, logout, loading } = useAuth();
  const { darkMode, toggleDarkMode } = useTheme();
  const { isEnabled } = useFeatures();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  // Below lg the sidebar becomes an overlay drawer opened from the header's
  // hamburger button; it closes on navigation or backdrop tap.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [alertCount, setAlertCount] = useState(0);
  const [quickBookingOpen, setQuickBookingOpen] = useState(false);
  const [quickChargeOpen, setQuickChargeOpen] = useState(false);
  const [quickAttendantOpen, setQuickAttendantOpen] = useState(false);
  const [quickMemberOpen, setQuickMemberOpen] = useState(false);
  const [quickIncidentOpen, setQuickIncidentOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate('/login');
  }, [user, loading, navigate]);

  // Close the drawer on navigation (adjust-state-during-render, not an effect)
  const [prevPath, setPrevPath] = useState(location.pathname);
  if (location.pathname !== prevPath) {
    setPrevPath(location.pathname);
    setDrawerOpen(false);
  }

  useEffect(() => {
    if (!hasPermission(user, 'alerts', 'view')) return;
    const fetchAlerts = async () => {
      try {
        const res = await api.get('/alerts/unread-count');
        setAlertCount(res.data.count);
      } catch { /* silent - alert badge just stays at its last known value */ }
    };
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 30000);
    return () => clearInterval(interval);
  }, [user]);

  if (loading || !user) return null;

  const filteredNav = navItems.filter(item => {
    if (item.requiredPermission && !hasPermission(user, item.requiredPermission.module, item.requiredPermission.action)) return false;
    if (item.feature && !isEnabled(item.feature)) return false;
    return true;
  });

  const quickActionHandlers: Record<string, () => void> = {
    booking: () => setQuickBookingOpen(true),
    charge: () => setQuickChargeOpen(true),
    scan: () => navigate('/stock', { state: { openScan: true } }),
    attendant: () => setQuickAttendantOpen(true),
    member: () => setQuickMemberOpen(true),
    incident: () => setQuickIncidentOpen(true),
    alacarte: () => navigate('/kitchen', { state: { openAlaCarte: true } }),
    generate: () => navigate('/mess-billing', { state: { autoGenerate: true } }),
  };
  const activeQuickActions = quickActionDefs.filter(a => a.match(location.pathname));

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-950">
      {/* Backdrop for the mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setDrawerOpen(false)} />
      )}

      {/* Sidebar: static on desktop, slide-in drawer below lg */}
      <aside className={`
        ${collapsed ? 'lg:w-16' : 'lg:w-64'} w-72 max-w-[85vw]
        bg-slate-900 text-white flex flex-col transition-all duration-300 flex-shrink-0
        fixed inset-y-0 left-0 z-50 transform lg:transform-none lg:static
        ${drawerOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="h-16 flex items-center px-4 border-b border-slate-700">
          {!collapsed && <span className="text-xl font-bold tracking-tight">EME MESS</span>}
          <button onClick={() => setCollapsed(!collapsed)} className="ml-auto p-1.5 rounded hover:bg-slate-700 transition-colors hidden lg:block">
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
          <button onClick={() => setDrawerOpen(false)} className="ml-auto p-1.5 rounded hover:bg-slate-700 transition-colors lg:hidden">
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 py-4 overflow-y-auto">
          {filteredNav.map(item => {
            const isActive = location.pathname === item.path;
            const Icon = item.icon;
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-all duration-200 relative
                  ${isActive
                    ? 'bg-blue-600/20 text-blue-400 border-l-3 border-blue-500'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white border-l-3 border-transparent'
                  }`}
                title={collapsed ? item.label : undefined}
              >
                <Icon size={20} />
                {(!collapsed || drawerOpen) && (
                  <>
                    <span className="text-base">{item.label}</span>
                    {item.badge === 'alertCount' && alertCount > 0 && (
                      <span className="ml-auto bg-red-500 text-white text-sm font-bold rounded-full h-6 min-w-6 flex items-center justify-center px-1.5 animate-pulse">
                        {alertCount}
                      </span>
                    )}
                  </>
                )}
                {collapsed && !drawerOpen && item.badge === 'alertCount' && alertCount > 0 && (
                  <span className="absolute top-2 right-2 w-2.5 h-2.5 bg-red-500 rounded-full" />
                )}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-700 p-3">
          <button
            onClick={toggleDarkMode}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
          >
            {darkMode ? <Sun size={18} /> : <Moon size={18} />}
            {(!collapsed || drawerOpen) && <span className="text-base">{darkMode ? 'Light Mode' : 'Dark Mode'}</span>}
          </button>
          <button
            onClick={logout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-300 hover:bg-red-900/40 hover:text-red-400 transition-colors mt-1"
          >
            <LogOut size={18} />
            {(!collapsed || drawerOpen) && <span className="text-base">Logout</span>}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Bar */}
        <header className="h-16 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex items-center px-4 sm:px-6 justify-between flex-shrink-0 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => setDrawerOpen(true)} className="p-2 -ml-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors lg:hidden">
              <Menu size={22} className="text-gray-700 dark:text-gray-300" />
            </button>
            <div className="flex items-center gap-2 text-base text-gray-500 dark:text-gray-400 min-w-0">
              {location.pathname !== '/dashboard' && (
                <>
                  <button onClick={() => navigate('/dashboard')} className="hover:text-blue-600 transition-colors hidden sm:block">Home</button>
                  <span className="hidden sm:block">/</span>
                  <span className="text-gray-700 dark:text-gray-300 font-medium capitalize truncate">
                    {location.pathname.slice(1).replace(/-/g, ' ')}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            {activeQuickActions.length > 0 && (
              <div className="hidden sm:flex items-center gap-2">
                {activeQuickActions.map(action => {
                  const Icon = action.icon;
                  return (
                    <Button key={action.key} size="sm" variant={action.variant || 'default'} onClick={quickActionHandlers[action.key]}>
                      <Icon size={15} className="mr-1" /> {action.label}
                    </Button>
                  );
                })}
              </div>
            )}
            {hasPermission(user, 'alerts', 'view') && (
              <button
                onClick={() => navigate('/alerts')}
                className="relative p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <Bell size={22} className="text-gray-600 dark:text-gray-400" />
                {alertCount > 0 && (
                  <span className="absolute top-0.5 right-0.5 h-5 min-w-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center px-1">
                    {alertCount}
                  </span>
                )}
              </button>
            )}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800">
              <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-bold">
                {user.full_name?.charAt(0)?.toUpperCase() || 'U'}
              </div>
              <div className="hidden md:block">
                <p className="text-base font-medium text-gray-900 dark:text-gray-100 leading-tight">{user.full_name}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 leading-tight">{user.role_name}</p>
              </div>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <Outlet />
        </main>
      </div>

      <QuickBookingModal open={quickBookingOpen} onOpenChange={setQuickBookingOpen} />
      <QuickChargeModal open={quickChargeOpen} onOpenChange={setQuickChargeOpen} />
      <QuickAddAttendantModal open={quickAttendantOpen} onOpenChange={setQuickAttendantOpen} />
      <QuickAddMemberModal open={quickMemberOpen} onOpenChange={setQuickMemberOpen} />
      <QuickIncidentModal open={quickIncidentOpen} onOpenChange={setQuickIncidentOpen} />
    </div>
  );
}
