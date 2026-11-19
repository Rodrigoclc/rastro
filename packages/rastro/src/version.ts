declare const __LIBRARY_VERSION__: string

export const LIBRARY_NAME = 'rastro'
export const LIBRARY_VERSION = typeof __LIBRARY_VERSION__ === 'string' ? __LIBRARY_VERSION__ : '0.0.0'
