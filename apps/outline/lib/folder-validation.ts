export const MAX_FOLDER_NAME_LENGTH = 80;

export function cleanFolderName(name: string) {
  return name.trim().slice(0, MAX_FOLDER_NAME_LENGTH);
}

export function folderNameKey(name: string) {
  return cleanFolderName(name).normalize("NFKC").toLowerCase();
}
