export function createOutlineExport(data: { settings: unknown; folders: unknown[]; notes: unknown[]; deletedNotes: unknown[] }, exportedAt = new Date()) {
  return JSON.stringify({ format: "openoutline", version: 1, exportedAt: exportedAt.toISOString(), ...data }, null, 2);
}
