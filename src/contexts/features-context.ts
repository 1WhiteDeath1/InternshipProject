import { createContext } from 'react';

export interface FeatureFlag {
  id: number;
  key: string;
  name: string;
  description: string;
  department: string;
  enabled: boolean;
}

export interface FeaturesContextType {
  features: FeatureFlag[];
  isEnabled: (key: string) => boolean;
  refresh: () => Promise<void>;
  loading: boolean;
}

export const FeaturesContext = createContext<FeaturesContextType>({ features: [], isEnabled: () => false, refresh: async () => {}, loading: true });
