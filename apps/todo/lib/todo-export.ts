const EXPORT_FORMAT = "opentodo";
const EXPORT_VERSION = 2;

export type TodoExportData = {
  settings: unknown;
  lists: unknown[];
  sharedPersonalStates: unknown[];
};

type TodoExportDocument = TodoExportData & {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  exportedAt: string;
};

export function createTodoExport(data: TodoExportData, exportedAt = new Date()) {
  const document: TodoExportDocument = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: exportedAt.toISOString(),
    settings: data.settings,
    lists: data.lists,
    sharedPersonalStates: data.sharedPersonalStates,
  };

  return JSON.stringify(document, null, 2);
}
