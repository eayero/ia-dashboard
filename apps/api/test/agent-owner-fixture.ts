import type pg from 'pg';
export async function seedAgentOwner(pool: pg.Pool, agentId: string, ownerId: string) {
  await pool.query("INSERT INTO principals(id,kind) VALUES ($1,'HUMAN') ON CONFLICT DO NOTHING", [
    ownerId,
  ]);
  await pool.query(
    "INSERT INTO local_users(principal_id,username,display_name,password_hash,must_change_password) VALUES ($1,$2,'Synthetic agent owner','synthetic-no-login',false) ON CONFLICT DO NOTHING",
    [ownerId, `owner-${ownerId}`],
  );
  await pool.query(
    "INSERT INTO agent_profiles(principal_id,owner_user_id,name) VALUES ($1,$2,'Synthetic agent') ON CONFLICT DO NOTHING",
    [agentId, ownerId],
  );
}
