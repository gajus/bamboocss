//#region src/static-compiler.d.ts
/** Called synchronously by an integration that compiles source, as it is constructed. */
declare const markStaticCompilerActive: () => void;
declare const isStaticCompilerActive: () => boolean;
//#endregion
export { markStaticCompilerActive as n, isStaticCompilerActive as t };