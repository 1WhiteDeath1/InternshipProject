import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '@/contexts/AuthContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { FeaturesProvider } from '@/contexts/FeaturesContext';
import { Toaster } from '@/components/ui/sonner';
import SplashScreen from '@/pages/SplashScreen';
import Login from '@/pages/Login';
import Layout from '@/components/Layout';
import Dashboard from '@/pages/Dashboard';
import StockManagement from '@/pages/StockManagement';
import Bookings from '@/pages/Bookings';
import Billing from '@/pages/Billing';
import ClerkDeskLayout from '@/pages/clerk-desk/ClerkDeskLayout';
import ClerkOverview from '@/pages/clerk-desk/Overview';
import ClerkLiveGuests from '@/pages/clerk-desk/LiveGuests';
import ClerkCheckout from '@/pages/clerk-desk/Checkout';
import ClerkMessOnly from '@/pages/clerk-desk/MessOnly';
import ClerkMembers from '@/pages/clerk-desk/Members';
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
import Approvals from '@/pages/Approvals';
import Reports from '@/pages/Reports';
import Settings from '@/pages/Settings';
import ImportExport from '@/pages/ImportExport';
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
                <Route path="/stock" element={<StockManagement />} />
                <Route path="/bookings" element={<Bookings />} />
                <Route path="/billing" element={<Billing />} />
                <Route path="/clerk-desk" element={<ClerkDeskLayout />}>
                  <Route index element={<ClerkOverview />} />
                  <Route path="live" element={<ClerkLiveGuests />} />
                  <Route path="checkout" element={<ClerkCheckout />} />
                  <Route path="mess-only" element={<ClerkMessOnly />} />
                  <Route path="members" element={<ClerkMembers />} />
                </Route>
                <Route path="/guests" element={<Guests />} />
                <Route path="/attendants" element={<Attendants />} />
                <Route path="/tariffs" element={<Tariffs />} />
                <Route path="/members" element={<Members />} />
                <Route path="/members/:id" element={<MemberLedger />} />
                <Route path="/attendance" element={<Attendance />} />
                <Route path="/mess-billing" element={<MessBilling />} />
                <Route path="/kitchen" element={<Kitchen />} />
                <Route path="/security" element={<Security />} />
                <Route path="/users" element={<Users />} />
                <Route path="/roles" element={<Roles />} />
                <Route path="/audit-log" element={<AuditLog />} />
                <Route path="/alerts" element={<Alerts />} />
                <Route path="/approvals" element={<Approvals />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/import-export" element={<ImportExport />} />
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
