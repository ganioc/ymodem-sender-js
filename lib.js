"use strict";

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
function printRxBuf (buffer, len) {
    console.log("printRxBuf: " + len);
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

module.exports = {
    DelayMs: DelayMs,
    PrintConfig: printConfig,
    PrintRxBuf: printRxBuf,
};