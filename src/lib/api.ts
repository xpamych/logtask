import { invoke } from "@tauri-apps/api/core";

export async function ping(): Promise<string> {
  return invoke<string>("ping");
}

export async function graphSummary(): Promise<{ pages: number; journals: number }> {
  return invoke<{ pages: number; journals: number }>("graph_summary");
}
