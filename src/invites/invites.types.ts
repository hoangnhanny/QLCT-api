export interface InviteRow {
  id: string;
  ledger_id: string;
  token: string;
  expires_at: Date;
  revoked_at: Date | null;
  created_by: string;
  created_at: Date;
}

export interface Invite {
  id: string;
  ledgerId: string;
  token: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdBy: string;
  createdAt: Date;
}

export function mapInvite(row: InviteRow): Invite {
  return {
    id: row.id,
    ledgerId: row.ledger_id,
    token: row.token,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}
