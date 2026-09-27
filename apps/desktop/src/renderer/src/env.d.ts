export {}

declare module '*.css' {
  const css: string
  export default css
}

declare global {
  interface Window {
    fairy: {
      name: string
      version: string
    }
  }
}
