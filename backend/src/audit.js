import { pool } from './db.js';

export async function audit({ userId, candidateId = null, action, objectType, objectId = null, fieldName = null, oldValue = null, newValue = null }) {
  await pool.query(
    `INSERT INTO audit_logs (user_id,candidate_id,action,object_type,object_id,field_name,old_value,new_value) VALUES (?,?,?,?,?,?,?,?)`,
    [userId, candidateId, action, objectType, objectId, fieldName, oldValue == null ? null : String(oldValue), newValue == null ? null : String(newValue)]
  );
}
