// receive from tx.js, using ymodem protocol,

"use strict";

const SerialPort = require('serialport')
const Config = require("../config/config.json")
const Packet = require("../packet")
const events = require("events")
const emData = new events.EventEmitter();
const crc16 = require("../crc16");
const lib = require("../lib")
const serial = require("../serial");


// let packetLength = 0;

const printRxBuf = lib.PrintRxBuf;
const DelayMs = lib.DelayMs;
const writeSerial = serial.WriteSerial;
const UartReceivePacketEx = serial.ReadSerial;

const nInterval = (Packet.BUse1K == true) ? 1024 : 128;

let file_name = Buffer.alloc(64);
let file_size = Buffer.alloc(64);

function extract_file_name_size(buffer){
  let index = 3;

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
/**
 * 
 * @param {*} port 
 * @param {*} buf 
 * @param {*} timeout 
 * @returns {status, length,type}
 * status: OK, type: 
 */
async function ReceivePacketEx(port, buf, timeout) {
  let packet_size = 0; // size of the packet is indicated by 1st byte, 
  let status = "OK";
  let type = "";

  return new Promise(async (resolve) => {
    console.log("ReceivePacketEx()")
    let status1 = await UartReceivePacketEx(emData, buf, 1024+5, timeout);
    console.log("status1", status1);

    // Seems to be a complete packet , (128 size or 1024) + 5
    // Will we receive length > 1024 + 5?
    if (status1.status == "OK") {
      let char1 = serial.RxBuffer[0];
      switch(char1){
        case Packet.SOH :
          packet_size = 128
          type = "SOH"
          break;
        case Packet.STX:
          packet_size = 1024
          type = "STX"
          break;
        case Packet.EOT:
          packet_size = 1;
          type = "EOT"
          break;
        case Packet.CA:
          if(serial.RxBuffer[1] == Packet.CA){
            packet_size = 2
            type = "CA"
          }else{
            status = "ERROR"
          }
          break;
        case Packet.ABORT1:
        case Packet.ABORT2:
          status = "BUSY"
          break;
        default:
          status = "ERROR"
          break;
      }
      if(packet_size >= 128){
        // check packe thead validity
        if(serial.RxBuffer[1] != (0xFF - serial.RxBuffer[2])){
          console.log("packet id error")
          packet_size = 0;
          status = "ERROR"
        }else{ // compute CRC,
          let crc = serial.RxBuffer[ packet_size + 3] << 8;
          crc += serial.RxBuffer[ packet_size + 4];

          let bufTemp = Buffer.alloc(packet_size);
          serial.RxBuffer.copy(bufTemp, 0, 3, packet_size + 3)
          let crcTemp = crc16(bufTemp, packet_size)
          if(crc != crcTemp){
            console.log("crc calc not match!!!")
            packet_size = 0
            status = "ERROR"
          }
        }
      }
    } 
    else { // TIMEOUT
      status = "TIMEOUT"
    }
    resolve({status:status, length: packet_size, type: type})
  })

}
async function SerialDownload(port) {
  // let size         = 0;
  let session_done = 0;
  let result       = "OK";
  // let packet_size  = 0;
  let session_begin = 0;

  let blocks = 0;

  return new Promise(async (resolve) => {
    // ymodem, Ymodem_ReceiveEx()
    while (session_done == 0 && result == "OK") {
      let packets_received = 0;
      let file_done = 0;
      // let packets_counter = 0;
      let inRx_block0 = 0;
      let inEOT = 0;
      let errors = 0;

      while (file_done == 0 && result == "OK") {
        // wait 1000 ms to receive
        let pkt_result = await ReceivePacketEx(port, serial.RxBuffer, 200);
        console.log("pkt_result: ", pkt_result)

        if(pkt_result.status == "OK"){
          console.log("Rx valid block, len:", serial.RxIndex)
          errors = 0;
          // It's not enough to judge packet type 
          // let packet_length = pkt_result.length;
          switch(pkt_result.type){
            case "CA":
              // abort by Sender, CA, CA
              writeSerial(port, Buffer.from([Packet.ACK]))
              result = "ABORT"
              break;
            // case 0:
            //   // End of transmission, not conform to YModem protocol
            //   writeSerial(port, Buffer.from([Packet.ACK]))
            //   file_done = 1
            //   break;
            case "EOT":
              if(inEOT == 0){
                writeSerial(port, Buffer.from([Packet.NAK]))
                inEOT = 1
              }else if (inEOT == 1){
                writeSerial(port, Buffer.from([Packet.ACK]))
                await DelayMs(50)
                writeSerial(port, Buffer.from([Packet.CRC16]))
              }
              break;
            default: // normal packet,
              console.log("normal packet: ", "serial.RxBuffer[1]", serial.RxBuffer[1], "packets_received:", packets_received);

              if(serial.RxBuffer[1] !== packets_received%256 && inEOT == 0){
                writeSerial(port, Buffer.from([Packet.NAK]))
              }else{
                // First block block 0
                if(packets_received == 0 && inRx_block0 == 0){
                    // First packet
                    // File name extraction
                    // File size extraction
                    extract_file_name_size(serial.RxBuffer)

                    // Test the size of image to be sent
                    // Image size greater than the Flash size
                    console.log("erase the blank sector")
                    writeSerial(port, Buffer.from([Packet.ACK]))
                    // await DelayMs(500);
                    writeSerial(port, Buffer.from([Packet.CRC16]))
                    inRx_block0 = 1;

                }else if(packets_received !== 0 && inRx_block0 == 1 && inEOT ==1){
                    // File header packet is empty, end session,
                    // Finished download,
                    writeSerial(port, Buffer.from([Packet.ACK]))
                    file_done = 1
                    session_done = 1
                }
                else{// Other blocks , Data packet
                  let ramsource = Buffer.alloc(nInterval);
                  serial.RxBuffer.copy(ramsource,0,3,nInterval + 3);
                  
                  console.log("Write to EEPROM")
                  printRxBuf(ramsource, nInterval)
                  blocks++;
                  console.log("blocks: ", blocks);

                  writeSerial(port, Buffer.from([Packet.ACK]))
                  
                }

                packets_received++;
                console.log("packet_received: ", packets_received)
                session_begin = 1;
              }

              break;
          }
        }
        else if(pkt_result.status == "BUSY"){
          writeSerial(port, Buffer.from([Packet.CA]))
          writeSerial(port, Buffer.from([Packet.CA]))
          result = "ABORT"
        }else{ // timeout and errors
          if(session_begin > 0){
            errors++;
          }
          if(errors > Packet.MAX_ERRORS){
            // Abort communication
            writeSerial(port, Buffer.from([Packet.CA]))
            writeSerial(port, Buffer.from([Packet.CA]))
            result = "ABORT"
          }else{
            console.log("Wait for host response!")
            writeSerial(port, Buffer.from([Packet.CRC16]))
          }
        }
      }
    }
    resolve(result)
  })
}

async function main() {

  console.log("-- RX --");
  console.log("use Ymodem 1k: ", Packet.BUse1K);

  let port = new SerialPort(Config.rx.port, {
    baudRate: Config.baudrate
  });

  port.on("data", (data) => {
    emData.emit("data", data);
  })
  emData.removeAllListeners("data");

  console.log("Serial download file ...")

  await DelayMs(500);

  let startTime = new Date();

  let result = await SerialDownload(port, serial.RxBuffer)

  if (result == "OK") {
    console.log("================Receive file completed=============")
    console.log("-- start time :", startTime.toString())
    console.log("-- end time:", new Date().toString())
  } else {
    console.log("Receive file failed")
  }
  process.exit(0)

}

main()
