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
const crc16 = require("../crc16");

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
let packetLength = 0;

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
function extract_file_name_size(buffer){
  let index = 3;

  let file_name = Buffer.alloc(64);
  let file_size = Buffer.alloc(64);

  let i = 0;
  while(buffer[index] != 0){
    file_name[i++] = buffer[index++];
  }
  file_name[i] = 0;

  i = 0;
  index++;
  while(buffer[index] != 0){
    file_size[i++] = buffer[index++];
  }

  console.log("file name, file size")
  console.log(file_name.toString())
  console.log(file_size.toString())

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
async function UartReceivePacketEx(port, buf, timeout) {
  rxIndex = 0;
  let len = 128 + 5; // As we are receiving 1024 packet, actually it's 128 bytes, 

  return new Promise(async (resolve) => {

    let handle = setTimeout(() => {
      console.log("ReceivePacket timeout");
      emData.removeAllListeners("data");

      if(rxIndex > 0){
        printRxBuf(buf, rxIndex);
        resolve('DATA')
      }else{
        resolve('TIMEOUT')
      }
      
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
async function ReceivePacketEx(port, buf, timeout) {
  let packet_size = 0;
  let status = "OK"

  return new Promise(async (resolve) => {
    console.log("ReceivePacketEx()")
    let status1 = await UartReceivePacketEx(port, buf, 1000);
    console.log("status1", status1);

    // Seems to be a complete packet , 128 size
    if (status1 == "OK") {
      let char1 = rxBuffer[0];
      switch(char1){
        case SOH :
          packet_size = 128
          break;
        case STX:
          packet_size = 1024
          break;
        default:
          status = "ERROR"
          break;
      }
      if(packet_size >= 128){
        if(rxBuffer[1] != (0xFF - rxBuffer[2])){
          console.log("packet id error")
          packet_size = 0;
          status = "ERROR"
        }else{ // compute CRC,
          let crc = rxBuffer[ packet_size + 3] << 8;
          crc += rxBuffer[ packet_size + 4];

          let bufTemp = Buffer.alloc(128);
          rxBuffer.copy(bufTemp, 0, 3, 128 + 3)
          let crcTemp = crc16(bufTemp, 128)
          if(crc != crcTemp){
            console.log("crc calc not match!!!")
            packet_size = 0
            status = "ERROR"
          }
        }
      }
    } else if (status1 == "DATA") {
      console.log("DATA packet")
      let char1 = rxBuffer[0];
      switch(char1){
        case EOT:
          status = "OK";
          break;
        case CA:
          if(rxBuffer[1] == CA){
            packet_size = 2
          }else{
            status = "ERROR"
          }
          break;
        case ABORT1:
        case ABORT2:
          status = "BUSY"
          break;
        default:
          status = "ERROR"
      }

    } else { // TIMEOUT
      status = "ERROR"
    }

    packetLength = packet_size;

    resolve(status)
  })

}
async function SerialDownload(port, binBuf) {
  let size         = 0;
  let session_done = 0;
  let result       = "OK";
  let packet_size  = 0;
  let session_begin = 0;

  let blocks = 0;


  return new Promise(async (resolve) => {
    // ymodem, Ymodem_ReceiveEx()

    // while(true){
    //   writeSerial(Buffer.from[CRC16])
    // }
    while (session_done == 0 && result == "OK") {
      let packets_received = 0;
      let file_done = 0;
      let packets_counter = 0;
      let inRx = 0;
      let errors = 0;

      while (file_done == 0 && result == "OK") {
        // wait 1000 ms to receive
        let pkt_result = await ReceivePacketEx(port, rxBuffer, 500);

        if(pkt_result == "OK"){
          console.log("Rx valid block, len:", rxIndex)
          errors = 0;

          let packet_length = packetLength;
          switch(packet_length){
            case 2:
              // abort by Sender
              writeSerial(port, Buffer.from([ACK]))
              result = "ABORT"
              break;
            case 0:
              // End of transmission
              writeSerial(port, Buffer.from([ACK]))
              file_done = 1
              break;
            default:
              // normal packet,
              console.log("normal packet: ", "rxBuffer[1]", rxBuffer[1], "packets_received:", packets_received);

              if(rxBuffer[1] != packets_received%256){
                writeSerial(port, Buffer.from([NAK]))
              }else{
                // First block block 0
                if(packets_received == 0 && inRx == 0){
                  if(rxBuffer[3] != 0){ // First packet
                    // File name extraction
                    // File size extraction
                    extract_file_name_size(rxBuffer)

                    // Test the size of image to be sent
                    // Image size greater than the Flash size
                    console.log("erase the blank sector")
                    writeSerial(port, Buffer.from([ACK]))
                    // await DelayMs(500);
                    writeSerial(port, Buffer.from([CRC16]))
                    inRx = 1;

                  }else{ // last packet
                    // File header packet is empty, end session,
                    // Finished download,
                    writeSerial(port, Buffer.from([ACK]))
                    file_done = 1
                    session_done = 1
                  }

                }else{// Other blocks , Data packet
                  let ramsource = Buffer.alloc(128);
                  rxBuffer.copy(ramsource,0,3,128+3);
                  
                  console.log("Write to EEPROM")
                  printRxBuf(ramsource, 128)
                  blocks++;
                  console.log("blocks: ", blocks);

                  writeSerial(port, Buffer.from([ACK]))
                  
                }

                packets_received++;
                packets_counter++;
                console.log("packet_counted: ", packets_counter)
                session_begin = 1;
              }

              break;
          }
        }
        else if(pkt_result == "BUSY"){
          writeSerial(port, Buffer.from([CA]))
          writeSerial(port, Buffer.from([CA]))
          result = "ABORT"
        }else{ // timeout , errors
          if(session_begin > 0){
            errors++;
          }
          if(errors > MAX_ERRORS){
            // Abort communication
            writeSerial(port, Buffer.from([CA]))
            writeSerial(port, Buffer.from([CA]))
            result = "ABORT"
          }else{
            console.log("errors!")
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
    console.log("================Receive file completed=============")
    console.log("-- end time:", new Date().toString())
  } else {
    console.log("Receive file failed")
  }
  process.exit(0)

}

main()

