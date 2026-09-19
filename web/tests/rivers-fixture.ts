/** Encode comme tools/build_geo.py::encode_rivers. */
export function encodeRivers(lines: [number, [number, number][]][], magic = "WTRV", version = 1): ArrayBuffer {
  const size = 10 + lines.reduce((s, [, pts]) => s + 4 + pts.length * 4, 0);
  const view = new DataView(new ArrayBuffer(size));
  for (let i = 0; i < 4; i++) view.setUint8(i, magic.charCodeAt(i));
  view.setUint16(4, version, true);
  view.setUint32(6, lines.length, true);
  let o = 10;
  for (const [rank, pts] of lines) {
    view.setUint8(o, rank);
    view.setUint8(o + 1, 0);
    view.setUint16(o + 2, pts.length, true);
    o += 4;
    for (const [lon, lat] of pts) {
      view.setInt16(o, lon, true);
      view.setInt16(o + 2, lat, true);
      o += 4;
    }
  }
  return view.buffer;
}
