/** Navigate to the server-rendered facility scope. */
export function navigateFacility(href: string, replace = false): void {
  if (replace) window.location.replace(href);
  else window.location.assign(href);
}
