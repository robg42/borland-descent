/** Vitest/Vite `?raw` imports resolve to the file's source text. Test-only. */
declare module '*?raw' {
  const source: string;
  export default source;
}
