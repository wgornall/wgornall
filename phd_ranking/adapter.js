/* Load only the generated public release. A failed load never falls back to
 * synthetic examples or to confidential source files. */
window.createAppMiddleware = async function () {
  if (window.PHD_PLACEMENT_MIDDLEWARE) return window.PHD_PLACEMENT_MIDDLEWARE;
  const response = await fetch('./placement-data.json');
  if (!response.ok) throw new Error(`Unable to load the dataset (HTTP ${response.status}).`);
  const data = await response.json();
  const { createMiddleware } = await import('./placement-middleware.mjs');
  return createMiddleware(data);
};
