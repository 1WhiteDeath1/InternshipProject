import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChefHat } from 'lucide-react';
import { MealsBoard } from '@/pages/kitchen/MealsBoard';
import { ChargesTab } from '@/pages/kitchen/ChargesTab';
import { MenuTab } from '@/pages/kitchen/MenuTab';
import { SpecialOrderDialog } from '@/components/SpecialOrderDialog';

/* Kitchen NCO's whole day in three tabs.
   - Meals   : the merged Attendance + Production board (who's eating what,
               and cooking it) - the only screen touched per service.
   - Charges : the merged Mess Charges Overview + Departures list.
   - Menu    : dish/price proposals, occasional policy work.

   Previously this was four Kitchen tabs plus a separate top-level Attendance
   page, with the same task split across two of them. */

export default function Kitchen() {
  const location = useLocation();
  const navigate = useNavigate();
  const [tab, setTab] = useState('meals');
  const [specialOpen, setSpecialOpen] = useState(false);
  const [boardKey, setBoardKey] = useState(0);

  // Deep links land here: the global "+ Special Order" shortcut (Layout) and
  // anything that used to point at /attendance. Consumed once, then cleared
  // so a remount or back-navigation doesn't reopen the dialog.
  useEffect(() => {
    queueMicrotask(() => {
      const state = location.state as { openSpecialOrder?: boolean } | null;
      if (state?.openSpecialOrder) {
        setSpecialOpen(true);
        navigate(location.pathname, { replace: true, state: null });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><ChefHat size={24} /> Kitchen</h1>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid grid-cols-3 max-w-md">
          <TabsTrigger value="meals">Meals</TabsTrigger>
          <TabsTrigger value="charges">Charges</TabsTrigger>
          <TabsTrigger value="menu">Menu</TabsTrigger>
        </TabsList>

        <TabsContent value="meals" className="mt-4">
          <MealsBoard key={boardKey} />
        </TabsContent>
        <TabsContent value="charges" className="mt-4">
          <ChargesTab />
        </TabsContent>
        <TabsContent value="menu" className="mt-4">
          <MenuTab />
        </TabsContent>
      </Tabs>

      {/* Kept outside Tabs so the global shortcut can open it from any tab -
          Radix unmounts inactive TabsContent. */}
      <SpecialOrderDialog
        open={specialOpen} onOpenChange={setSpecialOpen}
        onCreated={() => { setTab('meals'); setBoardKey(k => k + 1); }}
      />
    </div>
  );
}
