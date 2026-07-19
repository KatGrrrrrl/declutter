// Ambient types for CSS imports in the Expo template (tsc doesn't know CSS).
// Expo also generates types under .expo/types on first `expo start`; this file
// keeps `npx tsc --noEmit` green without a dev-server run.
declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}
declare module '*.css';
