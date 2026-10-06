export function completionPosition(
  caret: { left: number; top: number; bottom: number },
  popup: { width: number; height: number },
  viewport: { width: number; height: number },
) {
  const margin = 8
  const gap = 4
  const below = Math.max(0, viewport.height - margin - caret.bottom - gap)
  const above = Math.max(0, caret.top - gap - margin)
  const desiredHeight = Math.min(288, popup.height)
  const placeBelow = desiredHeight <= below || below >= above
  const maxHeight = Math.min(288, placeBelow ? below : above)
  const height = Math.min(popup.height, maxHeight)

  return {
    left: Math.max(
      margin,
      Math.min(caret.left, viewport.width - popup.width - margin),
    ),
    top: placeBelow ? caret.bottom + gap : caret.top - gap - height,
    maxHeight,
  }
}
