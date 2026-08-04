import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/useAuth';
import { hasPermission, getHomePath } from '@/contexts/auth-context';
import { useTheme } from '@/contexts/useTheme';
import { useFeatures } from '@/contexts/useFeatures';
import api from '@/lib/api';
import { navItems } from '@/lib/navConfig';
import {
  Bell, LogOut, Sun, Moon, MoreHorizontal,
  Plus, Receipt as ReceiptIcon, Camera, ShieldAlert, RefreshCw, UtensilsCrossed as OrderIcon, UserCircle2, IdCard,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarFooter,
  SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarMenuBadge, SidebarTrigger, SidebarInset,
} from '@/components/ui/sidebar';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  permission?: { module: string; action: string };
}[] = [
  { key: 'booking', label: 'New Booking', icon: Plus, match: p => p.startsWith('/bookings') },
  { key: 'charge', label: 'Log Charge', icon: ReceiptIcon, match: p => p.startsWith('/billing'), variant: 'secondary' },
  { key: 'scan', label: 'Scan Receipt', icon: Camera, match: p => p.startsWith('/stock') },
  // Manager can view the Attendants directory (attendants:view, for the
  // Activity History leaderboard) without roster CRUD - that stays Booking
  // NCO's job, so this shortcut needs its own explicit permission check
  // rather than just the path match every other quick action relies on.
  { key: 'attendant', label: 'Add Attendant', icon: UserCircle2, match: p => p.startsWith('/attendants'), permission: { module: 'attendants', action: 'create' } },
  { key: 'member', label: 'Add Member', icon: IdCard, match: p => p.startsWith('/members') },
  { key: 'incident', label: 'Report Incident', icon: ShieldAlert, match: p => p.startsWith('/security') },
  { key: 'alacarte', label: 'New À La Carte', icon: OrderIcon, match: p => p.startsWith('/kitchen') },
  { key: 'generate', label: 'Generate Bills', icon: RefreshCw, match: p => p.startsWith('/mess-billing') },
];

