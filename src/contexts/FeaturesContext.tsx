import React, { useState, useEffect } from 'react';
import api from '@/lib/api';
import { FeaturesContext, type FeatureFlag } from '@/contexts/features-context';
import { useAuth } from '@/contexts/useAuth';

export function FeaturesProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [features, setFeatures] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const res = await api.get('/features');
      setFeatures(res.data);
    } catch { /* feature flags default to disabled when unavailable */ }
    setLoading(false);
  };

  // Keyed off the live `user` object, not a one-time localStorage check at
  // mount: this provider mounts before login (no token yet), so a mount-only
  // check would leave every feature-gated nav item (Clerk Desk, Members,
  // Kitchen, ...) permanently hidden for the rest of the session once the
  // user logs in through the in-app form rather than a full page reload.
  useEffect(() => {
    queueMicrotask(() => {
      if (user) {
        refresh();
      } else {
        setFeatures([]);
        setLoading(false);
      }
    });
  }, [user]);
  const isEnabled = (key: string) => features.find(f => f.key === key)?.enabled ?? false;

  return (
    <FeaturesContext.Provider value={{ features, isEnabled, refresh, loading }}>
      {children}
    </FeaturesContext.Provider>
  );
}
