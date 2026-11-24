export interface BlockSelectionState {
  containerId: string;
  anchorUuid: string;
  focusUuid: string;
}

export function selectBlock(
  _state: BlockSelectionState | null,
  containerId: string,
  uuid: string,
): BlockSelectionState {
  return { containerId, anchorUuid: uuid, focusUuid: uuid };
}

export function extendBlockSelection(
  state: BlockSelectionState | null,
  orderedUuids: string[],
  targetUuid: string,
): BlockSelectionState | null {
  if (!state || !orderedUuids.includes(state.anchorUuid) || !orderedUuids.includes(targetUuid)) {
    return state;
  }
  return { ...state, focusUuid: targetUuid };
}

export function selectedBlockUuids(
  state: BlockSelectionState | null,
  orderedUuids: string[],
): string[] {
  if (!state) return [];
  const anchor = orderedUuids.indexOf(state.anchorUuid);
  const focus = orderedUuids.indexOf(state.focusUuid);
  if (anchor < 0 || focus < 0) return [];
  return orderedUuids.slice(Math.min(anchor, focus), Math.max(anchor, focus) + 1);
}

export function pruneBlockSelection(
  state: BlockSelectionState | null,
  orderedUuids: string[],
): BlockSelectionState | null {
  if (!state) return null;
  if (!orderedUuids.includes(state.anchorUuid) || !orderedUuids.includes(state.focusUuid)) return null;
  return state;
}
