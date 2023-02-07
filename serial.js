"use strict";

const lib = require("./lib")

const printRxBuf = lib.PrintRxBuf;

let rxBuffer = new Buffer.alloc(1024 + 16);
let rxIndex = 0;


function writeSerial (pot, buf) {
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
}
/*
* Return
* status: OK, DATA, TIMEOUT, 
* length: 数据的长度, 128+5, 1024+5, 3个头，2个CRC,
*/
async function readSerial(eventEmitter, port, buf, len, timeout) {

    rxIndex = 0;
  
    return new Promise(async (resolve) => {
  
      let handle = setTimeout(() => {
        eventEmitter.removeAllListeners("data");
  
        if(rxIndex > 0){
          printRxBuf(buf, rxIndex);
          resolve({
            status: 'DATA',
            length: rxIndex
          })
        }else{
          resolve({ status:'TIMEOUT', length: 0})
        }
        
      }, timeout);
  
      let callback = (data) => {
        for (let i = 0; i < data.length; i++) {
          buf[rxIndex++] = data[i];
        }
        if (rxIndex >= len) {
          if (handle) {
            clearTimeout(handle);
          }
          console.log("ReceivePacket rx length:", rxIndex);
          eventEmitter.removeAllListeners("data");
          printRxBuf(buf, rxIndex);
          resolve({status:'OK', length: rxIndex})
        }
      };
      eventEmitter.on("data", callback);
    })
}

module.exports = {
    WriteSerial: writeSerial,
    RxBuffer: rxBuffer,
    RxIndex: rxIndex,
    ReadSerial: readSerial,
}
