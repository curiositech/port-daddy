// Updated SELECT queries to include authority_epoch
// Example modification for getHarborById (original omitted column)
export async function getHarborById(id: number): Promise<HarborRow | undefined> {
  const row = await db.get<{ id: number; name: string; authority_epoch: number }>(
    `SELECT id, name, authority_epoch FROM harbors WHERE id = ?`,
    [id]
  );
  return row ? { ...row } : undefined;
}

// Ensure listHarborsForUser also selects authority_epoch
export async function listHarborsForUser(userId: number): Promise<HarborRow[]> {
  const rows = await db.all<{ id: number; name: string; authority_epoch: number }>(
    `SELECT h.id, h.name, h.authority_epoch FROM harbors h
     JOIN harbor_memberships m ON m.harbor_id = h.id
     WHERE m.user_id = ?`,
    [userId]
  );
  return rows.map(r => ({ ...r }));
}

// Add similar column to any other raw SELECTs that construct Harbor objects.
