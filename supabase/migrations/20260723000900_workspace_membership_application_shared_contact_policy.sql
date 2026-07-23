-- WT-WORKSPACE-TEAM-007-FIX-001 shared-contact policy parity for transactional application.
-- WT-007 must use the same immutable internal workspace policy as WT-005/WT-006
-- before rejecting duplicate contact email values. The exception allows shared contact
-- email only as communication metadata; profile, auth, membership and login identity
-- remain generated independently for each approved addition.

create or replace function public.apply_workspace_membership_change_set(
  p_organisation_id uuid,
  p_import_run_id uuid,
  p_operation_key uuid default gen_random_uuid()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_import public.workspace_membership_import_runs;
  v_existing_application public.workspace_membership_change_application_runs;
  v_application public.workspace_membership_change_application_runs;
  v_source_export public.workspace_membership_export_runs;
  v_item jsonb;
  v_decision public.workspace_membership_change_decisions;
  v_row public.workspace_membership_import_rows;
  v_membership public.organisation_members;
  v_updated_membership public.organisation_members;
  v_profile public.profiles;
  v_new_profile_id uuid;
  v_new_membership public.organisation_members;
  v_proposed_values jsonb;
  v_current_values jsonb;
  v_impact_counts jsonb;
  v_proposal_type text;
  v_decision_text text;
  v_first_name text;
  v_last_name text;
  v_contact_email text;
  v_workspace_role text;
  v_login_name text;
  v_auth_email text;
  v_display_name text;
  v_failure_code text := null;
  v_failure_message text := null;
  v_current_snapshot bigint;
  v_current_snapshot_text text;
  v_approved_snapshot_text text;
  v_after_snapshot bigint;
  v_duplicate_count integer := 0;
  v_shared_contact_exception_enabled boolean := false;
  v_shared_contact_policy_source text := null;
  v_shared_contact_addition_count integer := 0;
  v_additions integer := 0;
  v_corrections integer := 0;
  v_deactivations integer := 0;
  v_reactivations integer := 0;
  v_handoffs integer := 0;
  v_correlation_id uuid := gen_random_uuid();
  v_operation_key uuid := coalesce(p_operation_key, gen_random_uuid());
begin
  select * into v_actor from public.workspace_membership_require_admin_actor(p_organisation_id);
  perform set_config('watchtower.membership_lifecycle_rpc', 'true', true);

  perform pg_advisory_xact_lock(hashtextextended(p_import_run_id::text, 7007));

  select *
    into v_existing_application
  from public.workspace_membership_change_application_runs as ar
  where ar.organisation_id = p_organisation_id
    and ar.import_run_id = p_import_run_id
    and ar.operation_key = v_operation_key
  order by ar.created_at desc
  limit 1;

  if found then
    return v_existing_application.id;
  end if;

  select *
    into v_import
  from public.workspace_membership_import_runs as ir
  where ir.id = p_import_run_id
    and ir.organisation_id = p_organisation_id
  for update;

  if not found then
    raise exception 'WT_MEMBERSHIP_IMPORT_NOT_FOUND: Import run was not found.' using errcode = '42501';
  end if;

  if v_import.status = 'applied' then
    select *
      into v_existing_application
    from public.workspace_membership_change_application_runs as ar
    where ar.organisation_id = p_organisation_id
      and ar.import_run_id = p_import_run_id
      and ar.status = 'applied'
    order by ar.completed_at desc nulls last, ar.created_at desc
    limit 1;

    if found then
      return v_existing_application.id;
    end if;

    insert into public.workspace_membership_change_application_runs (
      organisation_id,
      import_run_id,
      approved_change_set_version,
      operation_key,
      requested_by,
      started_at,
      completed_at,
      status,
      expected_counts,
      applied_counts,
      failure_code,
      failure_message
    )
    values (
      p_organisation_id,
      p_import_run_id,
      greatest(v_import.approved_change_set_version, 1),
      v_operation_key,
      v_actor.actor_user_id,
      now(),
      now(),
      'already_applied',
      coalesce(v_import.approved_change_set_summary, '{}'::jsonb),
      '{}'::jsonb,
      'already_applied',
      'This approved Workspace Team change set has already been applied.'
    )
    returning * into v_existing_application;

    return v_existing_application.id;
  end if;

  if v_import.status <> 'approved_for_application' then
    raise exception 'WT_MEMBERSHIP_APPLICATION_STATUS: Import run is not approved for application.' using errcode = '23514';
  end if;
  if v_import.approved_change_set_version <= 0 or jsonb_array_length(coalesce(v_import.approved_change_set, '[]'::jsonb)) = 0 then
    raise exception 'WT_MEMBERSHIP_APPLICATION_APPROVED_SET: Approved change set evidence is missing.' using errcode = '23514';
  end if;
  v_approved_snapshot_text := nullif(btrim(v_import.approved_live_snapshot_version), '');
  if v_approved_snapshot_text is null then
    raise exception 'WT_MEMBERSHIP_APPLICATION_SNAPSHOT: Approved change set snapshot is missing.' using errcode = '23514';
  end if;
  if v_approved_snapshot_text !~ '^[1-9][0-9]*$' then
    raise exception 'WT_MEMBERSHIP_APPLICATION_SNAPSHOT: Approved change set snapshot is not canonical decimal text.' using errcode = '23514';
  end if;

  v_shared_contact_exception_enabled := coalesce(public.is_internal_role_simulation_workspace(p_organisation_id), false);
  if v_shared_contact_exception_enabled then
    v_shared_contact_policy_source := 'public.is_internal_role_simulation_workspace';
  end if;

  insert into public.workspace_membership_change_application_runs (
    organisation_id,
    import_run_id,
    approved_change_set_version,
    operation_key,
    requested_by,
    started_at,
    status,
    expected_counts
  )
  values (
    p_organisation_id,
    p_import_run_id,
    v_import.approved_change_set_version,
    v_operation_key,
    v_actor.actor_user_id,
    now(),
    'applying',
    coalesce(v_import.approved_change_set_summary, '{}'::jsonb)
  )
  returning * into v_application;

  if v_import.source_superseded then
    v_failure_code := 'source_superseded';
    v_failure_message := 'The source export has been superseded since approval.';
  elsif v_import.source_export_id is not null then
    select *
      into v_source_export
    from public.workspace_membership_export_runs as er
    where er.id = v_import.source_export_id
      and er.organisation_id = p_organisation_id
    for update;

    if not found or v_source_export.status = 'superseded' or v_source_export.superseded_at is not null then
      v_failure_code := 'source_superseded';
      v_failure_message := 'The source export has been superseded since approval.';
    end if;
  end if;

  v_current_snapshot_text := public.current_workspace_membership_snapshot_version_text(p_organisation_id);
  if v_current_snapshot_text is null or v_current_snapshot_text !~ '^[1-9][0-9]*$' then
    raise exception 'WT_MEMBERSHIP_APPLICATION_SNAPSHOT: Current live snapshot could not be captured.' using errcode = '23514';
  end if;
  v_current_snapshot := v_current_snapshot_text::bigint;

  if v_failure_code is null and v_current_snapshot_text is distinct from v_approved_snapshot_text then
    update public.workspace_membership_change_application_runs as ar
      set status = 'drift_detected',
          completed_at = now(),
          live_snapshot_before = v_current_snapshot,
          failure_code = 'snapshot_drift',
          failure_message = 'Live Workspace Team data changed after approval. Re-upload or re-review before applying.'
    where ar.id = v_application.id
    returning * into v_application;

    update public.workspace_membership_import_runs as ir
      set status = 'application_failed_pending_review',
          failure_code = 'snapshot_drift',
          failure_message = 'Live Workspace Team data changed after approval. Re-upload or re-review before applying.'
    where ir.id = v_import.id
      and ir.organisation_id = p_organisation_id;

    perform public.record_workspace_membership_audit_event(
      p_organisation_id,
      null,
      null,
      v_actor.actor_user_id,
      'membership_change_set_drift_detected',
      'approved_for_application',
      'drift_detected',
      jsonb_build_object(
        'import_run_id', v_import.id,
        'approved_change_set_version', v_import.approved_change_set_version,
        'approved_live_snapshot_version', v_approved_snapshot_text
      ),
      jsonb_build_object(
        'application_run_id', v_application.id,
        'live_snapshot_version', v_current_snapshot_text,
        'applies_changes', false
      ),
      'Live Workspace Team data changed after approval. No membership, profile or auth change was applied.',
      'workspace_team_membership_application',
      v_correlation_id
    );

    return v_application.id;
  end if;

  if v_failure_code is null then
    select count(*)::integer, coalesce(sum(duplicate_additions.duplicate_count), 0)::integer
      into v_duplicate_count, v_shared_contact_addition_count
    from (
      select
        lower(nullif(value#>>'{proposed_values,email}', '')) as contact_email,
        count(*)::integer as duplicate_count
      from jsonb_array_elements(v_import.approved_change_set) as approved(value)
      where value->>'decision' = 'approved'
        and value->>'proposal_type' = 'addition'
      group by lower(nullif(value#>>'{proposed_values,email}', ''))
      having count(*) > 1
    ) as duplicate_additions
    where duplicate_additions.contact_email is not null;

    v_shared_contact_addition_count := coalesce(v_shared_contact_addition_count, 0);

    if v_duplicate_count > 0 and not v_shared_contact_exception_enabled then
      v_failure_code := 'duplicate_addition_contact_email';
      v_failure_message := 'Approved additions contain duplicate contact email values.';
    end if;
  end if;

  if v_failure_code is null then
    select count(*)
      into v_duplicate_count
    from (
      select value#>>'{current_live_values,workspace_membership_id}' as membership_id
      from jsonb_array_elements(v_import.approved_change_set) as approved(value)
      where value->>'decision' = 'approved'
        and value->>'proposal_type' in ('identity_correction', 'deactivation', 'reactivation')
      group by value#>>'{current_live_values,workspace_membership_id}'
      having count(*) > 1
    ) as duplicate_targets
    where duplicate_targets.membership_id is not null;

    if v_duplicate_count > 0 then
      v_failure_code := 'duplicate_target_membership';
      v_failure_message := 'Approved changes contain duplicate target memberships.';
    end if;
  end if;

  if v_failure_code is null then
    for v_item in
      select approved.value
      from jsonb_array_elements(v_import.approved_change_set) as approved(value)
    loop
      v_decision_text := v_item->>'decision';
      v_proposal_type := v_item->>'proposal_type';
      v_proposed_values := case
        when jsonb_typeof(v_item->'recalculated_proposed_values') = 'object'
             and v_item->'recalculated_proposed_values' <> '{}'::jsonb
          then v_item->'recalculated_proposed_values'
        else coalesce(v_item->'proposed_values', '{}'::jsonb)
      end;

      select *
        into v_decision
      from public.workspace_membership_change_decisions as d
      where d.id = (v_item->>'decision_id')::uuid
        and d.import_run_id = v_import.id
        and d.organisation_id = p_organisation_id
        and d.import_row_id = (v_item->>'import_row_id')::uuid
        and d.is_current
      for update;

      if not found then
        v_failure_code := 'decision_drift';
        v_failure_message := 'Approved decision evidence no longer matches the stored change set.';
        exit;
      end if;

      if v_decision.decision is distinct from v_decision_text
         or v_decision.decision_version is distinct from (v_item->>'decision_version')::integer
         or v_decision.finalised_at is null then
        v_failure_code := 'decision_drift';
        v_failure_message := 'Approved decision evidence changed after final confirmation.';
        exit;
      end if;

      if v_decision_text <> 'approved' then
        continue;
      end if;

      select *
        into v_row
      from public.workspace_membership_import_rows as r
      where r.id = (v_item->>'import_row_id')::uuid
        and r.import_run_id = v_import.id
        and r.organisation_id = p_organisation_id
      for update;

      if not found or v_row.validation_state = 'error' or v_row.proposed_change_type is distinct from v_proposal_type then
        v_failure_code := 'row_drift';
        v_failure_message := 'Approved import row evidence no longer matches the stored change set.';
        exit;
      end if;

      if v_proposal_type = 'addition' then
        v_first_name := nullif(btrim(v_proposed_values->>'first_name'), '');
        v_last_name := nullif(btrim(v_proposed_values->>'last_name'), '');
        v_contact_email := lower(nullif(btrim(v_proposed_values->>'email'), ''));
        v_workspace_role := lower(coalesce(nullif(btrim(v_proposed_values->>'workspace_role'), ''), 'viewer'));

        if v_first_name is null or v_last_name is null or v_contact_email is null or v_workspace_role not in ('member', 'viewer') then
          v_failure_code := 'invalid_addition';
          v_failure_message := 'Approved addition no longer has valid name, contact email and role values.';
          exit;
        end if;
        if v_row.supplied_membership_id is not null or v_row.supplied_user_id is not null then
          v_failure_code := 'invalid_addition_identity';
          v_failure_message := 'Approved addition contains an existing membership or user identifier.';
          exit;
        end if;
        if not v_shared_contact_exception_enabled and exists (
          select 1
          from public.organisation_members as om
          join public.profiles as p on p.id = om.user_id
          where om.organisation_id = p_organisation_id
            and lower(coalesce(p.contact_email, '')) = v_contact_email
        ) then
          v_failure_code := 'duplicate_contact_email';
          v_failure_message := 'Current workspace data already contains an approved addition contact email.';
          exit;
        end if;
      elsif v_proposal_type in ('identity_correction', 'deactivation', 'reactivation') then
        select *
          into v_membership
        from public.organisation_members as om
        where om.id = v_row.supplied_membership_id
          and om.organisation_id = p_organisation_id
        for update;

        if not found or v_membership.user_id is distinct from v_row.supplied_user_id then
          v_failure_code := 'target_drift';
          v_failure_message := 'Target membership no longer matches the approved change set.';
          exit;
        end if;

        select *
          into v_profile
        from public.profiles as p
        where p.id = v_membership.user_id
        for update;

        if not found then
          v_failure_code := 'target_profile_missing';
          v_failure_message := 'Target profile no longer exists.';
          exit;
        end if;

        v_current_values := jsonb_build_object(
          'workspace_membership_id', v_membership.id,
          'user_id', v_membership.user_id,
          'workspace_role', v_membership.role,
          'membership_status', v_membership.status,
          'first_name', v_profile.first_name,
          'last_name', v_profile.last_name,
          'email', v_profile.contact_email,
          'accepted_at', v_membership.accepted_at,
          'joined_at', v_membership.joined_at,
          'deactivated_at', v_membership.deactivated_at,
          'reactivated_at', v_membership.reactivated_at
        );

        if v_current_values is distinct from coalesce(v_item->'current_live_values', '{}'::jsonb) then
          v_failure_code := 'target_drift';
          v_failure_message := 'Current membership or profile values changed after approval.';
          exit;
        end if;
        if v_membership.role in ('owner', 'admin') then
          v_failure_code := 'protected_role';
          v_failure_message := 'Owner and Admin memberships cannot be applied from CSV.';
          exit;
        end if;
        if v_proposal_type = 'identity_correction' then
          if v_proposed_values ? 'workspace_role' or v_proposed_values ? 'membership_status' or v_proposed_values ? 'login_name' then
            v_failure_code := 'invalid_profile_correction';
            v_failure_message := 'Profile corrections may only change first name, last name and contact email.';
            exit;
          end if;
        elsif v_proposal_type = 'deactivation' then
          v_impact_counts := coalesce(v_item->'impact_counts', '{}'::jsonb);
          if v_membership.user_id = v_actor.actor_user_id then
            v_failure_code := 'self_deactivation';
            v_failure_message := 'Users cannot apply their own deactivation.';
            exit;
          end if;
          if v_membership.status <> 'active' then
            v_failure_code := 'target_drift';
            v_failure_message := 'Target membership is no longer active.';
            exit;
          end if;
          if coalesce((v_impact_counts->>'active_risks_owned')::integer, 0) > 0
             or coalesce((v_impact_counts->>'non_terminal_actions_assigned')::integer, 0) > 0
             or coalesce((v_impact_counts->>'non_terminal_approvals_held')::integer, 0) > 0
             or coalesce((v_impact_counts->>'active_project_roles')::integer, 0) > 0 then
            v_failure_code := 'responsibility_impact';
            v_failure_message := 'Approved deactivation still has known responsibility impact.';
            exit;
          end if;
        elsif v_proposal_type = 'reactivation' and v_membership.status not in ('deactivated', 'suspended') then
          v_failure_code := 'target_drift';
          v_failure_message := 'Target membership is no longer eligible for reactivation.';
          exit;
        end if;
      else
        v_failure_code := 'unsupported_proposal_type';
        v_failure_message := 'Approved change set contains an unsupported proposal type.';
        exit;
      end if;
    end loop;
  end if;

  if v_failure_code is not null then
    update public.workspace_membership_change_application_runs as ar
      set status = case when v_failure_code in ('source_superseded', 'target_drift', 'row_drift', 'decision_drift') then 'drift_detected' else 'failed' end,
          completed_at = now(),
          live_snapshot_before = v_current_snapshot,
          expected_counts = coalesce(ar.expected_counts, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
            'shared_contact_exception_enabled', v_shared_contact_exception_enabled,
            'shared_contact_policy_source', v_shared_contact_policy_source,
            'shared_contact_exception_applied', v_shared_contact_exception_enabled and v_shared_contact_addition_count > 0,
            'shared_contact_addition_count', v_shared_contact_addition_count
          )),
          failure_code = v_failure_code,
          failure_message = v_failure_message
    where ar.id = v_application.id
    returning * into v_application;

    update public.workspace_membership_import_runs as ir
      set status = 'application_failed_pending_review',
          failure_code = v_failure_code,
          failure_message = v_failure_message
    where ir.id = v_import.id
      and ir.organisation_id = p_organisation_id;

    perform public.record_workspace_membership_audit_event(
      p_organisation_id,
      null,
      null,
      v_actor.actor_user_id,
      case when v_application.status = 'drift_detected' then 'membership_change_set_drift_detected' else 'membership_change_application_failed' end,
      'approved_for_application',
      v_application.status,
      jsonb_build_object('import_run_id', v_import.id, 'approved_change_set_version', v_import.approved_change_set_version),
      jsonb_strip_nulls(jsonb_build_object(
        'application_run_id', v_application.id,
        'failure_code', v_failure_code,
        'applies_changes', false,
        'shared_contact_exception_applied', v_shared_contact_exception_enabled and v_shared_contact_addition_count > 0,
        'shared_contact_policy_source', v_shared_contact_policy_source,
        'shared_contact_addition_count', v_shared_contact_addition_count
      )),
      v_failure_message,
      'workspace_team_membership_application',
      v_correlation_id
    );

    return v_application.id;
  end if;

  for v_item in
    select approved.value
    from jsonb_array_elements(v_import.approved_change_set) as approved(value)
    where approved.value->>'decision' = 'approved'
    order by coalesce((approved.value->>'source_row_number')::integer, 0)
  loop
    v_proposal_type := v_item->>'proposal_type';
    v_proposed_values := case
      when jsonb_typeof(v_item->'recalculated_proposed_values') = 'object'
           and v_item->'recalculated_proposed_values' <> '{}'::jsonb
        then v_item->'recalculated_proposed_values'
      else coalesce(v_item->'proposed_values', '{}'::jsonb)
    end;

    select *
      into v_row
    from public.workspace_membership_import_rows as r
    where r.id = (v_item->>'import_row_id')::uuid
      and r.import_run_id = v_import.id
      and r.organisation_id = p_organisation_id
    for update;

    if v_proposal_type = 'addition' then
      v_new_profile_id := gen_random_uuid();
      v_first_name := nullif(btrim(v_proposed_values->>'first_name'), '');
      v_last_name := nullif(btrim(v_proposed_values->>'last_name'), '');
      v_contact_email := lower(nullif(btrim(v_proposed_values->>'email'), ''));
      v_workspace_role := lower(coalesce(nullif(btrim(v_proposed_values->>'workspace_role'), ''), 'viewer'));
      v_display_name := public.workspace_membership_application_display_name(v_first_name, v_last_name, v_contact_email);
      v_login_name := public.workspace_profile_next_login_name(v_display_name, v_new_profile_id);
      v_auth_email := public.workspace_membership_pending_auth_email(v_login_name, v_new_profile_id);

      insert into auth.users (
        id,
        aud,
        role,
        email,
        encrypted_password,
        email_confirmed_at,
        invited_at,
        raw_app_meta_data,
        raw_user_meta_data,
        created_at,
        updated_at
      )
      values (
        v_new_profile_id,
        'authenticated',
        'authenticated',
        v_auth_email,
        null,
        null,
        now(),
        jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
        jsonb_build_object(
          'watchtower_pending_workspace_invitation', true,
          'organisation_id', p_organisation_id,
          'import_run_id', v_import.id,
          'import_row_id', v_row.id
        ),
        now(),
        now()
      );

      insert into public.profiles (
        id,
        email,
        display_name,
        first_name,
        last_name,
        login_name,
        contact_email,
        created_by,
        updated_by
      )
      values (
        v_new_profile_id,
        v_auth_email,
        v_display_name,
        v_first_name,
        v_last_name,
        v_login_name,
        v_contact_email,
        v_actor.actor_user_id,
        v_actor.actor_user_id
      );

      insert into public.organisation_members (
        organisation_id,
        user_id,
        role,
        status,
        invited_by,
        invited_at,
        joined_at,
        updated_by
      )
      values (
        p_organisation_id,
        v_new_profile_id,
        v_workspace_role,
        'invited',
        v_actor.actor_user_id,
        now(),
        null,
        v_actor.actor_user_id
      )
      returning * into v_new_membership;

      insert into public.workspace_membership_invitation_handoffs (
        organisation_id,
        application_run_id,
        import_run_id,
        import_row_id,
        profile_id,
        organisation_membership_id,
        contact_email,
        status
      )
      values (
        p_organisation_id,
        v_application.id,
        v_import.id,
        v_row.id,
        v_new_profile_id,
        v_new_membership.id,
        v_contact_email,
        'pending'
      );

      update public.workspace_membership_import_rows as r
        set apply_status = 'applied',
            applied_at = now(),
            application_run_id = v_application.id,
            apply_message = 'Addition applied as invited membership pending invitation delivery.'
      where r.id = v_row.id;

      perform public.record_workspace_membership_audit_event(
        p_organisation_id,
        v_new_membership.id,
        v_new_profile_id,
        v_actor.actor_user_id,
        'membership_addition_applied',
        null,
        'invited',
        jsonb_build_object('import_run_id', v_import.id, 'import_row_id', v_row.id),
        jsonb_build_object(
          'application_run_id', v_application.id,
          'profile_id', v_new_profile_id,
          'workspace_role', v_workspace_role,
          'contact_email', v_contact_email,
          'login_name', v_login_name,
          'auth_email_is_placeholder', true,
          'invitation_delivery_pending', true
        ),
        'Approved Workspace Team CSV addition applied as invited membership.',
        'workspace_team_membership_application',
        v_correlation_id
      );

      v_additions := v_additions + 1;
      v_handoffs := v_handoffs + 1;
    elsif v_proposal_type = 'identity_correction' then
      select *
        into v_membership
      from public.organisation_members as om
      where om.id = v_row.supplied_membership_id
        and om.organisation_id = p_organisation_id
      for update;

      select *
        into v_profile
      from public.profiles as p
      where p.id = v_membership.user_id
      for update;

      update public.profiles as p
        set first_name = case when v_proposed_values ? 'first_name' then nullif(btrim(v_proposed_values->>'first_name'), '') else p.first_name end,
            last_name = case when v_proposed_values ? 'last_name' then nullif(btrim(v_proposed_values->>'last_name'), '') else p.last_name end,
            contact_email = case when v_proposed_values ? 'email' then lower(nullif(btrim(v_proposed_values->>'email'), '')) else p.contact_email end,
            updated_by = v_actor.actor_user_id
      where p.id = v_membership.user_id
      returning * into v_profile;

      update public.workspace_membership_import_rows as r
        set apply_status = 'applied',
            applied_at = now(),
            application_run_id = v_application.id,
            apply_message = 'Profile identity correction applied.'
      where r.id = v_row.id;

      perform public.record_workspace_membership_audit_event(
        p_organisation_id,
        v_membership.id,
        v_membership.user_id,
        v_actor.actor_user_id,
        'profile_identity_correction_applied',
        v_membership.status,
        v_membership.status,
        jsonb_build_object(
          'import_run_id', v_import.id,
          'import_row_id', v_row.id,
          'first_name', v_item#>>'{current_live_values,first_name}',
          'last_name', v_item#>>'{current_live_values,last_name}',
          'contact_email', v_item#>>'{current_live_values,email}'
        ),
        jsonb_build_object(
          'application_run_id', v_application.id,
          'first_name', v_profile.first_name,
          'last_name', v_profile.last_name,
          'contact_email', v_profile.contact_email,
          'auth_email_unchanged', true,
          'login_name_unchanged', true
        ),
        'Approved Workspace Team CSV profile identity correction applied.',
        'workspace_team_membership_application',
        v_correlation_id
      );

      v_corrections := v_corrections + 1;
    elsif v_proposal_type = 'deactivation' then
      select *
        into v_membership
      from public.organisation_members as om
      where om.id = v_row.supplied_membership_id
        and om.organisation_id = p_organisation_id
      for update;

      update public.organisation_members as om
        set status = 'deactivated',
            deactivated_at = now(),
            deactivated_by = v_actor.actor_user_id,
            deactivation_reason = 'Applied from approved Workspace Team CSV change set.',
            updated_by = v_actor.actor_user_id
      where om.id = v_membership.id
      returning * into v_updated_membership;

      update public.workspace_membership_import_rows as r
        set apply_status = 'applied',
            applied_at = now(),
            application_run_id = v_application.id,
            apply_message = 'Membership deactivation applied.'
      where r.id = v_row.id;

      perform public.record_workspace_membership_audit_event(
        p_organisation_id,
        v_updated_membership.id,
        v_updated_membership.user_id,
        v_actor.actor_user_id,
        'membership_deactivation_applied',
        v_membership.status,
        v_updated_membership.status,
        public.workspace_membership_json(v_membership),
        public.workspace_membership_json(v_updated_membership) || jsonb_build_object('application_run_id', v_application.id, 'import_run_id', v_import.id, 'import_row_id', v_row.id),
        'Approved Workspace Team CSV deactivation applied.',
        'workspace_team_membership_application',
        v_correlation_id
      );

      v_deactivations := v_deactivations + 1;
    elsif v_proposal_type = 'reactivation' then
      select *
        into v_membership
      from public.organisation_members as om
      where om.id = v_row.supplied_membership_id
        and om.organisation_id = p_organisation_id
      for update;

      update public.organisation_members as om
        set status = 'active',
            reactivated_at = now(),
            reactivated_by = v_actor.actor_user_id,
            reactivation_reason = 'Applied from approved Workspace Team CSV change set.',
            updated_by = v_actor.actor_user_id,
            joined_at = coalesce(om.joined_at, now()),
            accepted_at = coalesce(om.accepted_at, now())
      where om.id = v_membership.id
      returning * into v_updated_membership;

      update public.workspace_membership_import_rows as r
        set apply_status = 'applied',
            applied_at = now(),
            application_run_id = v_application.id,
            apply_message = 'Membership reactivation applied.'
      where r.id = v_row.id;

      perform public.record_workspace_membership_audit_event(
        p_organisation_id,
        v_updated_membership.id,
        v_updated_membership.user_id,
        v_actor.actor_user_id,
        'membership_reactivation_applied',
        v_membership.status,
        v_updated_membership.status,
        public.workspace_membership_json(v_membership),
        public.workspace_membership_json(v_updated_membership) || jsonb_build_object('application_run_id', v_application.id, 'import_run_id', v_import.id, 'import_row_id', v_row.id),
        'Approved Workspace Team CSV reactivation applied.',
        'workspace_team_membership_application',
        v_correlation_id
      );

      v_reactivations := v_reactivations + 1;
    end if;
  end loop;

  v_after_snapshot := public.current_workspace_membership_snapshot_version(p_organisation_id);

  update public.workspace_membership_change_application_runs as ar
    set status = 'applied',
        completed_at = now(),
        live_snapshot_before = v_current_snapshot,
        live_snapshot_after = v_after_snapshot,
        expected_counts = coalesce(ar.expected_counts, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
          'shared_contact_exception_enabled', v_shared_contact_exception_enabled,
          'shared_contact_policy_source', v_shared_contact_policy_source,
          'shared_contact_exception_applied', v_shared_contact_exception_enabled and v_shared_contact_addition_count > 0,
          'shared_contact_addition_count', v_shared_contact_addition_count
        )),
        applied_counts = jsonb_build_object(
          'additions', v_additions,
          'identity_corrections', v_corrections,
          'deactivations', v_deactivations,
          'reactivations', v_reactivations
        ),
        invitation_handoff_count = v_handoffs
  where ar.id = v_application.id
  returning * into v_application;

  update public.workspace_membership_import_runs as ir
    set status = 'applied',
        applied_at = now(),
        applied_by = v_actor.actor_user_id,
        failure_code = null,
        failure_message = null
  where ir.id = v_import.id;

  perform public.record_workspace_membership_audit_event(
    p_organisation_id,
    null,
    null,
    v_actor.actor_user_id,
    'membership_change_set_applied',
    'approved_for_application',
    'applied',
    jsonb_build_object(
      'import_run_id', v_import.id,
      'approved_change_set_version', v_import.approved_change_set_version,
      'approved_live_snapshot_version', v_approved_snapshot_text
    ),
    jsonb_build_object(
      'application_run_id', v_application.id,
      'applied_counts', v_application.applied_counts,
      'invitation_handoff_count', v_application.invitation_handoff_count,
      'live_snapshot_before', v_current_snapshot_text,
      'live_snapshot_after', v_after_snapshot::text,
      'shared_contact_exception_applied', v_shared_contact_exception_enabled and v_shared_contact_addition_count > 0,
      'shared_contact_policy_source', v_shared_contact_policy_source,
      'shared_contact_addition_count', v_shared_contact_addition_count
    ),
    'Approved Workspace Team CSV change set applied transactionally.',
    'workspace_team_membership_application',
    v_correlation_id
  );

  return v_application.id;
exception
  when others then
    if v_application.id is null then
      raise;
    end if;

    insert into public.workspace_membership_change_application_runs (
      id,
      organisation_id,
      import_run_id,
      approved_change_set_version,
      operation_key,
      requested_by,
      started_at,
      completed_at,
      status,
      expected_counts,
      applied_counts,
      live_snapshot_before,
      failure_code,
      failure_message
    )
    values (
      v_application.id,
      p_organisation_id,
      p_import_run_id,
      greatest(coalesce(v_import.approved_change_set_version, 0), 1),
      v_operation_key,
      v_actor.actor_user_id,
      coalesce(v_application.started_at, now()),
      now(),
      'rolled_back',
      coalesce(v_import.approved_change_set_summary, '{}'::jsonb),
      '{}'::jsonb,
      v_current_snapshot,
      'transaction_rolled_back',
      'The membership application rolled back after an unexpected database error. No partial membership changes were committed.'
    )
    on conflict (id) do update
      set completed_at = excluded.completed_at,
          status = 'rolled_back',
          failure_code = excluded.failure_code,
          failure_message = excluded.failure_message;

    update public.workspace_membership_import_runs as ir
      set status = 'application_failed_pending_review',
          failure_code = 'transaction_rolled_back',
          failure_message = 'The membership application rolled back after an unexpected database error. No partial membership changes were committed.'
    where ir.id = p_import_run_id
      and ir.organisation_id = p_organisation_id;

    perform public.record_workspace_membership_audit_event(
      p_organisation_id,
      null,
      null,
      v_actor.actor_user_id,
      'membership_change_application_failed',
      'approved_for_application',
      'rolled_back',
      jsonb_build_object(
        'import_run_id', p_import_run_id,
        'approved_change_set_version', coalesce(v_import.approved_change_set_version, 0)
      ),
      jsonb_build_object(
        'application_run_id', v_application.id,
        'failure_code', 'transaction_rolled_back',
        'sqlstate', sqlstate,
        'applies_changes', false,
        'shared_contact_exception_applied', v_shared_contact_exception_enabled and v_shared_contact_addition_count > 0,
        'shared_contact_policy_source', v_shared_contact_policy_source,
        'shared_contact_addition_count', v_shared_contact_addition_count
      ),
      'The membership application rolled back after an unexpected database error. No partial membership changes were committed.',
      'workspace_team_membership_application',
      v_correlation_id
    );

    return v_application.id;
end;
$$;

revoke all on function public.apply_workspace_membership_change_set(uuid, uuid, uuid) from public;
grant execute on function public.apply_workspace_membership_change_set(uuid, uuid, uuid) to authenticated, service_role;

comment on function public.apply_workspace_membership_change_set(uuid, uuid, uuid) is
  'Applies only the frozen approved Workspace Team CSV change set after live revalidation against approved_live_snapshot_version. Duplicate addition contact email is rejected except when public.is_internal_role_simulation_workspace enables the bounded internal shared-contact policy; email remains communication metadata only and invitation delivery is not performed.';