function QuickActionsDropdown({ actions, onSelect }: {
  actions: typeof quickActionDefs;
  onSelect: (key: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className="sm:hidden">
          <MoreHorizontal size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.map(action => {
          const Icon = action.icon;
          return (
            <DropdownMenuItem key={action.key} onClick={() => onSelect(action.key)}>
              <Icon size={15} className="mr-2" /> {action.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SidebarNav() {
  const { user } = useAuth();
  const { isEnabled } = useFeatures();
  const navigate = useNavigate();
  const location = useLocation();
  const [alertCount, setAlertCount] = useState(0);
  const [directiveCount, setDirectiveCount] = useState(0);

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

  useEffect(() => {
    if (!hasPermission(user, 'directives', 'view')) return;
    const fetchDirectives = async () => {
      try {
        const res = await api.get('/directives/unread-count');
        setDirectiveCount(res.data.count);
      } catch { /* silent - badge just stays at its last known value */ }
    };
    fetchDirectives();
    const interval = setInterval(fetchDirectives, 30000);
    return () => clearInterval(interval);
  }, [user]);

  const homePath = getHomePath(user);
  const noDashboard = homePath !== '/dashboard';

  const filteredNav = navItems.filter(item => {
    if (item.path === '/dashboard' && noDashboard) return false;
    if (item.requiredPermission && !hasPermission(user, item.requiredPermission.module, item.requiredPermission.action)) return false;
    if (item.requiredPermissionAny && !item.requiredPermissionAny.some(p => hasPermission(user, p.module, p.action))) return false;
    if (item.requiredPermissionAll && !item.requiredPermissionAll.every(p => hasPermission(user, p.module, p.action))) return false;
    if (item.feature && !isEnabled(item.feature)) return false;
    return true;
  });

  return (
    <SidebarMenu>
      {filteredNav.map(item => {
        const isActive = location.pathname === item.path;
        const Icon = item.icon;
        const badgeCount = item.badge === 'alertCount' ? alertCount : item.badge === 'directiveCount' ? directiveCount : 0;
        return (
          <SidebarMenuItem key={item.path}>
            <SidebarMenuButton isActive={isActive} tooltip={item.label} onClick={() => navigate(item.path)}>
              <Icon />
              <span>{item.label}</span>
            </SidebarMenuButton>
            {badgeCount > 0 && (
              <SidebarMenuBadge className={item.badge === 'alertCount' ? 'bg-red-500 text-white' : 'bg-violet-500 text-white'}>
                {badgeCount}
              </SidebarMenuBadge>
            )}
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

export default function Layout() {
  const { user, logout, loading } = useAuth();
  const { darkMode, toggleDarkMode } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [quickBookingOpen, setQuickBookingOpen] = useState(false);
  const [quickChargeOpen, setQuickChargeOpen] = useState(false);
  const [quickAttendantOpen, setQuickAttendantOpen] = useState(false);
  const [quickMemberOpen, setQuickMemberOpen] = useState(false);
  const [quickIncidentOpen, setQuickIncidentOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate('/login');
  }, [user, loading, navigate]);

  const homePath = getHomePath(user);
  const noDashboard = homePath !== '/dashboard';

  // Booking NCO has no Dashboard of its own - bounce back to their real home
  // if they land on /dashboard anyway (direct URL, stale link, browser back).
  useEffect(() => {
    if (!loading && user && noDashboard && location.pathname === '/dashboard') navigate(homePath, { replace: true });
  }, [user, loading, noDashboard, homePath, location.pathname, navigate]);

  if (loading || !user) return null;

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
  const activeQuickActions = quickActionDefs.filter(a =>
    a.match(location.pathname) && (!a.permission || hasPermission(user, a.permission.module, a.permission.action)));

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader className="h-16 flex-row items-center justify-center px-4 group-data-[collapsible=icon]:px-0">
          <span className="text-xl font-bold tracking-tight text-sidebar-foreground group-data-[collapsible=icon]:hidden">EME MESS</span>
          <span className="hidden text-lg font-bold text-sidebar-foreground group-data-[collapsible=icon]:!block">E</span>
        </SidebarHeader>
        <SidebarContent className="px-2 py-2">
          <SidebarNav />
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip={darkMode ? 'Light Mode' : 'Dark Mode'} onClick={toggleDarkMode}>
                {darkMode ? <Sun /> : <Moon />}
                <span>{darkMode ? 'Light Mode' : 'Dark Mode'}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Logout" onClick={logout} className="text-destructive hover:bg-destructive/10 hover:text-destructive">
                <LogOut />
                <span>Logout</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        {/* Top Bar */}
        <header className="h-16 bg-card border-b border-border flex items-center px-4 sm:px-6 justify-between flex-shrink-0 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <SidebarTrigger />
            <div className="flex items-center gap-2 text-base text-muted-foreground min-w-0">
              {location.pathname !== homePath && (
                <>
                  <button onClick={() => navigate(homePath)} className="hover:text-primary transition-colors hidden sm:block">Home</button>
                  <span className="hidden sm:block">/</span>
                  <span className="text-foreground font-medium capitalize truncate">
                    {location.pathname.slice(1).replace(/-/g, ' ')}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            {activeQuickActions.length > 0 && (
              <div className="flex items-center gap-2">
                {activeQuickActions.map(action => {
                  const Icon = action.icon;
                  return (
                    <Button key={action.key} size="sm" variant={action.variant || 'default'} onClick={quickActionHandlers[action.key]}
                      className="hidden sm:inline-flex">
                      <Icon size={15} className="mr-1" /> {action.label}
                    </Button>
                  );
                })}
                {/* Below sm, quick actions collapse into a dropdown instead of
                    disappearing entirely - a phone-carrying front desk is
                    exactly where a fast "New Booking" button matters most. */}
                <QuickActionsDropdown actions={activeQuickActions} onSelect={key => quickActionHandlers[key]()} />
              </div>
            )}
            {hasPermission(user, 'alerts', 'view') && (
              <button
                onClick={() => navigate('/alerts')}
                className="relative p-2 rounded-lg hover:bg-accent transition-colors"
              >
                <Bell size={22} className="text-muted-foreground" />
              </button>
            )}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted">
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-sm font-bold">
                {user.full_name?.charAt(0)?.toUpperCase() || 'U'}
              </div>
              <div className="hidden md:block">
                <p className="text-base font-medium text-foreground leading-tight">{user.full_name}</p>
                <p className="text-sm text-muted-foreground leading-tight">{user.role_name}</p>
              </div>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <Outlet />
        </main>
      </SidebarInset>

      <QuickBookingModal open={quickBookingOpen} onOpenChange={setQuickBookingOpen} />
      <QuickChargeModal open={quickChargeOpen} onOpenChange={setQuickChargeOpen} />
      <QuickAddAttendantModal open={quickAttendantOpen} onOpenChange={setQuickAttendantOpen} />
      <QuickAddMemberModal open={quickMemberOpen} onOpenChange={setQuickMemberOpen} />
      <QuickIncidentModal open={quickIncidentOpen} onOpenChange={setQuickIncidentOpen} />
    </SidebarProvider>
  );
}
