'use client';

import { useBillingContext } from '@/hooks/use-billing';
import { useId, useRef, useState } from 'react';
import { useOverlay, useSwipeToDismiss } from '@/hooks/use-overlay';
import { X, UserPlus, Users, Check, XIcon, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { usePartner } from '@/hooks/use-partner';
import type { User } from '@supabase/supabase-js';

interface PartnerModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
}

export default function PartnerModal({ isOpen, onClose, user }: PartnerModalProps) {
  const billing = useBillingContext();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const inviteEmailId = useId();
  const [email, setEmail] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const {
    partner,
    pendingInvites,
    receivedInvites,
    sendInvite,
    acceptInvite,
    rejectInvite,
    error,
    removePartner,
    isLoading,
  } = usePartner({ user });

  const handleSendInvite = async () => {
    if (billing && !billing.premium) {
      billing.upgrade();
      return;
    }
    if (!email.trim()) return;
    setIsSending(true);
    setActionError(null);
    const result = await sendInvite(email.trim());
    if (result.error) {
      setActionError(result.error);
    } else {
      setEmail('');
    }
    setIsSending(false);
  };

  const handleAcceptInvite = async (inviteId: string) => {
    setActionError(null);
    const result = await acceptInvite(inviteId);
    if (result.error) setActionError(result.error);
  };

  const handleRejectInvite = async (inviteId: string) => {
    setActionError(null);
    const result = await rejectInvite(inviteId);
    if (result.error) setActionError(result.error);
  };

  const handleRemovePartner = async () => {
    setActionError(null);
    const result = await removePartner();
    if (result.error) setActionError(result.error);
  };

  useOverlay(isOpen, onClose, { containerRef: dialogRef });
  const swipe = useSwipeToDismiss(dialogRef, onClose, isOpen);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div
        data-overlay-backdrop
        aria-hidden="true"
        className="absolute inset-0 bg-black/65 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Partner Mode"
        className="holo-panel border-border/50 bg-card/95 animate-slide-up absolute inset-x-3 top-[calc(var(--top-inset)+0.5rem)] bottom-[calc(var(--safe-bottom)+1rem)] mx-auto flex w-auto max-w-md flex-col overflow-hidden rounded-[2.25rem] border shadow-2xl backdrop-blur-xl sm:inset-auto sm:top-1/2 sm:left-1/2 sm:h-[min(80vh,42rem)] sm:w-full sm:-translate-x-1/2 sm:-translate-y-1/2"
      >
        <div
          data-sheet-grabber
          {...swipe}
          className="border-border/50 relative flex shrink-0 items-center justify-between border-b px-5 py-4"
        >
          <span
            aria-hidden="true"
            className="bg-muted-foreground/30 pointer-events-none absolute top-1 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full sm:hidden"
          />
          <div className="flex items-center gap-2">
            <Users className="text-primary h-5 w-5" />
            <h2 className="text-lg font-semibold">Partner Mode</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close partner mode"
            className="hover:bg-muted/70 mr-0.5 flex h-10 w-10 items-center justify-center rounded-full transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div
          className="flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6 sm:py-6"
          style={{
            WebkitOverflowScrolling: 'touch',
            touchAction: 'pan-y',
          }}
        >
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
            </div>
          ) : error ? (
            <div className="border-destructive/30 bg-destructive/10 rounded-2xl border p-4">
              <p className="text-destructive text-sm font-medium">Could not load partner mode.</p>
              <p className="text-muted-foreground mt-1 text-sm">{error}</p>
            </div>
          ) : !user ? (
            <div className="border-border bg-muted/40 rounded-2xl border p-4">
              <p className="text-sm font-medium">Sign in to use partner mode.</p>
              <p className="text-muted-foreground mt-1 text-sm">
                Partner invites and shared collections are only available for signed-in users.
              </p>
            </div>
          ) : (
            <>
              {actionError && (
                <div className="border-destructive/30 bg-destructive/10 rounded-2xl border p-4">
                  <p className="text-destructive text-sm">{actionError}</p>
                </div>
              )}
              {partner ? (
                <div className="border-primary/20 bg-primary/10 rounded-2xl border p-4">
                  <p className="text-muted-foreground mb-1 text-sm">Currently partnered with</p>
                  <p className="text-primary font-medium">{partner.email}</p>
                  <p className="text-muted-foreground mt-2 text-xs">
                    You can both view and manage the same Pokemon collection.
                  </p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={handleRemovePartner}>
                    Remove partner
                  </Button>
                </div>
              ) : (
                <>
                  <div>
                    <label htmlFor={inviteEmailId} className="mb-2 block text-sm font-medium">
                      Invite a Partner
                    </label>
                    <p className="text-muted-foreground mb-3 text-xs">
                      Share your Pokedex collection with someone. You&apos;ll both be able to mark Pokemon as collected.
                    </p>
                    <div className="flex gap-2">
                      <Input
                        id={inviteEmailId}
                        type="email"
                        placeholder="partner@email.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSendInvite()}
                        className="flex-1"
                      />
                      <Button
                        aria-label={billing && !billing.premium ? 'Upgrade to invite a partner' : 'Invite partner'}
                        onClick={handleSendInvite}
                        disabled={isSending || (!email.trim() && billing?.premium !== false)}
                      >
                        {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>

                  {pendingInvites.length > 0 && (
                    <div>
                      <h3 className="mb-2 block text-sm font-medium">Pending Invites</h3>
                      <div className="space-y-2">
                        {pendingInvites.map((invite) => (
                          <div
                            key={invite.id}
                            className="bg-muted/50 flex items-center justify-between rounded-2xl p-3"
                          >
                            <span className="text-sm">{invite.inviteeEmail || 'Unknown'}</span>
                            <span className="text-muted-foreground text-xs">Waiting...</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {receivedInvites.length > 0 && (
                    <div>
                      <h3 className="mb-2 block text-sm font-medium">Received Invites</h3>
                      <div className="space-y-2">
                        {receivedInvites.map((invite) => (
                          <div
                            key={invite.id}
                            className="bg-muted/50 flex items-center justify-between rounded-2xl p-3"
                          >
                            <span className="text-sm">From: {invite.inviterEmail || 'Unknown'}</span>
                            <div className="flex gap-1">
                              <Button size="sm" variant="ghost" onClick={() => handleAcceptInvite(invite.id)}>
                                <Check className="h-4 w-4 text-green-500" />
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => handleRejectInvite(invite.id)}>
                                <XIcon className="h-4 w-4 text-red-500" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
