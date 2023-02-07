
// const SerialPort = require('serialport')

let rxBuffer = new Buffer.alloc(1024 + 16);
let rxIndex = 0;

function resetRxIndex(){
    rxIndex = 0;
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
}
async function readSerial(eventEmitter, port, buf, len, timeout) {

    // rxIndex = 0;
    resetRxIndex();

    // let len = 128 + 5; // As we are receiving 1024 packet, actually it's 128 bytes, 
  
    return new Promise(async (resolve) => {
  
      let handle = setTimeout(() => {
        console.log("ReceivePacket timeout");
        eventEmitter.removeAllListeners("data");
  
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

module.exports = {
    WriteSerial: writeSerial,
    RxBuffer: rxBuffer,
    RxIndex: rxIndex,
}
