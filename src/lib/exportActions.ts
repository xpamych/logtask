import type { PageDto } from "./api.ts";
import { assetDataUrl, blockRefsResolve, exportHtmlSave } from "./api.ts";
import { exportFileStem, preparePagesHtml } from "./exportHtml.ts";

export async function savePagesWith(
  pages: PageDto[],
  prepare: (pages: PageDto[]) => Promise<string>,
  save: (suggestedName: string, html: string) => Promise<string | null>,
): Promise<string | null> {
  const html = await prepare(pages);
  return save(`${exportFileStem(pages)}.html`, html);
}

export async function savePages(pages: PageDto[]): Promise<string | null> {
  return savePagesWith(
    pages,
    (input) => preparePagesHtml(input, blockRefsResolve, assetDataUrl),
    exportHtmlSave,
  );
}
