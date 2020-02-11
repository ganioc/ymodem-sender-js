"use strict";

const SerialPort = require('serialport')
const fs = require("fs");
const Config = require("./config/config.json");
const crc16 = require("./crc16");
const Packet = require("./packet");
const events = require("events");
const emData = new events.EventEmitter();


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

let bLoop = true;

function DelayMs (ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function printConfig (cfg) {
    // console.log(cfg);
    console.log("Port:", cfg.slave.port);
    console.log("Baudrate:", cfg.baudrate);
    console.log("File name:", cfg.file.name);
    console.log("File symbol:", cfg.file.symbol);
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
function writeSerial (pot, buf) {
    console.log("writeSerial ...")
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

async function sendFile (pot, binBuf) {
    console.log("sendFile...")
    let id = 0;
    // send out id=0 block
    do {
        await DelayMs(1000);
        let blockZero = Packet.getNormalPacket(
            id,
            Packet.getZeroContent(Config.file.symbol, binBuf.length));

        // console.log(blockZero.toString());
        writeSerial(pot, blockZero);
        console.log("- Send out blockZero");

        // ACK
        let result = await ReceivePacket(pot, rxBuffer, 1, 2000);
        if (result === "ok") {
            printRxBuf();
        } else {
            console.log("Received nothing");
            continue;
        }

        if (rxBuffer[0] === ACK) {
            console.log("Received ACK")
        } else {
            continue
        }

        // CRC16
        result = await ReceivePacket(pot, rxBuffer, 1, 2000);
        if (result === "ok") {
            printRxBuf();
        } else {
            console.log("Received nothing");
            continue;
        }

        if (rxBuffer[0] === CRC16) {
            console.log("Received CRC")
            break;
        } else {
            continue;
        }

    } while (true)
    console.log("- Send Block 0 succeed!")

    // id++
    for (let i = 0; i < binBuf.length; i += 128) {

        console.log("- Send block " + (i / 128 + 1) + " block");

        let upper = (binBuf.length < i + 128) ?
            binBuf.length : i + 128;

        let payloadBuf = new Buffer(128);
        for (let j = i; j < upper; j++) {
            payloadBuf[j - i] = binBuf[j];
        }

        let block = Packet.getNormalPacket(
            i / 128 + 1,
            payloadBuf);
        await DelayMs(100);
        writeSerial(pot, block);

        let result = await ReceivePacket(pot, rxBuffer, 1, 1500);
        if (result === "ok") {
            printRxBuf();
        } else {
            bLoop = false;
            return;
        }
        if (rxBuffer[0] !== ACK) {
            bLoop = false;
            return;
        }
        console.log("- Send block " + (i / 128 + 1) + " succceed!");
    }
    console.log("End of sendFile");
}
async function syncWithRx (pot, buf) {
    let counter = 0;
    return new Promise(async (resolve) => {
        for (let i = 0; i < 3; i++) {
            let result = await ReceivePacket(pot, buf, 1, 15000);
            console.log(result);
            if (result === "ok") {
                printRxBuf();
                if (buf[0] === CRC16) {
                    counter++;
                }
            }
        }
        if (counter >= 2) {
            resolve(true);
        } else {
            resolve(false);
        }
    });
}
async function sendFileAsync (pot, binBuf) {
    let id = 0;
    let blockZero = Packet.getNormalPacket(
        id,
        Packet.getZeroContent(Config.file.symbol,
            binBuf.length));
    let errors = 0;

    console.log("Sending file ...")
    return new Promise(async (resolve) => {
        do {
            await DelayMs(1000);
            writeSerial(pot, blockZero);
            console.log("- Send out blockZero");
            // ACK
            let result = await ReceivePacket(pot, rxBuffer, 1, 1000);
            if (result === "ok") {
                printRxBuf();
            } else {
                console.log("Received nothing");
                errors++;
                continue;
            }

            if (rxBuffer[0] === ACK) {
                console.log("Received ACK")
            } else {
                errors++;
                continue
            }

            // CRC16
            result = await ReceivePacket(pot, rxBuffer, 1, 2000);
            if (result === "ok") {
                printRxBuf();
            } else {
                console.log("Received nothing");
                errors++;
                continue;
            }

            if (rxBuffer[0] === CRC16) {
                console.log("Received CRC")
                break;
            } else {
                errors++;
                continue;
            }

        } while (errors < 5)

        if (errors >= 5) {
            console.log("- Send block 0 fail")
            resolve(-1);
            return;
        } else {
            console.log("- Send block 0 succeed\r\n")
        }

        // id++
        errors = 0;
        for (let i = 0; i < binBuf.length; i += 128) {
            if (errors > 5) {
                console.log("sending blocks fail")
                resolve(-2);
                return;
            }
            console.log("\n- Send block " + (i / 128 + 1) + " block");

            let upper = (binBuf.length < i + 128) ?
                binBuf.length : i + 128;

            let payloadBuf = new Buffer(128);
            for (let j = i; j < upper; j++) {
                payloadBuf[j - i] = binBuf[j];
            }
            id = i / 128 + 1;
            let block = Packet.getNormalPacket(
                id,
                payloadBuf);

            await DelayMs(50);
            writeSerial(pot, block);

            let result = await ReceivePacket(pot, rxBuffer, 1, 1000);
            if (result === "ok") {
                printRxBuf();
            } else {
                console.log("no response");
                errors++;
                i -= 128;
                continue;
            }
            if (rxBuffer[0] !== ACK) {
                console.log("no ACK")
                errors++;
                i -= 128;
                continue;
            }
            console.log("- Send block " + (i / 128 + 1) +
                " succceed!");
        }

        // send EOT
        console.log("- Send EOT");
        errors = 0;
        do {
            if (errors > 5) {
                resolve(-3);
                return;
            }
            await DelayMs(1000);
            writeSerial(pot, Buffer.from([EOT]));

            let result = await ReceivePacket(pot, rxBuffer, 1, 1500);
            if (result === "ok") {
                printRxBuf();
            } else {
                console.log("no response");
                errors++;

                continue;
            }
            if (rxBuffer[0] !== ACK) {
                console.log("no ACK")
                errors++;
                continue;
            } else {
                console.log("ACK")
                break;
            }

        } while (true);
        console.log("- EOT send succeed!")

        // send last block
        errors = 0;
        do {
            if (errors > 3) {
                console.log("Can not finish")
                resolve(-3);
                return;
            }
            await DelayMs(1000);
            let blockLast = Packet.getNormalPacket(
                0,
                new Buffer(128)
            );
            console.log("Send last block finish")
            writeSerial(pot, blockLast);
            let result = await ReceivePacket(pot, rxBuffer, 1, 1000);
            if (result === "ok") {
                printRxBuf();
            } else {
                console.log("no response");
                errors++;
                continue;
            }
            if (rxBuffer[0] !== ACK) {
                console.log("no ACK")
                errors++;
                continue;
            } else {
                console.log("ACK")
                break;
            }
        } while (true)
        console.log("last block finished")
        resolve(0);
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

    port.on("data", (data) => {
        emData.emit("data", data);
    })


    console.log("Read a bin file:", Config.file.name);

    let binary = fs.readFileSync(Config.file.name);
    console.log("binary size:", binary.length);

    console.log("Begin to download");


    // port.write('1');
    let d = 0;

    while (bLoop) {

        /*  test  */
        // console.log("send:", d);
        // port.write(d++ + '')
        // port.write("abcde")

        // await DelayMs(1000);

        // if (d > 10) {
        //     d = 0;
        // }

        preWorking(port);
        await DelayMs(1000);

        if ((await syncWithRx(port, rxBuffer)) === true) {
            // let 
            let status = 0;
            await DelayMs(100);
            status = await sendFileAsync(port, binary);
            if (status === 0) {
                console.log("Send file completed")
                break;
            } else {
                console.log("Send file failed")
            }
        }
        console.log("Wait 10 seconds");
        await DelayMs(10000);
        console.log("Resend the file")
    }

    console.log('-- end --');
    process.exit();
}

main();

