import { h } from "../dom";

export type DataSource =
  { kind: "bundled" } | { kind: "sheet" } | { kind: "uploaded"; fileName: string };

/**
 * Control bar for swapping the dataset the app displays: upload a replacement CSV
 * (parsed entirely in the browser, held in memory for this session only) or return
 * to the published dataset — the live sheet if it loaded, otherwise the bundled snapshot.
 */
export function renderDataSourceBar(options: {
  source: DataSource;
  error: string | null;
  onUpload: (files: File[]) => void;
  onReset: () => void;
}): HTMLElement {
  const { source, error, onUpload, onReset } = options;

  const fileInput = h("input", {
    type: "file",
    id: "data-source-file",
    accept: ".csv,text/csv",
    // The Questions, Requirements and Question links tabs, exported as CSV, chosen together.
    multiple: true,
    onChange: (e) => {
      const files = [...((e.target as HTMLInputElement).files ?? [])];
      if (files.length > 0) onUpload(files);
    },
  });

  const sourceLabel =
    source.kind === "bundled"
      ? "Showing the bundled dataset (the CSVs in data/)."
      : source.kind === "sheet"
        ? "Showing the live Google Sheet."
        : `Showing uploaded files ${source.fileName} — this preview lives only in your browser ` +
          "for this session and is discarded on reload.";

  return h(
    "section",
    { className: "data-source", "aria-label": "Data source" },
    h(
      "div",
      { className: "data-source__controls" },
      h(
        "label",
        { for: "data-source-file" },
        "Preview replacement CSVs (Questions, Requirements and Question links tabs)",
      ),
      fileInput,
      source.kind === "uploaded"
        ? h(
            "button",
            { type: "button", className: "data-source__reset", onClick: onReset },
            "Reset to published data",
          )
        : undefined,
    ),
    h("p", { className: "data-source__status", role: "status" }, sourceLabel),
    error !== null
      ? h(
          "div",
          { className: "data-source__error", role: "alert" },
          h("strong", {}, "Could not load that file: "),
          error,
        )
      : undefined,
  );
}
