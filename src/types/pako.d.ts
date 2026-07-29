declare module "pako" {
  type BinaryData = Uint8Array | ArrayBuffer | number[];
  type Pako = {
    deflateRaw(data: BinaryData): Uint8Array;
    inflateRaw(data: BinaryData): Uint8Array;
  };

  const pako: Pako;
  export default pako;
}
