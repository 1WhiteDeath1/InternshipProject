import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/useAuth';
import { getHomePath } from '@/contexts/auth-context';
import { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Hotel, Loader2, Briefcase, Users, Receipt, BedDouble, ChefHat } from 'lucide-react';
import { toast } from 'sonner';

// Matches backend/seed_demo.py: one demo account per RBAC role, username =
// role, password "123456" for all - deliberately trivial, demo data only.
// Lets a client trying the app before real deployment (or a dev) jump
// straight into any role's view without memorizing six username/password
// pairs. Remove or gate this before shipping a build with real user data.
const QUICK_LOGINS = [
  { username: 'manager', label: 'Manager', icon: Briefcase },
  { username: 'deputy', label: 'Deputy Manager', icon: Users },
  { username: 'clerk', label: 'Clerk', icon: Receipt },
  { username: 'booking', label: 'Booking NCO', icon: BedDouble },
  { username: 'kitchen', label: 'Kitchen NCO', icon: ChefHat },
] as const;
const DEMO_PASSWORD = '123456';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [quickLoading, setQuickLoading] = useState<string | null>(null);
  const { login } = useAuth();
  const navigate = useNavigate();

  const doLogin = async (user: string, pass: string) => {
    try {
      const loggedInUser = await login(user, pass, rememberMe);
      toast.success('Login successful');
      navigate(getHomePath(loggedInUser));
    } catch (err) {
      toast.error(getErrorMessage(err, 'Login failed'));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      toast.error('Please enter both username and password');
      return;
    }
    setLoading(true);
    try { await doLogin(username, password); } finally { setLoading(false); }
  };

  const handleQuickLogin = async (user: string) => {
    setQuickLoading(user);
    try { await doLogin(user, DEMO_PASSWORD); } finally { setQuickLoading(null); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 to-gray-200 dark:from-slate-950 dark:to-gray-900 px-4">
      <div className="w-full max-w-md">
        <div className="bg-card rounded-2xl shadow-xl border border-border p-8">
          <div className="text-center mb-8">
            <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-blue-600 flex items-center justify-center">
              <Hotel className="text-white" size={32} />
            </div>
            <h1 className="text-2xl font-bold text-foreground">Welcome Back</h1>
            <p className="text-muted-foreground mt-1">Sign in to EME MESS Management</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="username" className="text-sm font-medium">Username</Label>
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username"
                className="h-11"
                autoComplete="username"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-medium">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                className="h-11"
                autoComplete="current-password"
              />
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="remember-me"
                checked={rememberMe}
                onCheckedChange={(checked) => setRememberMe(checked === true)}
              />
              <Label htmlFor="remember-me" className="text-sm font-normal text-muted-foreground cursor-pointer">
                Remember me on this device
              </Label>
            </div>

            <Button type="submit" className="w-full h-11 text-base font-medium" disabled={loading || !!quickLoading}>
              {loading ? <Loader2 className="animate-spin mr-2" size={18} /> : null}
              {loading ? 'Signing in...' : 'Sign In'}
            </Button>
          </form>

          <div className="mt-6 pt-5 border-t border-border">
            <p className="text-center text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
              Quick Demo Login
            </p>
            <div className="grid grid-cols-2 gap-2">
              {QUICK_LOGINS.map(({ username: u, label, icon: Icon }) => (
                <Button
                  key={u}
                  type="button"
                  variant="outline"
                  className="h-10 justify-start gap-2 text-sm font-normal"
                  disabled={loading || !!quickLoading}
                  onClick={() => handleQuickLogin(u)}
                >
                  {quickLoading === u ? <Loader2 className="animate-spin shrink-0" size={16} /> : <Icon size={16} className="shrink-0 text-muted-foreground" />}
                  {label}
                </Button>
              ))}
            </div>
          </div>

          <p className="text-center text-xs text-muted-foreground mt-4">
            Default supervisor: admin / admin123
          </p>
        </div>
      </div>
    </div>
  );
}
