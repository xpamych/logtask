import type { BacklinkDto } from "./api";

export function splitBacklinks(items: BacklinkDto[]): {
  tasks: BacklinkDto[];
  links: BacklinkDto[];
} {
  const tasks: BacklinkDto[] = [];
  const links: BacklinkDto[] = [];
  for (const item of items) {
    (item.task ? tasks : links).push(item);
  }
  return { tasks, links };
}
