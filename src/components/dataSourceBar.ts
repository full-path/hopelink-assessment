import { h } from "../dom";

export type DataSource = { kind: "bundled" } | { kind: "uploaded"; fileName: string };

/**
 * Control bar for swapping the dataset the app displays: upload a replacement CSV
 * (parsed entirely in the browser, held in memory for this session only) or return
 * to the bundled dataset generated from the committed source-of-record CSV.
 */
export function renderDataSourceBar(options: {
  source: DataSource;
  error: string | null;
  onUpload: (file: File) => void;
  onReset: () => void;
}): HTMLElement {
  const { source, error, onUpload, onReset } = options;

  const fileInput = h("input", {
    type: "file",
    id: "data-source-file",
    accept: ".csv,text/csv",
    onChange: (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) onUpload(file);
    },
  });

  const sourceLabel =
    source.kind === "bundled"
      ? "Showing the bundled dataset (data/eligibility-questions.csv)."
      : `Showing uploaded file "${source.fileName}" — this preview lives only in your browser ` +
        "for this session and is discarded on reload.";

  return h(
    "section",
    { className: "data-source", "aria-label": "Data source" },
    h(
      "div",
      { className: "data-source__controls" },
      h("label", { for: "data-source-file" }, "Preview a replacement CSV"),
      fileInput,
      source.kind === "uploaded"
        ? h(
            "button",
            { type: "button", className: "data-source__reset", onClick: onReset },
            "Reset to bundled data",
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
