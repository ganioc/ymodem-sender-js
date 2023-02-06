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
              resolve('OK')
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
    while(true){
          console.log("Sync with Rx counter:", counter);
          let result = await ReceivePacket(pot, buf, 1, 1000);
          console.log(result);
          if (result === "OK") {
              printRxBuf();
              if (buf[0] === CRC16) {
                  counter++;
              }
              if(counter >= 3 ){
                break;
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
      
      // wait ACK
      let result = await ReceivePacket(port, rxBuffer, 2, 2000);
      if(result == "OK"){
        printRxBuf(rxBuffer, 2)
      }else{
        console.log("Received nothing")
        errors++;
        continue;
      }
      if(rxBuffer[0] == ACK && rxBuffer[1] == CRC16){
        console.log("Received ACK OK")
        break;
      }else{
        console.log("Received Wrong ACK", rxBuffer);
        errors++;
        continue;
      }

      // wait CRC16
    }while(errors < 5)

    if(errors >= 5 ){
      console.log("-- Send block 0 failed")
      resolve("-1")
      return;
    }else{
      console.log("-- Send block 0 succeed")
    }

    // id++
    errors = 0;
    let nInterval = (bUse1K == true)? 1024: 128;
    for(let i=0; i< binBuf.length; i+=nInterval){
      if(errors > 5){
        console.log("Sending blocks failed")
        resolve("-2")
        return
      }
      let str = i.toString(16);
      while(str.length < 5){
        str = "0" + str;
      }

      console.log("- Send block ", i/nInterval + 1, " block");
      console.log("0x" + str);

      let upper = (binBuf.length < i + nInterval)? binBuf.length: i + nInterval;
      let payloadBuf = new Buffer.alloc(nInterval);
      for(let j = i; j< upper; j++){
        payloadBuf[j-i] = binBuf[j];
      }

      id = i/nInterval + 1;
      let block = (bUse1K == true)? Packet.getLongPacket(id, payloadBuf):Packet.getNormalPacket(
        id,
        payloadBuf
      )

      // await DelayMs(10)
      writeSerial(port, block);

      // receive ack
      let result = await ReceivePacket(port, rxBuffer, 1, 2000);
      if(result == "OK"){
        printRxBuf(rxBuffer,1)
      }else{
        console.log("no response")
        errors++;
        i -= 128;
        continue;
      }

      if (rxBuffer[0] === CA) {
        console.log("Write to Flash failed")
        resolve("-5");
        return;
      }
      else if (rxBuffer[0] !== ACK) {
        console.log("no ACK")
        errors++;
        i -= 128;
        continue;
      }
      console.log("- Send block " + id +
      " succceed!");
    }

    // Send EOT at the end of files
    console.log("-- Send EOT")
    errors = 0
    do {
      if(errors > 5){
        resolve("-3")
        return
      }
      await DelayMs(100)
      writeSerial(port, Buffer.from([EOT]))

      let result = await ReceivePacket(port, rxBuffer, 1, 1500)
      if(result == "OK"){
        printRxBuf(rxBuffer, 1);
      }else{
        console.log("no response")
        errors++
        continue;
      }
      if(rxBuffer[0] != ACK){
        console.log("no ACK ", rxBuffer[0]);
        errors++;
        continue;
      }else{
        console.log("ACK")
        break;
      }

    }while(true);
    console.log("- EOT send succeed!")
    
    // Send last block
    errors = 0;
    do {
      if(errors > 3){
        console.log("Can not finish session")
        resolve("-3")
        return;
      }
      await DelayMs(100);
      let blockLast = Packet.getNormalPacket(
        0,
        new Buffer.alloc(128)
      )
      console.log("Send last block finished")
      writeSerial(port, blockLast);
      let result = await ReceivePacket(port, rxBuffer, 1, 1500)
      if(result == "OK"){
        printRxBuf(rxBuffer, 1)
      }else{
        console.log("no response");
        errors++
        continue;
      }
      if(rxBuffer[0] != ACK){
        console.log("no ACK")
        errors++;
        continue;
      }else{
        console.log("ACK");
        break;
      }

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
      await DelayMs(3000);
      continue
    }
    let startTime = new Date();
    

    result = await sendFileAsync(port, binary);
    if(result == "OK"){
      console.log("=============Send file completed===========")
      console.log("- start time:", startTime.toString());
      console.log("-- end time:", new Date().toString())
    }else{
      console.log("Send file failed")
      process.exit(1)
    }
  }
}

main()

