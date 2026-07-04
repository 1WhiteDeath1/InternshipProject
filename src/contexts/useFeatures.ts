import { useContext } from 'react';
import { FeaturesContext } from '@/contexts/features-context';

export const useFeatures = () => useContext(FeaturesContext);
