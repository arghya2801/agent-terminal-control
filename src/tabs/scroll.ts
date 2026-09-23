/** Keep the active tab fully inside the horizontal viewport. */
export function revealPosition(viewLeft: number, viewWidth: number, tabLeft: number, tabWidth: number): number {
  if (tabLeft < viewLeft) return tabLeft;
  if (tabLeft + tabWidth > viewLeft + viewWidth) return tabLeft + tabWidth - viewWidth;
  return viewLeft;
}

/** Mouse wheels are vertical; trackpads can already provide a horizontal delta. */
export function tabWheelDelta(deltaX: number, deltaY: number): number {
  return Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
}
