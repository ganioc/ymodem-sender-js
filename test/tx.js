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




function DelayMs (ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function printConfig (cfg) {
  // console.log(cfg);
  console.log("Port:", cfg.tx.port);
  console.log("Baudrate:", cfg.baudrate);
  console.log("File name:", cfg.file.name);
  console.log("File symbol:", cfg.file.symbol);
  console.log("\n")
}

function printRxBuf () {
  console.log("printRxBuf: " + rxIndex);
  for (let i = 0; i < rxIndex; i += 6) {
      let strOut = "0x" + i.toString(16) + ": ";
      let upper = (rxIndex < (i + 6)) ? rxIndex : (i + 6)
      for (let j = i; j < upper; j++) {
          strOut += rxBuffer[j].toString(16);
          strOut += " ";
      }
      console.log(strOut);
  }
}

function ReceivePacket (pot, buf, len, timeout) {

  rxIndex = 0;

  return new Promise((resolve, reject) => {

      let handle = setTimeout(() => {
          console.log("ReceivePacket timeout");
          emData.removeAllListeners("data");
          resolve('timeout')
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
              resolve('ok')
          }
      };

      emData.on("data", callback);
  });
}
function writeSerial (pot, buf, ind) {
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
  pot.write(buf);
  // for (let i = 0; i < buf.length; i++) {
  //     let dBuf = Buffer.from([buf[i]])
  //     pot.write(dBuf);
  // }
}
async function syncWithRx (pot, buf) {
  let counter = 0;
  return new Promise(async (resolve) => {
    // 
    for (let i = 0; i < 3; i++) {
          console.log("Sync with Rx counter:", counter);
          let result = await ReceivePacket(pot, buf, 1, 2000);
          console.log(result);
          if (result === "ok") {
              printRxBuf();
              if (buf[0] === CRC16) {
                  counter++;
              }
          }
    }
    if (counter >= 1) {
          resolve("OK");
    } else {
          resolve("NOK");
    }
  });
}

async function sendFileAsync(port, binBuf){
  let id = 0;
  let blockZero = Packet.getNormalPacket(
      id,
      Packet.getZeroContent(Config.file.symbol,
          binBuf.length));
  let errors = 0;

  console.log("sendFileAsync() ...")

  return new Promise(async (resolve) => {
    do{
      writeSerial(port, blockZero);
      console.log("- Send out blockZero");
      break

    }while(true)
    console.log("last block sending finished")
    resolve("OK")
  })
}

async function main () {
  console.log("-- TX --");
  console.log("use Ymodem 1k: ", bUse1K);
  printConfig(Config)

  let port = new SerialPort(Config.tx.port, {
    baudRate: Config.baudrate
  });

  port.on("data", (data) => {
    emData.emit("data", data);
  })
  emData.removeAllListeners("data");

  console.log("Read a bin file:", Config.file.name);

  const binary = fs.readFileSync(Config.file.name);
  console.log("binary size:", binary.length);
  console.log("binary/128=", binary.length / 128);
  console.log("binary/1024=", binary.length / 1024);

  console.log("Begin to download");

  while (true) {
    await DelayMs(1000);

    // console.log("a");
    // port.write("a");
    //
    let result  = await syncWithRx(port, rxBuffer)
    if(result == "OK"){
      console.log("sync ok")
    }else{
      console.log("sync failed")
      await DelayMs(50000);
      continue
    }

    console.log("- start time:", new Date().toString());

    result = await sendFileAsync(port, binary);
    if(result == "OK"){
      console.log("Send file completed")
      console.log("-- end time:", new Date().toString())
    }else{
      console.log("Send file failed")
      process.exit(1)
    }
  }
}

main()

