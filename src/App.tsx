import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '@/contexts/AuthContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { FeaturesProvider } from '@/contexts/FeaturesContext';
import { Toaster } from '@/components/ui/sonner';
import SplashScreen from '@/pages/SplashScreen';
import Login from '@/pages/Login';
import Layout from '@/components/Layout';
import Dashboard from '@/pages/Dashboard';
import Inventory from '@/pages/Inventory';
import Procurement from '@/pages/Procurement';
import Bookings from '@/pages/Bookings';
import Billing from '@/pages/Billing';
import Security from '@/pages/Security';
import Users from '@/pages/Users';
import Roles from '@/pages/Roles';
import AuditLog from '@/pages/AuditLog';
import Alerts from '@/pages/Alerts';
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
                <Route path="/inventory" element={<Inventory />} />
                <Route path="/procurement" element={<Procurement />} />
                <Route path="/bookings" element={<Bookings />} />
                <Route path="/billing" element={<Billing />} />
                <Route path="/security" element={<Security />} />
                <Route path="/users" element={<Users />} />
                <Route path="/roles" element={<Roles />} />
                <Route path="/audit-log" element={<AuditLog />} />
                <Route path="/alerts" element={<Alerts />} />
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
