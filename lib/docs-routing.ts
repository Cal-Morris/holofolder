export function docsHref(href:string,pathname:string) {
 return /^\/app\/docs(?:\/|$)/.test(pathname)&&/^\/docs(?:[/?#]|$)/.test(href)?`/app${href}`:href
}
