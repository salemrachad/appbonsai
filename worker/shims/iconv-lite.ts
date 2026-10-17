// Stands in for iconv-lite in the Worker bundle (wrangler.jsonc: alias). Express loads body-parser, which loads
// iconv-lite; its browser build maps its stream support to nothing, and in the Workers runtime (which has
// node:stream) it then calls that nothing and the Worker fails to start. Only decoding text is needed here,
// which the runtime's TextDecoder does.

export function encodingExists(encoding: string): boolean {
  try {
    new TextDecoder(encoding);
    return true;
  } catch {
    return false;
  }
}

export function getDecoder(encoding: string) {
  const decoder = new TextDecoder(encoding);
  return {
    write: (chunk: Uint8Array) => decoder.decode(chunk, { stream: true }),
    end: () => decoder.decode(),
  };
}

export function decode(buffer: Uint8Array, encoding: string): string {
  return new TextDecoder(encoding).decode(buffer);
}

export function encode(text: string, encoding: string): Uint8Array {
  if (!/^utf-?8$/i.test(encoding)) throw new Error(`Encoding ${encoding} is not available in the Worker`);
  return new TextEncoder().encode(text);
}

export default { encodingExists, getDecoder, decode, encode };
