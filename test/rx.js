// receive from tx.js, using ymodem protocol,

// transmit to rx.js using ymodem protocol,
"use strict";

const SerialPort = require('serialport')
const fs = require('fs')
const Config = require("../config/config.json")
const Packet = require("../packet")
const events = require("events")
const emData = new events.EventEmitter();
const crc32 = require("js-crc32");
const { resolve } = require('path');

// const fileName = "./bin/L072cbos.bin";
const SOH = 0x01 /* start of 128-byte data packet */
const STX = 0x02  /* start of 1024-byte data packet */
const EOT = 0x04  /* end of transmission */
const ACK = 0x06 /* acknowledge */
const NAK = 0x15 /* negative acknowledge */
const CA = 0x18 /* two of these in succession aborts transfer */
const CRC16 = 0x43  /* 'C' == 0x43, request 16-bit CRC */
const NEGATIVE_BYTE = 0xFF

const ABORT1 = 0x41  /* 'A' == 0x41, abort by user */
const ABORT2 = 0x61  /* 'a' == 0x61, abort by user */

const NAK_TIMEOUT = 10000
const DOWNLOAD_TIMEOUT = 1000 /* One second retry delay */
const MAX_ERRORS = 10


let rxBuffer = new Buffer.alloc(1024 + 16);
let rxIndex = 0;

let bLoop = true;

let bUse1K = false;

function DelayMs(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function printConfig(cfg) {
  // console.log(cfg);
  console.log("Port:", cfg.slave.port);
  console.log("Baudrate:", cfg.baudrate);
  console.log("File name:", cfg.file.name);
  console.log("File symbol:", cfg.file.symbol);
  console.log("\n")
}

function printRxBuf (buffer, len) {
  console.log("printRxBuf: " + rxIndex);
  // for (let i = 0; i < rxIndex; i += 6) {
  //     let strOut = "0x" + i.toString(16) + ": ";
  //     let upper = (rxIndex < (i + 6)) ? rxIndex : (i + 6)
  //     for (let j = i; j < upper; j++) {
  //         strOut += rxBuffer[j].toString(16);
  //         strOut += " ";
  //     }
  //     console.log(strOut);
  // }
  let buf = Buffer.alloc(len);
  buffer.copy(buf, 0, 0, len)

  for (let i = 0; i < buf.length; i += 16) {
    let str = "0x";
    str += ((i.toString(16).length < 2) ? ("0" + i.toString(16)) : i.toString(16)) + ": ";
    let upper = (buf.length < i + 16) ? buf.length : i + 16;
    for (let j = i; j < upper; j++) {
        str += (buf[j].toString(16).length < 2 ?
            "0" + buf[j].toString(16) : buf[j].toString(16));
        str += " "
    }
    console.log(str);
}
}

function writeSerial(port, buf) {
  console.log("writeSerial ...")
  // Only print out
  for (let i = 0; i < buf.length; i += 16) {
    let str = "0x";
    str += ((i.toString(16).length < 2) ? ("0" + i.toString(16)) : i.toString(16)) + ": ";
    let upper = (buf.length < i + 16) ? buf.length : i + 16;
    for (let j = i; j < upper; j++) {
      str += (buf[j].toString(16).length < 2 ?
        "0" + buf[j].toString(16) : buf[j].toString(16));
      str += " "
    }
    console.log(str);
  }
  port.write(buf);
  // for (let i = 0; i < buf.length; i++) {
  //     let dBuf = Buffer.from([buf[i]])
  //     pot.write(dBuf);
  // }
}
async function ReceivePacketEx(port, buf, timeout) {
  rxIndex = 0;
  let len = 128 + 5; // As we are receiving 1024 packet, actually it's 128 bytes, 

  return new Promise(async (resolve) => {

    let handle = setTimeout(() => {
      console.log("ReceivePacket timeout");
      emData.removeAllListeners("data");
      resolve('TIMEOUT')
    }, timeout);

    let callback = (data) => {
      let i = 0;
      for (i = 0; i < data.length; i++) {
        buf[rxIndex++] = data[i];
      }
      if (rxIndex >= len) {
        if (handle) {
          clearTimeout(handle);
        }
        console.log("ReceivePacket rx length:", rxIndex);
        emData.removeAllListeners("data");
        printRxBuf(buf, rxIndex);

        resolve('OK')
      }
    };

    emData.on("data", callback);
  })
}
async function SerialDownload(port, binBuf) {
  let size         = 0;
  let session_done = 0;
  let result       = "OK";
  let packet_size  = 0;


  return new Promise(async (resolve) => {
    // ymodem, Ymodem_ReceiveEx()

    // while(true){
    //   writeSerial(Buffer.from[CRC16])
    // }
    while (session_done == 0 && result == "OK") {
      let packet_received = 0;
      let file_done = 0;
      let packets_counter = 0;
      let inRx = 0;
      let errors = 0;
      let session_begin = 0;

      while (file_done == 0 && result == "OK") {
        // wait 1000 ms to receive
        let pkt_result = await ReceivePacketEx(port, rxBuffer, 1000);

        if (pkt_result == "OK") {
          let ch = rxBuffer[1];

        } else if (pkt_result == "BUSY") {

        } else { // TIMEOUT
          if (session_begin > 0) {
            errors++;
          }
          if (errors > MAX_ERRORS) {
            // Abort the uart communication
            writeSerial(port, Buffer.from([CA]))
            writeSerial(port, Buffer.from([CA]))
            result = "ABORT"
          } else {
            writeSerial(port, Buffer.from([CRC16]))
          }
        }
      }

    }
    resolve(result)
  })
}

async function main() {


  console.log("-- RX --");
  console.log("use Ymodem 1k: ", bUse1K);

  let port = new SerialPort(Config.rx.port, {
    baudRate: Config.baudrate
  });

  // emData.on("data", (data) => {
  //   console.log("rx => ", "len:", data.length ,data);
  // })

  port.on("data", (data) => {
    emData.emit("data", data);
  })
  emData.removeAllListeners("data");

  console.log("Serial download file ...")

  await DelayMs(500);

  console.log("-- start time :", new Date().toString())

  let result = await SerialDownload(port, rxBuffer)

  if (result == "OK") {
    console.log("Receive file completed")
    console.log("-- end time:", new Date().toString())
  } else {
    console.log("Receive file failed")
  }

}

main()

