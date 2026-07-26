import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';

interface BrandingConfig {
  splash_title: string;
  splash_subtitle: string;
  splash_duration_seconds: number;
}

export default function SplashScreen() {
  const navigate = useNavigate();
  const [config, setConfig] = useState<BrandingConfig>({
    splash_title: 'EME MESS Management',
    splash_subtitle: 'EME Officers Mess, Rawalpindi',
    splash_duration_seconds: 3,
  });

  useEffect(() => {
    api.get('/branding').then(res => {
      setConfig(prev => ({ ...prev, ...res.data }));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      const token = localStorage.getItem('token');
      navigate(token ? '/dashboard' : '/login');
    }, config.splash_duration_seconds * 1000);
    return () => clearTimeout(timer);
  }, [config, navigate]);

  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900">
      <div className="text-center animate-fade-in">
        <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-blue-500 flex items-center justify-center shadow-2xl shadow-blue-500/30">
          <span className="text-3xl font-black text-white">EME</span>
        </div>
        <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">{config.splash_title}</h1>
        <p className="text-blue-300 text-lg">{config.splash_subtitle}</p>
        <div className="mt-8 flex justify-center">
          <div className="w-32 h-1 bg-slate-700 rounded-full overflow-hidden">
            <div className="h-full bg-blue-400 rounded-full animate-progress" />
          </div>
        </div>
      </div>
    </div>
  );
}
