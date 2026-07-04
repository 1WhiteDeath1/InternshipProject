import { useState } from 'react';
import api from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Download, Upload, FileUp, FileDown, Table, ClipboardList } from 'lucide-react';

const MODULES = [
  { key: 'inventory', label: 'Inventory Items', icon: Table },
  { key: 'vendors', label: 'Vendors', icon: Table },
  { key: 'rooms', label: 'Rooms', icon: Table },
  { key: 'bookings', label: 'Bookings', icon: Table },
  { key: 'audit', label: 'Audit Log', icon: ClipboardList },
];

export default function ImportExport() {
  const [uploading, setUploading] = useState(false);

  const handleDownloadTemplate = async (module: string) => {
    try {
      const res = await api.get(`/import-export/template/${module}`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${module}_template.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch { toast.error('Failed to download template'); }
  };

  const handleExport = async (module: string) => {
    try {
      const res = await api.get(`/import-export/export/${module}`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${module}_export.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success(`${module} exported`);
    } catch { toast.error('Export failed'); }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>, module: string) => {
    if (!e.target.files?.[0]) return;
    setUploading(true);
    const formData = new FormData();
    formData.append('file', e.target.files[0]);
    try {
      const res = await api.post(`/import-export/import/${module}`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success(`Imported ${res.data.imported} rows`);
      if (res.data.errors > 0) toast.error(`${res.data.errors} errors`);
    } catch { toast.error('Import failed'); }
    setUploading(false);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2"><FileUp size={24} /> Import / Export</h1>

      <div className="grid grid-cols-1 gap-4">
        {MODULES.map(mod => {
          const Icon = mod.icon;
          return (
            <Card key={mod.key}>
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                      <Icon size={20} className="text-blue-600" />
                    </div>
                    <div>
                      <p className="font-medium">{mod.label}</p>
                      <p className="text-xs text-gray-500">Import or export {mod.label.toLowerCase()}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleDownloadTemplate(mod.key)}>
                      <Download size={14} className="mr-1" /> Template
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleExport(mod.key)}>
                      <FileDown size={14} className="mr-1" /> Export
                    </Button>
                    <label className="cursor-pointer">
                      <input type="file" accept=".xlsx" className="hidden" onChange={(e) => handleImport(e, mod.key)} disabled={uploading} />
                      <Button variant="default" size="sm" asChild>
                        <span><Upload size={14} className="mr-1" /> Import</span>
                      </Button>
                    </label>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
