const clamp = (v, min, max) => Math.min(Math.max(v, min), Math.max(min, max));

/**
 * Viewport (position: fixed) coordinates for the floating panel.
 * Horizontal: prefer the right of the hovered element, else the left, else clamp.
 * Vertical:   prefer below the cursor, else above, else clamp.
 * Anchoring horizontally to the element's edge keeps the company name uncovered.
 */
export function computePanelPosition({ cursor, anchor, panel, viewport, gap = 14, margin = 8 }) {
  const aLeft = anchor ? anchor.left : cursor.x;
  const aRight = anchor ? anchor.right : cursor.x;

  let left;
  if (aRight + gap + panel.width + margin <= viewport.width) left = aRight + gap;
  else if (aLeft - gap - panel.width >= margin) left = aLeft - gap - panel.width;
  else left = viewport.width - panel.width - margin;

  let top;
  if (cursor.y + gap + panel.height + margin <= viewport.height) top = cursor.y + gap;
  else if (cursor.y - gap - panel.height >= margin) top = cursor.y - gap - panel.height;
  else top = viewport.height - panel.height - margin;

  return {
    left: clamp(left, margin, viewport.width - panel.width - margin),
    top: clamp(top, margin, viewport.height - panel.height - margin),
  };
}

export function rectsIntersect(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
