-- Serialize destructive binder checks and external preference replacement with their writes.
SET lock_timeout = '3s';
CREATE OR REPLACE FUNCTION public.developer_delete_binder(actor uuid,owner_id uuid,binder_id_input uuid,confirm_populated boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE chosen public.binders; remaining integer; slots integer; replacement uuid;
BEGIN
 IF actor<>owner_id THEN
  PERFORM 1 FROM public.partnerships WHERE owner_user_id=owner_id AND actor IN(user1_id,user2_id) FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Collection access denied' USING ERRCODE='42501'; END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text,6102));
 -- FOR UPDATE also excludes new child FK references until deletion commits or rolls back.
 SELECT * INTO chosen FROM public.binders WHERE id=binder_id_input AND owner_user_id=owner_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','not-found','slotCount',0); END IF;
 SELECT count(*) INTO remaining FROM public.binders WHERE owner_user_id=owner_id;
 IF remaining<=1 THEN RETURN jsonb_build_object('ok',false,'reason','last-binder','slotCount',0); END IF;
 SELECT count(*) INTO slots FROM public.pokemon_collection WHERE binder_id=chosen.id AND user_id=owner_id;
 IF slots>0 AND NOT coalesce(confirm_populated,false) THEN RETURN jsonb_build_object('ok',false,'reason','needs-confirmation','slotCount',slots); END IF;
 IF chosen.is_default THEN SELECT id INTO replacement FROM public.binders WHERE owner_user_id=owner_id AND id<>chosen.id ORDER BY sort_order,id LIMIT 1 FOR UPDATE; END IF;
 DELETE FROM public.binders WHERE id=chosen.id AND owner_user_id=owner_id;
 IF replacement IS NOT NULL THEN UPDATE public.binders SET is_default=true WHERE id=replacement AND owner_user_id=owner_id; END IF;
 RETURN jsonb_build_object('ok',true,'deletedBinderId',chosen.id);
END $$;

CREATE OR REPLACE FUNCTION public.developer_save_settings(actor uuid,owner_id uuid,binder_id_input uuid,expected_settings jsonb,expected_layout jsonb,new_settings jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE stored public.user_settings; saved public.user_settings; binder public.binders; next public.user_settings; present boolean; current_layout jsonb;
BEGIN
 IF actor<>owner_id THEN
  PERFORM 1 FROM public.partnerships WHERE owner_user_id=owner_id AND actor IN(user1_id,user2_id) FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Collection access denied' USING ERRCODE='42501'; END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text,6103));
 IF binder_id_input IS NOT NULL THEN
  SELECT * INTO binder FROM public.binders WHERE id=binder_id_input AND owner_user_id=owner_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Binder not found' USING ERRCODE='42501'; END IF;
  current_layout:=jsonb_build_object('binder_rows',binder.binder_rows,'binder_cols',binder.binder_cols);
 END IF;
 SELECT * INTO stored FROM public.user_settings WHERE user_id=owner_id FOR UPDATE;
 present:=FOUND;
 IF (CASE WHEN present THEN to_jsonb(stored) ELSE NULL END) IS DISTINCT FROM expected_settings OR current_layout IS DISTINCT FROM expected_layout THEN RETURN jsonb_build_object('conflict',true); END IF;
 SELECT * INTO next FROM jsonb_populate_record(NULL::public.user_settings,new_settings);
 IF present THEN
  UPDATE public.user_settings SET binder_rows=coalesce(next.binder_rows,stored.binder_rows),binder_cols=coalesce(next.binder_cols,stored.binder_cols),binder_color_id=next.binder_color_id,binder_page_colors=next.binder_page_colors,binder_slot_glare_enabled=next.binder_slot_glare_enabled,card_finish_effects_enabled=next.card_finish_effects_enabled,dark_mode=next.dark_mode,show_binder_value=next.show_binder_value,pricing_region=next.pricing_region,preferred_currency=next.preferred_currency,preferred_card_language=next.preferred_card_language,updated_at=clock_timestamp() WHERE user_id=owner_id RETURNING * INTO saved;
 ELSE
  INSERT INTO public.user_settings(user_id,binder_rows,binder_cols,binder_color_id,binder_page_colors,binder_slot_glare_enabled,card_finish_effects_enabled,dark_mode,show_binder_value,pricing_region,preferred_currency,preferred_card_language)
  VALUES(owner_id,coalesce(next.binder_rows,4),coalesce(next.binder_cols,4),next.binder_color_id,next.binder_page_colors,next.binder_slot_glare_enabled,next.card_finish_effects_enabled,next.dark_mode,next.show_binder_value,next.pricing_region,next.preferred_currency,next.preferred_card_language)
  ON CONFLICT(user_id) DO NOTHING RETURNING * INTO saved;
  IF saved.user_id IS NULL THEN RETURN jsonb_build_object('conflict',true); END IF;
 END IF;
 IF binder_id_input IS NOT NULL THEN
  UPDATE public.binders SET binder_rows=(new_settings->>'layout_rows')::integer,binder_cols=(new_settings->>'layout_cols')::integer WHERE id=binder_id_input AND owner_user_id=owner_id;
 END IF;
 RETURN jsonb_build_object('conflict',false);
END $$;
REVOKE ALL ON FUNCTION public.developer_delete_binder(uuid,uuid,uuid,boolean),public.developer_save_settings(uuid,uuid,uuid,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated,holo_mcp;
GRANT EXECUTE ON FUNCTION public.developer_delete_binder(uuid,uuid,uuid,boolean),public.developer_save_settings(uuid,uuid,uuid,jsonb,jsonb,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
