// receive from tx.js, using ymodem protocol,

// transmit to rx.js using ymodem protocol,
"use strict";

const SerialPort = require('serialport')
const fs = require('fs')
const Config = require("../config/config.json")
const Packet = require("../packet")
const events = require("events")
const emData = new events.EventEmitter();
const crc32 = require("js-crc32")

let rxBuffer = new Buffer.alloc(1024 + 16);
let rxIndex = 0;

let bLoop = true;

let bUse1K = false;

function DelayMs (ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function printConfig (cfg) {
  // console.log(cfg);
  console.log("Port:", cfg.slave.port);
  console.log("Baudrate:", cfg.baudrate);
  console.log("File name:", cfg.file.name);
  console.log("File symbol:", cfg.file.symbol);
  console.log("\n")
}

async function main () {
  console.log("-- RX --");
  console.log("use Ymodem 1k: ", bUse1K);

  let port = new SerialPort(Config.rx.port, {
    baudRate: Config.baudrate
  });

  emData.on("data", (data) => {
    console.log("rx: ", data);
  })

  port.on("data", (data) => {
    emData.emit("data", data);
  })

}

main()

