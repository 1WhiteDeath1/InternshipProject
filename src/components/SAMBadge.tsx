import { useEffect, useState } from 'react';
import api from '@/lib/api';

interface BrandingConfig {
  badge_text: string;
  badge_position: string;
  splash_title: string;
  splash_subtitle: string;
}

export default function SAMBadge() {
  const [config, setConfig] = useState<BrandingConfig | null>(null);

  useEffect(() => {
    api.get('/branding').then(res => setConfig(res.data)).catch(() => {});
  }, []);

  if (!config) return null;

  const position = config.badge_position || 'bottom-right';
  const posClasses: Record<string, string> = {
    'bottom-right': 'bottom-4 right-4',
    'bottom-left': 'bottom-4 left-4',
    'top-right': 'top-4 right-4',
    'top-left': 'top-4 left-4',
  };

  return (
    <div className={`fixed ${posClasses[position] || posClasses['bottom-right']} z-50 select-none`}>
      <div className="bg-slate-800/90 text-white px-3 py-1.5 rounded-lg text-sm font-semibold shadow-lg backdrop-blur-sm border border-slate-600/50">
        {config.badge_text}
      </div>
    </div>
  );
}
