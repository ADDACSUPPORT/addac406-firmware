// Programming a Teensy 4.0 through PJRC's HalfKay bootloader, over WebHID.
//
// The protocol follows PJRC's teensy_loader_cli (teensy_loader_cli.c):
//   - HalfKay enumerates as HID 16C0:0478
//   - flash is written in 1024-byte blocks; each block is one 1088-byte output
//     report: 24-bit little-endian address in bytes 0-2, zeros up to byte 64,
//     then the block
//   - the first block is always written, since writing it erases the chip;
//     after that, blocks the image doesn't touch or that are all 0xFF are skipped
//   - the first 5 writes may take up to 45 s (erase), the rest 0.5 s;
//     a rejected write is retried every 10 ms until its time runs out
//   - a report whose address is FF FF FF reboots into the new firmware
//
// Entering HalfKay: firmware built with USB serial reboots into the bootloader
// when the host sets its serial port to 134 baud (Teensy core, usb.c).
//
// Loaded as a plain <script> in the page (window.HalfKay) and with require() in tests.
(function (root) {
  "use strict";

  var VID = 0x16C0;
  var PID_HALFKAY = 0x0478;
  var BLOCK_SIZE = 1024;
  var HEADER_SIZE = 64;
  var REPORT_SIZE = BLOCK_SIZE + HEADER_SIZE;
  var REBOOT_BAUD = 134;

  // The blocks to write, in order, as complete output reports.
  function buildReports(parsed) {
    var image = parsed.image, mask = parsed.mask, size = image.length;
    var reports = [];
    for (var addr = 0; addr < size; addr += BLOCK_SIZE) {
      if (reports.length > 0) {
        var used = false, blank = true;
        for (var i = addr; i < addr + BLOCK_SIZE && i < size; i++) {
          if (mask[i]) {
            used = true;
            if (image[i] !== 0xFF) { blank = false; break; }
          }
        }
        if (!used || blank) continue;
      }
      var r = new Uint8Array(REPORT_SIZE);
      r[0] = addr & 0xFF;
      r[1] = (addr >> 8) & 0xFF;
      r[2] = (addr >> 16) & 0xFF;
      r.set(image.subarray(addr, Math.min(addr + BLOCK_SIZE, size)), HEADER_SIZE);
      if (addr + BLOCK_SIZE > size) r.fill(0xFF, HEADER_SIZE + (size - addr));
      reports.push({ addr: addr, data: r });
    }
    return reports;
  }

  function bootReport() {
    var r = new Uint8Array(REPORT_SIZE);
    r[0] = r[1] = r[2] = 0xFF;
    return r;
  }

  function sleep(ms) {
    return new Promise(function (res) { setTimeout(res, ms); });
  }

  // Send one report, retrying while HalfKay rejects it (it is still busy with the
  // previous block or erasing) until timeoutMs has passed.
  async function write(device, data, timeoutMs) {
    var deadline = Date.now() + timeoutMs;
    var lastErr;
    for (;;) {
      try {
        await device.sendReport(0, data);
        return;
      } catch (e) {
        lastErr = e;
      }
      if (Date.now() >= deadline) throw new Error("the module stopped responding while programming (" + (lastErr && lastErr.message) + ")");
      await sleep(10);
    }
  }

  // Write the reports, then reboot into the new firmware.
  // onProgress(done, total) after every block.
  async function program(device, reports, onProgress) {
    if (!device.opened) await device.open();
    for (var i = 0; i < reports.length; i++) {
      await write(device, reports[i].data, i <= 4 ? 45000 : 500);
      if (onProgress) onProgress(i + 1, reports.length);
    }
    try {
      await write(device, bootReport(), 500);
    } catch (e) {
      // the device often disconnects as it reboots, before the transfer completes
    }
    try { await device.close(); } catch (e) {}
  }

  // Ask the running firmware to reboot into HalfKay. `port` is a Web Serial port
  // the user picked. Opening it at 134 baud is the request; the port disappears.
  async function rebootToBootloader(port) {
    await port.open({ baudRate: REBOOT_BAUD });
    try { await port.close(); } catch (e) {}
  }

  var api = {
    VID: VID, PID_HALFKAY: PID_HALFKAY, BLOCK_SIZE: BLOCK_SIZE, REPORT_SIZE: REPORT_SIZE, REBOOT_BAUD: REBOOT_BAUD,
    buildReports: buildReports, bootReport: bootReport, program: program, rebootToBootloader: rebootToBootloader,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HalfKay = api;
})(this);
