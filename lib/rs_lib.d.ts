// @generated file from wasmbuild -- do not edit
// deno-lint-ignore-file
// deno-fmt-ignore-file

export function static_text_render_once(
  items: any,
  cols?: number | null,
  rows?: number | null,
): string | undefined;
export function strip_ansi_codes(text: string): string;
export class StaticTextContainer {
  free(): void;
  constructor();
  render_text(
    items: any,
    cols?: number | null,
    rows?: number | null,
  ): string | undefined;
  clear_text(cols?: number | null, rows?: number | null): string | undefined;
}
