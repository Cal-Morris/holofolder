-- The trusted signup timestamp grants one 168-hour trial, shared with the owner's partner.
SET lock_timeout = '3s';
CREATE OR REPLACE FUNCTION public.billing_has_paid(owner_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.perpetual_licences WHERE owner_user_id=owner_id)
 OR EXISTS(SELECT 1 FROM public.billing_accounts WHERE owner_user_id=owner_id
   AND status IN ('active','past_due') AND paid_through>now())
 OR EXISTS(SELECT 1 FROM auth.users WHERE id=owner_id
   AND created_at<=now() AND created_at+interval '168 hours'>now())
$$;

CREATE OR REPLACE FUNCTION public.get_billing_access(owner_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('enforced',c.enforced,
  'perpetual',EXISTS(SELECT 1 FROM public.perpetual_licences WHERE owner_user_id=owner_id),
  'status',(SELECT status FROM public.billing_accounts WHERE owner_user_id=owner_id),
  'paid_through',(SELECT paid_through FROM public.billing_accounts WHERE owner_user_id=owner_id),
  'trial_ends_at',(SELECT created_at+interval '168 hours' FROM auth.users WHERE id=owner_id AND created_at<=now()),
  'saved_card_count',(SELECT coalesce(sum(public.billing_card_weight(status,wanted_cards)),0) FROM public.pokemon_collection WHERE user_id=owner_id),
  'free_card_limit',c.free_card_limit,'free_binder_limit',c.free_binder_limit)
 FROM public.billing_configuration c WHERE c.id
 AND ((select auth.role())='service_role' OR public.billing_partner_allowed(owner_id,(select auth.uid())))
$$;

NOTIFY pgrst,'reload schema';
