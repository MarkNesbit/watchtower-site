-- WT-WORKSPACE-TEAM-006 audit compatibility for bulk review decisions.
-- Review confirmation audit events record WT-006 decision states such as
-- pending -> approved. The audit table remains constrained, but now allows
-- the complete Workspace Team lifecycle/import/checkout/review catalog.

alter table public.workspace_membership_audit_events
  drop constraint if exists workspace_membership_audit_events_event_type_check,
  add constraint workspace_membership_audit_events_event_type_check
    check (event_type in (
      'membership_invited',
      'invitation_expired',
      'membership_activated',
      'membership_suspended',
      'membership_deactivated',
      'membership_reactivated',
      'profile_identity_corrected',
      'membership_import_proposed',
      'membership_import_uploaded',
      'membership_import_validation_failed',
      'membership_import_validated',
      'membership_import_stale_detected',
      'membership_import_superseded_rejected',
      'membership_import_applied',
      'membership_import_failed',
      'membership_export_generated',
      'membership_export_read_only_generated',
      'membership_export_taken_over',
      'membership_export_superseded',
      'workspace_membership_csv_checkout_released',
      'membership_change_approved',
      'membership_change_excluded',
      'membership_deactivation_kept_active',
      'membership_change_decision_revised',
      'membership_change_blocked',
      'membership_change_no_longer_required',
      'membership_change_set_confirmed',
      'workspace_membership_change_selection_confirmed'
    )),
  drop constraint if exists workspace_membership_audit_events_previous_status_check,
  add constraint workspace_membership_audit_events_previous_status_check
    check (
      previous_status is null
      or previous_status in (
        'invited',
        'invite_expired',
        'active',
        'suspended',
        'deactivated',
        'generated',
        'checked_out',
        'released',
        'superseded',
        'expired',
        'cancelled',
        'uploaded',
        'parsing',
        'validation_failed',
        'validated',
        'stale_review_required',
        'comparison_completed',
        'approval_pending',
        'approved_for_application',
        'applied',
        'failed',
        'pending',
        'approved',
        'excluded',
        'keep_active',
        'blocked',
        'no_longer_required',
        'rejected',
        'skipped',
        'not_started',
        'in_review',
        'ready_for_application',
        'review_blocked',
        'not_applied'
      )
    ),
  drop constraint if exists workspace_membership_audit_events_new_status_check,
  add constraint workspace_membership_audit_events_new_status_check
    check (
      new_status is null
      or new_status in (
        'invited',
        'invite_expired',
        'active',
        'suspended',
        'deactivated',
        'generated',
        'checked_out',
        'released',
        'superseded',
        'expired',
        'cancelled',
        'uploaded',
        'parsing',
        'validation_failed',
        'validated',
        'stale_review_required',
        'comparison_completed',
        'approval_pending',
        'approved_for_application',
        'applied',
        'failed',
        'pending',
        'approved',
        'excluded',
        'keep_active',
        'blocked',
        'no_longer_required',
        'rejected',
        'skipped',
        'not_started',
        'in_review',
        'ready_for_application',
        'review_blocked',
        'not_applied'
      )
    );

comment on constraint workspace_membership_audit_events_previous_status_check on public.workspace_membership_audit_events is
  'Allows null or the constrained Workspace Team lifecycle, import, checkout and WT-006 review decision state catalog used by audit evidence.';

comment on constraint workspace_membership_audit_events_new_status_check on public.workspace_membership_audit_events is
  'Allows null or the constrained Workspace Team lifecycle, import, checkout and WT-006 review decision state catalog used by audit evidence.';
