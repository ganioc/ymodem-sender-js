// transmit to rx.js using ymodem protocol,
"use strict";

const SerialPort = require('serialport')
const fs = require('fs')
const Config = require("../config/config.json")
const Packet = require("../packet")
const events = require("events")
const emData = new events.EventEmitter();
const lib = require("../lib")
const serial = require("../serial");

const DelayMs = lib.DelayMs;
const printConfig = lib.PrintConfig;
const printRxBuf = lib.PrintRxBuf;
const writeSerial = serial.WriteSerial;
const ReceivePacket = serial.ReadSerial;


async function syncWithClient(port, buf, times) {
  let counter_sync = 0;
  let counter_timeout = 0
  return new Promise(async (resolve) => {
    while (counter_timeout < 10) {
      console.log("Sync with Rx counter:", counter_sync);
      let result = await ReceivePacket(emData, buf, 1, 1000);
      console.log(result);
      if (result.status === "OK") {
        printRxBuf(serial.RxBuffer, serial.RxIndex);
        if (buf[0] === Packet.CRC16) {
          counter_sync++;
        }
        if (counter_sync >= times) {
          resolve("OK")
          return
        }
      }else{
        counter_timeout++
      }
    }
    resolve("NOK")
  });
}
async function sendBlock0(port, id, fileName, fileLen){
  let blockZero = Packet.getNormalPacket(
    id,
    Packet.getZeroContent(fileName, fileLen));

  return new Promise(async (resolve) => {
    do {
      writeSerial(port, blockZero);
      console.log("- Send out blockZero");

      // wait ACK
      let result = await ReceivePacket(emData, serial.RxBuffer, 2, 1000);
      if (result.status == "OK" && serial.RxBuffer[0] == Packet.ACK && serial.RxBuffer[1] == Packet.CRC16) {
        console.log("Received ACK OK")
        resolve("OK")
        return;
      } else {
        console.log("Received Wrong ACK", serial.RxBuffer);
        errors++;
        continue;
      }

      // wait CRC16
    } while (errors < 5)

    resolve("NOK")
  })
}
async function sendBlockEOT(port){
  console.log("-- Send EOT")

  return new Promise(async (resolve) => {
    await DelayMs(50)
    writeSerial(port, Buffer.from([Packet.EOT]))
    let result = await ReceivePacket(emData, serial.RxBuffer, 1, 1000);
    if (result.status != "OK" || serial.RxBuffer[0] !== Packet.NAK) {
      resolve("NOK")
      return
    }
    writeSerial(port, Buffer.from([Packet.EOT]))
    result = await ReceivePacket(emData, serial.RxBuffer, 1, 1000);
    if (result.status != "OK" || serial.RxBuffer[0] !== Packet.ACK) {
      resolve("NOK")
      return
    }

    result = await ReceivePacket(emData, serial.RxBuffer, 1, 1000);
    if (result.status != "OK" || serial.RxBuffer[0] !== Packet.CRC16) {
      resolve("NOK")
      return
    }

    resolve("OK")
  });
}
async function sendBlockFile(port, buf){
  let errors = 0;
  const nInterval = (Packet.BUse1K == true) ? 1024 : 128;

  return new Promise(async (resolve)=>{

    for (let i = 0; i < buf.length; i += nInterval) {
      if (errors > 5) {
        console.log("Sending blocks failed")
        resolve("NOK")
        return
      }

      console.log("- Send block ", i / nInterval + 1);

      let upper = (buf.length < i + nInterval) ? buf.length : i + nInterval;
      let payloadBuf = new Buffer.alloc(nInterval);
      for (let j = i; j < upper; j++) {
        payloadBuf[j - i] = buf[j];
      }

      let id = i / nInterval + 1;
      let block = (Packet.BUse1K == true) ? Packet.getLongPacket(id, payloadBuf) : Packet.getNormalPacket(
        id,
        payloadBuf
      )

      // await DelayMs(10)
      writeSerial(port, block);

      // receive ack
      let result = await ReceivePacket(emData, serial.RxBuffer, 1, 500);
      if (result.status == "OK") {
        printRxBuf(serial.RxBuffer, 1)
      } else {
        console.log("no response")
        errors++;
        i -= nInterval;
        continue;
      }

      if (serial.RxBuffer[0] === Packet.CA) {
        console.log("Write to Flash failed")
        resolve("NOK");
        return;
      }
      else if (serial.RxBuffer[0] !== Packet.ACK) {
        console.log("no ACK")
        errors++;
        i -= 128;
        continue;
      }
      console.log("- Send block " + id +
        " succceed!");
    }
    resolve("OK")
  })
}
async function sendBlockLast(port){
  let blockLast = Packet.getNormalPacket(
    0,
    new Buffer.alloc(128)
  )
  console.log("Send last block to finish session")

  return new Promise(async (resolve)=>{
    let errors = 0;
    do {
      if (errors > 3) {
        console.log("Can not finish session")
        resolve("NOK")
        return;
      }
      writeSerial(port, blockLast);
      let result = await ReceivePacket(emData, serial.RxBuffer, 1, 1000)
      if (result.status == "OK" && serial.RxBuffer[0] == Packet.ACK) {
        printRxBuf(serial.RxBuffer, 1)
        break
      } else {
        console.log("no response");
        errors++
        continue;
      }
    } while (true)
    resolve("OK")
  })
}
async function sendFileAsync(port, binBuf) {
  let id = 0;
  let errors = 0;

  console.log("sendFileAsync() ...")

  return new Promise(async (resolve) => {
    let result = await sendBlock0(port, id, Config.file.symbol, binBuf.length);
    if (result !== "OK") {
      console.log("-- Send block 0 failed")
      resolve("-1")
      return;
    } 

    // id++
    result = await sendBlockFile(port, binBuf);
    if(result !== "OK"){
      console.log("-- send files failed")
      resolve("NOK")
      return
    }

    result = await sendBlockEOT(port)
    if(result !==  "OK"){
      console.log("-- Send block EOT failed")
      resolve("NOK")
      return;
    }

    // Send last block
    result = await sendBlockLast(port)
    if(result !==  "OK"){
      console.log("-- Send block last failed")
      resolve("NOK")
      return;
    }

    console.log("last block sending finished")
    resolve("OK")
  })
}

async function main() {
  console.log("-- TX --");
  console.log("use Ymodem 1k: ", Packet.BUse1K);
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
    let result = await syncWithClient(port, serial.RxBuffer ,2)
    if (result == "OK") {
      console.log("sync ok")
    } else {
      console.log("sync failed")
      continue
    }
    let startTime = new Date();


    result = await sendFileAsync(port, binary);
    if (result == "OK") {
      console.log("=============Send file completed===========")
      console.log("- start time:", startTime.toString());
      console.log("-- end time:", new Date().toString())
      process.exit(0);
    } else {
      console.log("Send file failed")
      process.exit(1)
    }
  }
}

main()

