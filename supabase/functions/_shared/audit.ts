import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

export async function audit(
  admin: SupabaseClient,
  params: {
    actorId?: string | null
    action: string
    entity: string
    entityId?: string | null
    details?: Record<string, unknown>
  },
) {
  const payload = {
    actor_id: params.actorId ?? null,
    action: params.action,
    entity: params.entity,
    entity_id: params.entityId ?? null,
    details: params.details ?? {},
  }

  await admin.from('audit_log').insert(payload)
}
