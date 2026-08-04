import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Home } from 'lucide-react';

export default function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-muted-foreground mb-4">404</h1>
        <p className="text-lg text-muted-foreground mb-6">Page not found</p>
        <Button onClick={() => navigate('/dashboard')}><Home size={16} className="mr-2" /> Go to Dashboard</Button>
      </div>
    </div>
  );
}
