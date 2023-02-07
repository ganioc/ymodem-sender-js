// receive from tx.js, using ymodem protocol,

// transmit to rx.js using ymodem protocol,
"use strict";

const SerialPort = require('serialport')
const Config = require("../config/config.json")
const Packet = require("../packet")
const events = require("events")
const emData = new events.EventEmitter();
const crc16 = require("../crc16");
const lib = require("../lib")
const serial = require("../serial")


let packetLength = 0;

const printRxBuf = lib.PrintRxBuf;
const DelayMs = lib.DelayMs;
const writeSerial = serial.WriteSerial;
const UartReceivePacketEx = serial.ReadSerial;

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

async function ReceivePacketEx(port, buf, timeout) {
  let packet_size = 0;
  let status = "OK"

  return new Promise(async (resolve) => {
    console.log("ReceivePacketEx()")
    let status1 = await UartReceivePacketEx(emData, port, buf,128+5, 1000);
    console.log("status1", status1);

    // Seems to be a complete packet , 128 size
    if (status1 == "OK") {
      let char1 = serial.RxBuffer[0];
      switch(char1){
        case Packet.SOH :
          packet_size = 128
          break;
        case Packet.STX:
          packet_size = 1024
          break;
        default:
          status = "ERROR"
          break;
      }
      if(packet_size >= 128){
        if(serial.RxBuffer[1] != (0xFF - serial.RxBuffer[2])){
          console.log("packet id error")
          packet_size = 0;
          status = "ERROR"
        }else{ // compute CRC,
          let crc = serial.RxBuffer[ packet_size + 3] << 8;
          crc += serial.RxBuffer[ packet_size + 4];

          let bufTemp = Buffer.alloc(128);
          serial.RxBuffer.copy(bufTemp, 0, 3, 128 + 3)
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
      let char1 = serial.RxBuffer[0];
      switch(char1){
        case Packet.EOT:
          status = "OK";
          break;
        case Packet.CA:
          if(serial.RxBuffer[1] == CA){
            packet_size = 2
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
    while (session_done == 0 && result == "OK") {
      let packets_received = 0;
      let file_done = 0;
      let packets_counter = 0;
      let inRx = 0;
      let errors = 0;

      while (file_done == 0 && result == "OK") {
        // wait 1000 ms to receive
        let pkt_result = await ReceivePacketEx(port, serial.RxBuffer, 500);

        if(pkt_result == "OK"){
          console.log("Rx valid block, len:", serial.RxIndex)
          errors = 0;

          let packet_length = packetLength;
          switch(packet_length){
            case 2:
              // abort by Sender
              writeSerial(port, Buffer.from([Packet.ACK]))
              result = "ABORT"
              break;
            case 0:
              // End of transmission
              writeSerial(port, Buffer.from([Packet.ACK]))
              file_done = 1
              break;
            default:
              // normal packet,
              console.log("normal packet: ", "serial.RxBuffer[1]", serial.RxBuffer[1], "packets_received:", packets_received);

              if(serial.RxBuffer[1] != packets_received%256){
                writeSerial(port, Buffer.from([Packet.NAK]))
              }else{
                // First block block 0
                if(packets_received == 0 && inRx == 0){
                  if(serial.RxBuffer[3] != 0){ // First packet
                    // File name extraction
                    // File size extraction
                    extract_file_name_size(serial.RxBuffer)

                    // Test the size of image to be sent
                    // Image size greater than the Flash size
                    console.log("erase the blank sector")
                    writeSerial(port, Buffer.from([Packet.ACK]))
                    // await DelayMs(500);
                    writeSerial(port, Buffer.from([Packet.CRC16]))
                    inRx = 1;

                  }else{ // last packet
                    // File header packet is empty, end session,
                    // Finished download,
                    writeSerial(port, Buffer.from([Packet.ACK]))
                    file_done = 1
                    session_done = 1
                  }

                }else{// Other blocks , Data packet
                  let ramsource = Buffer.alloc(128);
                  serial.RxBuffer.copy(ramsource,0,3,128+3);
                  
                  console.log("Write to EEPROM")
                  printRxBuf(ramsource, 128)
                  blocks++;
                  console.log("blocks: ", blocks);

                  writeSerial(port, Buffer.from([Packet.ACK]))
                  
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
          writeSerial(port, Buffer.from([Packet.CA]))
          writeSerial(port, Buffer.from([Packet.CA]))
          result = "ABORT"
        }else{ // timeout , errors
          if(session_begin > 0){
            errors++;
          }
          if(errors > Packet.MAX_ERRORS){
            // Abort communication
            writeSerial(port, Buffer.from([Packet.CA]))
            writeSerial(port, Buffer.from([Packet.CA]))
            result = "ABORT"
          }else{
            console.log("errors!")
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

  // emData.on("data", (data) => {
  //   console.log("rx => ", "len:", data.length ,data);
  // })

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

