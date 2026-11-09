export type MobilePanel = "left" | "right";

export function mobilePanelAfterToggle(
  current: MobilePanel | null,
  next: MobilePanel,
): MobilePanel | null {
  return current === next ? null : next;
}

export function mobilePanelAfterNavigation(
  current: MobilePanel | null,
  preserveRight: boolean,
): MobilePanel | null {
  return preserveRight && current === "right" ? "right" : null;
}

export function panelVisible(
  mobile: boolean,
  collapsed: boolean,
  open: MobilePanel | null,
  side: MobilePanel,
): boolean {
  return mobile ? open === side : !collapsed;
}
