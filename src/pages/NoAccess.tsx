import { useNavigate } from 'react-router-dom';
import { ShieldX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from '@/components/ui/empty';
import { useAuth } from '@/contexts/useAuth';
import { getHomePath } from '@/contexts/auth-context';

export default function NoAccess() {
  const navigate = useNavigate();
  const { user } = useAuth();

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ShieldX />
          </EmptyMedia>
          <EmptyTitle>You don't have access to this page</EmptyTitle>
          <EmptyDescription>
            Your role ({user?.role_name || 'this account'}) doesn't include this module. If you think this is wrong, ask your Manager to check your role's permissions.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={() => navigate(getHomePath(user))}>Go to my home screen</Button>
        </EmptyContent>
      </Empty>
    </div>
  );
}
