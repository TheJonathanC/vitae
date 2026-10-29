/** Human-readable decimal size, e.g. 1500 -> "1.5 KB", 250000000 -> "250 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1000;
    unit++;
  } while (value >= 1000 && unit < units.length - 1);
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
