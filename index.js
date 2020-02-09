"use strict";

const SerialPort = require('serialport')
const fs = require("fs");
const Config = require("./config/config.json");
const crc16 = require("./crc16");

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

let rxBuffer = new Buffer(1024 + 16);
let rxIndex = 0;

function DelayMs (ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function printConfig (cfg) {
    // console.log(cfg);
    console.log("Port:", cfg.slave.port);
    console.log("Baudrate:", cfg.baudrate);
    console.log("File name:", cfg.file.name);
    console.log("\n")
}
function preWorking (port) {
    // send out character '1'

    port.write('1');
    console.log("Send out '1' to set slave into YMODEM state");
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
            pot.removeAllListeners("data");
            pot.removeListener("data", callback);
            resolve('timeout')
        }, timeout);
        let callback = (data) => {
            let i = 0;
            for (i = 0; i < data.length; i++) {
                buf[rxIndex++] = data[i];
            }
            if (rxIndex >= len) {
                clearTimeout(handle);
                console.log("ReceivePacket rx length:", rxIndex);
                pot.removeAllListeners("data");
                pot.removeListener("data", callback);
                resolve('ok')
            }
        };
        pot.on("data", callback);
    });
}

async function main () {
    console.log("-- Hello world --");

    let a = crc16(Buffer.from([0x1, 0x2, 0x3, 0x4]), 4);
    console.log(a);
    console.log("0x", a.toString(16));

    printConfig(Config);


    console.log("Open port");

    let port = new SerialPort(Config.slave.port, {
        baudRate: Config.baudrate
    });


    console.log("Read a bin file:", Config.file.name);

    let binary = fs.readFileSync(Config.file.name);
    console.log("binary size:", binary.length);

    console.log("Begin to download");

    preWorking(port);

    await DelayMs(1000);

    while (true) {
        let result = await ReceivePacket(port, rxBuffer, 1, 1500);
        console.log(result);
        if (result === "ok") {
            printRxBuf();
        }

    }



    console.log('-- end --');
}

main();
