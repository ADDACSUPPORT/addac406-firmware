// ADDAC406 firmware installer page: lists the releases from firmware/manifest.json
// and installs one over USB (Web Serial to reboot the module, WebHID to program it).
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var releases = [];
  var prepared = null; // { version, reports } for the selected release, checked and parsed

  var hasSerial = "serial" in navigator;
  var hasHid = "hid" in navigator;

  function status(text, kind) {
    var el = $("status");
    el.textContent = text;
    el.className = kind || "";
  }

  function step(n) {
    var items = $("steps").children;
    for (var i = 0; i < items.length; i++) {
      var s = +items[i].dataset.step;
      items[i].className = s < n ? "done" : s === n ? "active" : "";
    }
  }

  function selected() {
    return releases[$("release").selectedIndex];
  }

  function showRelease() {
    var r = selected();
    $("version").innerHTML = "";
    $("version").append("Release ", Object.assign(document.createElement("strong"), { textContent: r.version }),
      " · " + r.date.slice(0, 10));
    $("notes").textContent = r.notes || "No notes for this release.";
    $("download").href = "firmware/" + r.file;
    $("download").textContent = r.file.split("/").pop();
    prepared = null;
  }

  async function sha256Hex(buf) {
    var d = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(d), function (b) { return b.toString(16).padStart(2, "0"); }).join("");
  }

  // Download, verify and parse the selected release before the module is touched.
  async function prepare() {
    var r = selected();
    if (prepared && prepared.version === r.version) return prepared;
    status("Downloading " + r.version + "…");
    var res = await fetch("firmware/" + r.file, { cache: "no-cache" });
    if (!res.ok) throw new Error("could not download the firmware (" + res.status + ")");
    var buf = await res.arrayBuffer();
    if ((await sha256Hex(buf)) !== r.sha256) throw new Error("the downloaded firmware is damaged (checksum mismatch). Reload the page and try again.");
    var parsed = Hex.parse(new TextDecoder().decode(buf));
    if (!Hex.isTeensy4Image(parsed)) throw new Error("this file is not a Teensy 4.0 firmware");
    prepared = { version: r.version, reports: HalfKay.buildReports(parsed) };
    return prepared;
  }

  function busy(on) {
    $("restart").disabled = on;
    $("install").disabled = on;
    $("release").disabled = on;
    $("skip").disabled = on;
  }

  function readyToInstall(msg) {
    step(3);
    $("restart").hidden = true;
    $("skip").hidden = true;
    $("install").hidden = false;
    status(msg);
  }

  async function onRestart() {
    step(2);
    busy(true);
    try {
      await prepare();
      status("Pick the Teensy port in the browser's list.");
      var port;
      try {
        port = await navigator.serial.requestPort({ filters: [{ usbVendorId: HalfKay.VID }] });
      } catch (e) {
        status("No port picked. If no Teensy port is listed, see “If the module isn't found” below.", "error");
        $("skip").hidden = false;
        return;
      }
      await HalfKay.rebootToBootloader(port);
      status("Restarting into programming mode…");
      // A device granted before (a repeat install) can be used without asking again.
      var dev = await waitForGrantedBootloader(4000);
      if (dev) {
        busy(false);
        await install(dev);
        return;
      }
      readyToInstall("The module is in programming mode. Press Install and pick the Teensy bootloader.");
    } catch (e) {
      status(e.message, "error");
    } finally {
      busy(false);
    }
  }

  async function waitForGrantedBootloader(ms) {
    var until = Date.now() + ms;
    while (Date.now() < until) {
      var devs = await navigator.hid.getDevices();
      var d = devs.find(function (x) { return x.vendorId === HalfKay.VID && x.productId === HalfKay.PID_HALFKAY; });
      if (d) return d;
      await new Promise(function (r) { setTimeout(r, 250); });
    }
    return null;
  }

  async function onInstall() {
    var devs;
    try {
      devs = await navigator.hid.requestDevice({ filters: [{ vendorId: HalfKay.VID, productId: HalfKay.PID_HALFKAY }] });
    } catch (e) {
      devs = [];
    }
    if (!devs.length) {
      status("No bootloader picked. If none is listed, press the button on the Teensy board once and try again.", "error");
      return;
    }
    await install(devs[0]);
  }

  async function install(dev) {
    busy(true);
    try {
      var p = await prepare();
      step(4);
      $("progress").hidden = false;
      $("progress").value = 0;
      status("Programming " + p.version + "… don't disconnect the module.");
      await HalfKay.program(dev, p.reports, function (done, total) {
        $("progress").value = done / total;
      });
      step(5);
      status("Done. The module restarts with " + p.version + ": its boot screen shows the version.", "ok");
      $("install").hidden = true;
      $("restart").hidden = false;
    } catch (e) {
      status(e.message + " Press the button on the Teensy board and install again.", "error");
    } finally {
      busy(false);
    }
  }

  async function init() {
    $("build").textContent = (document.currentScript && document.currentScript.src.split("?v=")[1]) || "";
    if (!hasSerial || !hasHid || !window.isSecureContext) $("unsupported").hidden = false;
    try {
      var res = await fetch("firmware/manifest.json", { cache: "no-cache" });
      if (!res.ok) throw new Error(res.status);
      var m = await res.json();
      releases = (m.channels && m.channels.release) || [];
    } catch (e) {
      $("version").textContent = "Could not load the list of releases.";
      return;
    }
    if (!releases.length) {
      $("version").textContent = "No releases published yet.";
      return;
    }
    var sel = $("release");
    releases.forEach(function (r, i) {
      sel.append(new Option(r.version + (i === 0 ? " (latest)" : ""), r.version));
    });
    sel.disabled = false;
    sel.addEventListener("change", showRelease);
    showRelease();
    step(1);
    if (hasSerial && hasHid && window.isSecureContext) {
      $("restart").disabled = false;
      $("install").disabled = false;
      $("skip").hidden = false;
    }
    $("restart").addEventListener("click", onRestart);
    $("install").addEventListener("click", onInstall);
    $("skip").addEventListener("click", async function () {
      try {
        busy(true);
        await prepare();
        readyToInstall("Press Install and pick the Teensy bootloader.");
      } catch (e) {
        status(e.message, "error");
      } finally {
        busy(false);
      }
    });
  }

  init();
})();
