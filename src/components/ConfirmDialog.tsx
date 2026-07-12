import { useState } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { buttonVariants } from '@/components/ui/button-variants';

export interface ConfirmRequest {
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
  /** Show a text input; its value is passed to onConfirm. */
  reasonLabel?: string;
  reasonRequired?: boolean;
  onConfirm: (reason: string) => void;
}

// App-standard confirmation for destructive actions, replacing
// window.confirm/prompt (which block the UI thread, can't be styled or
// keyboard-navigated consistently, and get suppressed by some browsers).
// Usage: hold a `ConfirmRequest | null` in state and render one
// <ConfirmDialog request={...} onClose={...} /> per page.
export function ConfirmDialog({ request, onClose }: {
  request: ConfirmRequest | null;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  // Reset the reason field whenever a different confirmation opens
  // (adjust-state-during-render pattern, not an effect).
  const [prevRequest, setPrevRequest] = useState<ConfirmRequest | null>(request);
  if (request !== prevRequest) {
    setPrevRequest(request);
    setReason('');
  }

  return (
    <AlertDialog open={!!request} onOpenChange={open => { if (!open) onClose(); }}>
      <AlertDialogContent>
        {request && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>{request.title}</AlertDialogTitle>
              <AlertDialogDescription>{request.description}</AlertDialogDescription>
            </AlertDialogHeader>
            {request.reasonLabel && (
              <Input placeholder={request.reasonLabel} value={reason} onChange={e => setReason(e.target.value)} autoFocus />
            )}
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className={request.destructive ? buttonVariants({ variant: 'destructive' }) : undefined}
                disabled={!!request.reasonLabel && !!request.reasonRequired && !reason.trim()}
                onClick={() => { request.onConfirm(reason.trim()); onClose(); }}>
                {request.confirmLabel || 'Confirm'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
