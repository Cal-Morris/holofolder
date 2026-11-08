-- Partner card alerts are opt-in for each device's current Show mode session.
SET lock_timeout = '3s';
ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS show_mode_until TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.claim_partner_push(p_event UUID, p_subscription UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE token UUID := gen_random_uuid(); claimed UUID;
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM public.partner_acquisitions e
    JOIN public.partnerships p ON p.id=e.partnership_id AND p.owner_user_id=e.owner_user_id
    JOIN public.push_subscriptions s ON s.id=p_subscription AND s.user_id=e.recipient_id
    WHERE s.show_mode_until > now() AND e.id=p_event AND ((p.user1_id=e.actor_id AND p.user2_id=e.recipient_id) OR (p.user2_id=e.actor_id AND p.user1_id=e.recipient_id))
  ) THEN RETURN NULL; END IF;
  INSERT INTO public.partner_push_deliveries AS d(event_id,subscription_id,lease_token,lease_until,attempts)
    VALUES(p_event,p_subscription,token,now()+interval '30 seconds',1)
    ON CONFLICT(event_id,subscription_id) DO UPDATE SET lease_token=token,lease_until=now()+interval '30 seconds',attempts=d.attempts+1
      WHERE d.delivered_at IS NULL AND d.attempts < 4 AND (d.lease_until IS NULL OR d.lease_until < now())
    RETURNING lease_token INTO claimed;
  RETURN claimed;
END $$;
REVOKE ALL ON FUNCTION public.claim_partner_push(UUID,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_partner_push(UUID,UUID) TO service_role;
