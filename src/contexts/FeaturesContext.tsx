import React, { useState, useEffect } from 'react';
import api from '@/lib/api';
import { FeaturesContext, type FeatureFlag } from '@/contexts/features-context';

export function FeaturesProvider({ children }: { children: React.ReactNode }) {
  const [features, setFeatures] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const res = await api.get('/features');
      setFeatures(res.data);
    } catch { /* feature flags default to disabled when unavailable */ }
    setLoading(false);
  };

  useEffect(() => {
    queueMicrotask(() => {
      if (localStorage.getItem('token')) {
        refresh();
      } else {
        setLoading(false);
      }
    });
  }, []);
  const isEnabled = (key: string) => features.find(f => f.key === key)?.enabled ?? false;

  return (
    <FeaturesContext.Provider value={{ features, isEnabled, refresh, loading }}>
      {children}
    </FeaturesContext.Provider>
  );
}
