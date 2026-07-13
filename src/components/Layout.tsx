import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/useAuth';
import { useTheme } from '@/contexts/useTheme';
import { useFeatures } from '@/contexts/useFeatures';
import api from '@/lib/api';
import {
  LayoutDashboard, Package, ShoppingCart, BedDouble, Receipt,
  Shield, Users, UserCog, ClipboardList, Bell, BarChart3,
  Settings, FileUp, LogOut, Sun, Moon, ChevronLeft, ChevronRight,
  IdCard, UtensilsCrossed, Wallet, ChefHat, LayoutGrid, Menu, X
} from 'lucide-react';

const navItems = [
  { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, requiresSupervisor: false },
  { path: '/inventory', label: 'Inventory', icon: Package, feature: null },
  { path: '/procurement', label: 'Procurement', icon: ShoppingCart, feature: null },
  { path: '/bookings', label: 'Bookings', icon: BedDouble, feature: null },
  { path: '/billing', label: 'Billing', icon: Receipt, feature: null },
  { path: '/clerk-desk', label: 'Clerk Desk', icon: LayoutGrid, feature: 'clerk_desk' },
  { path: '/members', label: 'Members', icon: IdCard, feature: 'mess_members' },
  { path: '/attendance', label: 'Attendance', icon: UtensilsCrossed, feature: 'mess_attendance' },
  { path: '/mess-billing', label: 'Mess Billing', icon: Wallet, feature: 'mess_billing' },
  { path: '/kitchen', label: 'Kitchen', icon: ChefHat, feature: 'kitchen_module' },
  { path: '/security', label: 'Security', icon: Shield, feature: null },
  { path: '/users', label: 'Users', icon: Users, requiresSupervisor: true },
  { path: '/roles', label: 'Roles', icon: UserCog, requiresSupervisor: true },
  { path: '/audit-log', label: 'Audit Log', icon: ClipboardList, requiresSupervisor: true },
  { path: '/alerts', label: 'Alerts', icon: Bell, badge: 'alertCount' },
  { path: '/reports', label: 'Reports', icon: BarChart3, requiresSupervisor: true },
  { path: '/import-export', label: 'Import / Export', icon: FileUp, requiresSupervisor: true },
  { path: '/settings', label: 'Settings', icon: Settings, requiresSupervisor: true },
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
    const fetchAlerts = async () => {
      try {
        const res = await api.get('/alerts/unread-count');
        setAlertCount(res.data.count);
      } catch { /* silent - alert badge just stays at its last known value */ }
    };
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading || !user) return null;

  const filteredNav = navItems.filter(item => {
    if (item.requiresSupervisor && !user.is_supervisor) return false;
    if (item.feature && !isEnabled(item.feature)) return false;
    return true;
  });

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
            {user.is_supervisor && (
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
    </div>
  );
}
