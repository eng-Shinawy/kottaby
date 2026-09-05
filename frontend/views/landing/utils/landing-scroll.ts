/** This layout makes <body> the scroll container (overflow: hidden auto), so
 * window scrollY stays 0 while the page visually scrolls. Reads take the
 * maximal position across all candidate scrollers; the capture-phase
 * listener catches the non-bubbling scroll event fired at the body. */
export function getMaxScrollTop(): number {
  return Math.max(window.scrollY, document.documentElement.scrollTop, document.body.scrollTop);
}
