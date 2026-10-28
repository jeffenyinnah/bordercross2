-- =============================================================================
-- Online issuance from the mobile app, idempotent by client_uuid.
-- A dropped response makes the app retry with the same client_uuid; the retry
-- returns the policy created the first time instead of charging twice.
-- Pricing, wallet debit and commissions stay in create_policy_with_debit.
-- =============================================================================

create or replace function public.issue_policy_online(
  p_device_id uuid,
  p_client_uuid uuid,
  p_details jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles := public.require_agent_device(p_device_id);
  v_policy public.policies;
  v_id uuid;
begin
  if p_client_uuid is null then
    raise exception 'client_uuid is required' using errcode = '22023';
  end if;

  -- serialise retries of the same sale
  perform pg_advisory_xact_lock(hashtextextended(p_client_uuid::text, 0));

  select * into v_policy from public.policies where client_uuid = p_client_uuid;
  if found then
    if v_policy.agent_id <> v_profile.id then
      raise exception 'client_uuid already used' using errcode = '23505';
    end if;
    return to_jsonb(v_policy);
  end if;

  v_id := public.create_policy_with_debit(
    p_vehicle_type_ids => array(select jsonb_array_elements_text(p_details->'vehicle_type_ids'))::uuid[],
    p_policy_type      => p_details->>'policy_type',
    p_currency         => p_details->>'currency',
    p_client_name      => p_details->>'client_name',
    p_plate            => p_details->>'plate_number',
    p_brand            => p_details->>'vehicle_brand',
    p_model            => p_details->>'vehicle_model',
    p_start_date       => (p_details->>'start_date')::date,
    p_year             => (p_details->>'vehicle_year')::integer,
    p_engine           => nullif(p_details->>'engine_number', ''),
    p_chassis          => nullif(p_details->>'chassis_number', ''),
    p_client_id        => nullif(p_details->>'client_id_number', ''),
    p_nationality      => nullif(p_details->>'client_nationality', ''),
    p_notes            => nullif(p_details->>'notes', ''),
    p_border           => nullif(p_details->>'border', ''),
    p_document_type    => nullif(p_details->>'document_type', ''),
    p_document_url     => null
  );

  update public.policies
     set client_uuid = p_client_uuid,
         device_id = p_device_id,
         device_issued_at = now(),
         synced_at = now()
   where id = v_id
  returning * into v_policy;

  update public.devices set last_sync_at = now() where id = p_device_id;

  return to_jsonb(v_policy);
end;
$$;

revoke execute on function public.issue_policy_online(uuid, uuid, jsonb) from public, anon;
grant execute on function public.issue_policy_online(uuid, uuid, jsonb) to authenticated;
