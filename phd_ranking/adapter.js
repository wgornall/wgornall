/* Load the compact table first. Person-level records follow in the background. */
window.createAppMiddleware = async function () {
  if (window.PHD_PLACEMENT_MIDDLEWARE) return window.PHD_PLACEMENT_MIDDLEWARE;
  const [{createProgressiveMiddleware}, response] = await Promise.all([
    import('./placement-middleware.mjs?v=3fa1f54ab4911b04'), fetch('./placement-summary.json?v=3fa1f54ab4911b04')
  ]);
  if (!response.ok) throw new Error(`Unable to load the ranking summary (HTTP ${response.status}).`);
  const summary = await response.json();
  return createProgressiveMiddleware(summary, async () => {
    const response = await fetch('./placement-data.json?v=3fa1f54ab4911b04');
    if (!response.ok) throw new Error(`Unable to load faculty details (HTTP ${response.status}).`);
    return response.json();
  });
};
