import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { useAuth } from '@/contexts/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Settings as SettingsIcon, Save, Database, Shield, ToggleLeft, Archive } from 'lucide-react';

interface SystemSetting {
  id: number;
  key: string;
  value: string;
  description: string;
}

interface FeatureFlag {
  id: number;
  key: string;
  name: string;
  description: string;
  department: string;
  enabled: boolean;
}

interface Backup {
  filename: string;
  created: string;
}

export default function Settings() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<SystemSetting[]>([]);
  const [features, setFeatures] = useState<FeatureFlag[]>([]);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [backups, setBackups] = useState<Backup[]>([]);

  const fetchSettings = async () => {
    try { const res = await api.get('/settings'); setSettings(res.data); } catch { /* keep last known settings */ }
  };

  const fetchFeatures = async () => {
    try { const res = await api.get('/features'); setFeatures(res.data); } catch { /* keep last known features */ }
  };

  const fetchBackups = async () => {
    try { const res = await api.get('/backup/list'); setBackups(res.data); } catch { /* keep last known backups */ }
  };

  useEffect(() => {
    queueMicrotask(() => {
      if (user?.is_supervisor) {
        fetchSettings();
        fetchFeatures();
        fetchBackups();
      }
    });
  }, [user]);

  const handleSaveSetting = async (key: string) => {
    try {
      await api.put(`/settings/${key}`, { value: editing[key] });
      toast.success('Setting saved');
      fetchSettings();
    } catch { toast.error('Failed'); }
  };

  const handleToggleFeature = async (id: number, enabled: boolean) => {
    try {
      await api.put(`/features/${id}/toggle`, { enabled });
      toast.success('Feature updated');
      fetchFeatures();
    } catch { toast.error('Failed'); }
  };

  const handleBackup = async () => {
    try {
      await api.post('/backup/create');
      toast.success('Backup created');
      fetchBackups();
    } catch { toast.error('Failed'); }
  };

  const groupedFeatures = features.reduce((acc: Record<string, FeatureFlag[]>, f) => {
    if (!acc[f.department]) acc[f.department] = [];
    acc[f.department].push(f);
    return acc;
  }, {});

  if (!user?.is_supervisor) {
    return <div className="text-center py-20 text-gray-500"><Shield size={48} className="mx-auto mb-4 opacity-50" />Supervisor access required</div>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2"><SettingsIcon size={24} /> Settings</h1>

      {/* System Settings */}
      <Card>
        <CardHeader><CardTitle className="text-base">System Settings</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {settings.map(s => (
            <div key={s.id} className="flex items-center gap-4">
              <div className="flex-1">
                <p className="text-sm font-medium">{s.key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</p>
                <p className="text-xs text-gray-500">{s.description}</p>
              </div>
              <Input
                value={editing[s.key] ?? s.value ?? ''}
                onChange={e => setEditing({...editing, [s.key]: e.target.value})}
                className="w-48"
              />
              <Button size="sm" onClick={() => handleSaveSetting(s.key)}><Save size={14} /></Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Feature Flags */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><ToggleLeft size={18} /> Feature Flags</CardTitle></CardHeader>
        <CardContent className="space-y-6">
          {Object.entries(groupedFeatures).map(([dept, flags]) => (
            <div key={dept}>
              <h3 className="text-sm font-semibold text-gray-600 capitalize mb-3">{dept}</h3>
              <div className="space-y-3">
                {flags.map(f => (
                  <div key={f.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                    <div>
                      <p className="text-sm font-medium">{f.name}</p>
                      <p className="text-xs text-gray-500">{f.description}</p>
                    </div>
                    <Switch checked={f.enabled} onCheckedChange={(v) => handleToggleFeature(f.id, v)} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Backup */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Database size={18} /> Backup</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Button onClick={handleBackup}><Archive size={16} className="mr-2" /> Create Backup Now</Button>
          </div>
          {backups.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Recent Backups</p>
              {backups.slice(0, 5).map((b, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-gray-100 text-sm">
                  <span>{b.filename}</span>
                  <span className="text-gray-500">{new Date(b.created).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
