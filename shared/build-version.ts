export function buildVersion(version: string | undefined, revision: string | undefined) {
  const label = version?.trim() || "Development";
  return revision && /^[a-f0-9]{7,40}$/i.test(revision) ? `${label} (${revision.slice(0, 7)})` : label;
}
