import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from '@/contexts/AuthContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { FeaturesProvider } from '@/contexts/FeaturesContext';
import { Toaster } from '@/components/ui/sonner';
import { RequirePermission } from '@/components/RequirePermission';
import { navItemByPath } from '@/lib/navConfig';
import SplashScreen from '@/pages/SplashScreen';
import Login from '@/pages/Login';
import Layout from '@/components/Layout';
import Dashboard from '@/pages/Dashboard';
import StockManagement from '@/pages/StockManagement';
import Bookings from '@/pages/Bookings';
import RoomsOverview from '@/pages/RoomsOverview';
import Billing from '@/pages/Billing';
import ClerkDeskLayout from '@/pages/clerk-desk/ClerkDeskLayout';
import ClerkLiveGuests from '@/pages/clerk-desk/LiveGuests';
import ClerkCheckout from '@/pages/clerk-desk/Checkout';
import ClerkMessOnly from '@/pages/clerk-desk/MessOnly';
import ClerkMembers from '@/pages/clerk-desk/Members';
import ClerkEvents from '@/pages/clerk-desk/Events';
import BillingReports from '@/pages/BillingReports';
import Expenses from '@/pages/Expenses';
import Guests from '@/pages/Guests';
import Attendants from '@/pages/Attendants';
import Tariffs from '@/pages/Tariffs';
import Members from '@/pages/Members';
import MemberLedger from '@/pages/MemberLedger';
import Attendance from '@/pages/Attendance';
import MessBilling from '@/pages/MessBilling';
import Kitchen from '@/pages/Kitchen';
import Security from '@/pages/Security';
import Users from '@/pages/Users';
import Roles from '@/pages/Roles';
import AuditLog from '@/pages/AuditLog';
import Alerts from '@/pages/Alerts';
import Reports from '@/pages/Reports';
import Settings from '@/pages/Settings';
import ImportExport from '@/pages/ImportExport';
import Events from '@/pages/Events';
import Directives from '@/pages/Directives';
import NotFound from '@/pages/NotFound';

function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <FeaturesProvider>
            <Routes>
              <Route path="/" element={<SplashScreen />} />
              <Route path="/login" element={<Login />} />
              <Route element={<Layout />}>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/stock" element={<RequirePermission item={navItemByPath('/stock')}><StockManagement /></RequirePermission>} />
                <Route path="/bookings" element={<RequirePermission item={navItemByPath('/bookings')}><Bookings /></RequirePermission>} />
                <Route path="/rooms-overview" element={<RequirePermission item={navItemByPath('/rooms-overview')}><RoomsOverview /></RequirePermission>} />
                <Route path="/billing" element={<RequirePermission item={navItemByPath('/billing')}><Billing /></RequirePermission>} />
                <Route path="/clerk-desk" element={<RequirePermission item={navItemByPath('/clerk-desk')}><ClerkDeskLayout /></RequirePermission>}>
                  <Route index element={<Navigate to="live" replace />} />
                  <Route path="live" element={<ClerkLiveGuests />} />
                  <Route path="checkout" element={<ClerkCheckout />} />
                  <Route path="mess-only" element={<ClerkMessOnly />} />
                  <Route path="members" element={<ClerkMembers />} />
                  <Route path="events" element={<ClerkEvents />} />
                </Route>
                <Route path="/billing-reports" element={<RequirePermission item={navItemByPath('/billing-reports')}><BillingReports /></RequirePermission>} />
                <Route path="/expenses" element={<RequirePermission item={navItemByPath('/expenses')}><Expenses /></RequirePermission>} />
                <Route path="/guests" element={<RequirePermission item={navItemByPath('/guests')}><Guests /></RequirePermission>} />
                <Route path="/attendants" element={<RequirePermission item={navItemByPath('/attendants')}><Attendants /></RequirePermission>} />
                <Route path="/tariffs" element={<RequirePermission item={navItemByPath('/tariffs')}><Tariffs /></RequirePermission>} />
                <Route path="/members" element={<RequirePermission item={navItemByPath('/members')}><Members /></RequirePermission>} />
                <Route path="/members/:id" element={<RequirePermission item={navItemByPath('/members')}><MemberLedger /></RequirePermission>} />
                <Route path="/attendance" element={<RequirePermission item={navItemByPath('/attendance')}><Attendance /></RequirePermission>} />
                <Route path="/mess-billing" element={<RequirePermission item={navItemByPath('/mess-billing')}><MessBilling /></RequirePermission>} />
                <Route path="/kitchen" element={<RequirePermission item={navItemByPath('/kitchen')}><Kitchen /></RequirePermission>} />
                <Route path="/security" element={<RequirePermission item={navItemByPath('/security')}><Security /></RequirePermission>} />
                <Route path="/users" element={<RequirePermission item={navItemByPath('/users')}><Users /></RequirePermission>} />
                <Route path="/roles" element={<RequirePermission item={navItemByPath('/roles')}><Roles /></RequirePermission>} />
                <Route path="/audit-log" element={<RequirePermission item={navItemByPath('/audit-log')}><AuditLog /></RequirePermission>} />
                <Route path="/alerts" element={<RequirePermission item={navItemByPath('/alerts')}><Alerts /></RequirePermission>} />
                <Route path="/directives" element={<RequirePermission item={navItemByPath('/directives')}><Directives /></RequirePermission>} />
                <Route path="/reports" element={<RequirePermission item={navItemByPath('/reports')}><Reports /></RequirePermission>} />
                <Route path="/settings" element={<RequirePermission item={navItemByPath('/settings')}><Settings /></RequirePermission>} />
                <Route path="/import-export" element={<RequirePermission item={navItemByPath('/import-export')}><ImportExport /></RequirePermission>} />
                <Route path="/events" element={<RequirePermission item={navItemByPath('/events')}><Events /></RequirePermission>} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
            <Toaster position="top-right" richColors />
          </FeaturesProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

export default App;
