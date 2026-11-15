declare module '*.wgsl' {
  const module: import('./gpu/types.ts').ShaderModule;
  export default module;
}
