// Intel HEX parsing for the Teensy 4.0 firmware image.
//
// Mirrors the parser in PJRC's teensy_loader_cli: HEX addresses on the Teensy 4.0
// start at the FlexSPI base 0x60000000, which maps to flash offset 0. Unlike the
// CLI, any checksum error or out-of-range byte rejects the whole file: a page
// that flashes modules must never write a partly parsed image.
//
// Loaded as a plain <script> in the page (window.Hex) and with require() in tests.
(function (root) {
  "use strict";

  var FLEXSPI_BASE = 0x60000000;
  // Teensy 4.0 program area. The emulated EEPROM (settings and calibration) sits
  // above it and is never written.
  var CODE_SIZE = 0x1F0000;

  // Parse HEX text into a flash image.
  //   image  Uint8Array(CODE_SIZE), 0xFF where the file has no data
  //   mask   Uint8Array(CODE_SIZE), 1 where the file has data
  //   end    one past the highest offset with data
  //   bytes  number of data bytes in the file
  function parse(text, codeSize) {
    codeSize = codeSize || CODE_SIZE;
    var image = new Uint8Array(codeSize).fill(0xFF);
    var mask = new Uint8Array(codeSize);
    var ext = 0, end = 0, bytes = 0, sawEof = false;
    var lines = text.split(/\r?\n/);

    for (var n = 0; n < lines.length; n++) {
      var line = lines[n].trim();
      if (!line) continue;
      var where = "line " + (n + 1);
      if (sawEof) throw new Error(where + ": data after the end-of-file record");
      if (line[0] !== ":" || line.length < 11 || (line.length - 1) % 2) throw new Error(where + ": not an Intel HEX record");
      var rec = [];
      for (var i = 1; i < line.length; i += 2) {
        var b = parseInt(line.substr(i, 2), 16);
        if (isNaN(b)) throw new Error(where + ": bad hex digits");
        rec.push(b);
      }
      var len = rec[0];
      if (rec.length !== len + 5) throw new Error(where + ": length field does not match the record");
      var sum = 0;
      for (i = 0; i < rec.length; i++) sum += rec[i];
      if (sum & 0xFF) throw new Error(where + ": checksum error");
      var addr = (rec[1] << 8) | rec[2];
      var type = rec[3];
      var data = rec.slice(4, 4 + len);

      if (type === 0x00) {
        var abs = ext + addr;
        if (abs >= FLEXSPI_BASE) abs -= FLEXSPI_BASE;
        if (abs < 0 || abs + len > codeSize) {
          throw new Error(where + ": data at 0x" + (ext + addr).toString(16) + " is outside the Teensy 4.0 program area");
        }
        for (i = 0; i < len; i++) {
          image[abs + i] = data[i];
          mask[abs + i] = 1;
        }
        bytes += len;
        if (abs + len > end) end = abs + len;
      } else if (type === 0x01) {
        sawEof = true;
      } else if (type === 0x02) {
        if (len !== 2) throw new Error(where + ": bad extended segment address record");
        ext = ((data[0] << 8) | data[1]) << 4;
      } else if (type === 0x04) {
        if (len !== 2) throw new Error(where + ": bad extended linear address record");
        ext = ((data[0] << 8) | data[1]) * 0x10000;
      } else if (type === 0x03 || type === 0x05) {
        // start address: not needed for flashing
      } else {
        throw new Error(where + ": unknown record type " + type);
      }
    }
    if (!sawEof) throw new Error("the file is truncated (no end-of-file record)");
    if (!bytes) throw new Error("the file contains no data");
    return { image: image, mask: mask, end: end, bytes: bytes };
  }

  // A Teensy 4.x image starts with the FlexSPI configuration block, tag "FCFB".
  // Catches a HEX built for another board before anything is written.
  function isTeensy4Image(parsed) {
    var m = parsed.mask, im = parsed.image;
    return m[0] && m[1] && m[2] && m[3] &&
      im[0] === 0x46 && im[1] === 0x43 && im[2] === 0x46 && im[3] === 0x42;
  }

  var api = { parse: parse, isTeensy4Image: isTeensy4Image, FLEXSPI_BASE: FLEXSPI_BASE, CODE_SIZE: CODE_SIZE };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Hex = api;
})(this);
