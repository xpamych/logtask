export function composerMarker(kind: "command" | "plain"): "TODO" | null {
  return kind === "command" ? "TODO" : null;
}
