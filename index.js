"use strict";

const SerialPort = require('serialport')
const fs = require("fs");
const Config = require("./config/config.json");
const crc16 = require("./crc16");
const Packet = require("./packet");
const events = require("events");
const emData = new events.EventEmitter();
let crc32 = require("js-crc32");


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
function preErasing (port) {
    // send out character '1'
    port.write('2');
    console.log("Erase the Flash");
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

        let payloadBuf = new Buffer.alloc(128);
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
            console.log("Sync with Rx counter:", counter);
            let result = await ReceivePacket(pot, buf, 1, 2000);
            console.log(result);
            if (result === "ok") {
                printRxBuf();
                if (buf[0] === CRC16) {
                    counter++;
                }
            }
        }
        if (counter >= 1) {
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
            await DelayMs(400);
            writeSerial(pot, blockZero);
            console.log("- Send out blockZero");
            // ACK
            let result = await ReceivePacket(pot, rxBuffer, 1, 2000);
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
            result = await ReceivePacket(pot, rxBuffer, 1, 1000);
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
        let nInterval = (bUse1K == true) ? 1024 : 128;
        for (let i = 0; i < binBuf.length; i += nInterval) {
            if (errors > 5) {
                console.log("sending blocks fail")
                resolve(-2);
                return;
            }
            let str = i.toString(16);
            while (str.length < 5) {
                str = "0" + str;
            }

            console.log("\n- Send block " + (i / nInterval + 1) + " block");

            console.log("0x" + str);

            let upper = (binBuf.length < i + nInterval) ?
                binBuf.length : i + nInterval;

            let payloadBuf = new Buffer.alloc(nInterval);
            for (let j = i; j < upper; j++) {
                payloadBuf[j - i] = binBuf[j];
            }
            id = i / nInterval + 1;
            let block = (bUse1K == true) ? Packet.getLongPacket(id, payloadBuf) : Packet.getNormalPacket(
                id,
                payloadBuf);

            await DelayMs(100);
            writeSerial(pot, block, i);

            let result = await ReceivePacket(pot, rxBuffer, 1, 2000);
            if (result === "ok") {
                printRxBuf();
            } else {
                console.log("no response");
                errors++;
                i -= 128;
                continue;
            }
            if (rxBuffer[0] === CA) {
                console.log("Write to Flash failed")
                resolve(-5);
                return;
            }
            else if (rxBuffer[0] !== ACK) {
                console.log("no ACK")
                errors++;
                i -= 128;
                continue;
            }
            console.log("- Send block " + (i / 128 + 1) +
                " succceed!");
        }

        // send EOT
        console.log("\n- Send EOT");
        errors = 0;
        do {
            if (errors > 5) {
                resolve(-3);
                return;
            }
            await DelayMs(100);
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
            await DelayMs(100);
            let blockLast = Packet.getNormalPacket(
                0,
                new Buffer.alloc(128)
            );
            console.log("Send last block finish")
            writeSerial(pot, blockLast);
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
        } while (true)
        console.log("last block finished")
        resolve(0);
    });
}
async function main () {
    console.log("-- Hello world --");

    console.log("use YMODEM 1k: ", bUse1K)

    // let a = crc16(Buffer.from([0x1, 0x2, 0x3, 0x4]), 4);
    // console.log(a);
    // console.log("0x", a.toString(16));

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
    console.log("binary/128=", binary.length / 128);
    console.log("binary/1024=", binary.length / 1024);

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

        preErasing(port);
        await DelayMs(2000);
        preWorking(port);
        await DelayMs(1000);

        console.log("- start time:", new Date().toString());
        if ((await syncWithRx(port, rxBuffer)) === true) {

            // process.exit(0);
            // let 
            let status = 0;
            await DelayMs(100);
            status = await sendFileAsync(port, binary);
            if (status === 0) {
                console.log("Send file completed")
                console.log("- end time:", new Date().toString())
                break;
            } else {
                console.log("Send file failed")
            }
        } else {
            process.exit(0);
        }
        console.log("Wait 10 seconds");
        await DelayMs(10000);
        console.log("Resend the file")
    }

    console.log('-- end --');
    process.exit();
}
/**
 * calculate the whole bank crc, I won't consider the size of the real file length
 */
function calc_crc () {
    let len = 0x10000;

    console.log("Calculate the whole bank crc32");
    console.log("bank size: 0x" + len.toString(16));
    console.log("Read a bin file:", Config.file.name);


    let binary = fs.readFileSync(Config.file.name);
    console.log("binary size:", binary.length, " 0x" + binary.length.toString(16));

    console.log("binary/128=", binary.length / 128);
    console.log("binary/1024=", binary.length / 1024);

    // let buf = new Buffer(0x10000);
    let buf = new Buffer.alloc(0x10000);
    for (let i = 0; i < buf.length; i++) {
        if (i < binary.length) {
            buf[i] = binary[i];
        }
    }
    console.log("\n[0x1a, 0x2b, 0x3c, 0x4d] ->")
    console.log("crc32 is:", crc32(new Buffer([0x1a, 0x2b, 0x3c, 0x4d])).toString(16));

    let newCRC = crc32(buf);
    var buf1 = new Buffer.alloc(4);

    buf1.writeInt32BE(newCRC);

    let valCRC = buf1.readUInt32BE().toString(16);
    console.log("newCRC is:", valCRC);

    console.log("-- End --");

    /*
        console.log("\nPrint out the file:")
        buf = binary;
        for (let i = 0; i < buf.length; i += 16) {
            let str = "";
            str += ((i.toString(16).length < 2) ? ("0" + i.toString(16)) : i.toString(16)) + ": ";
            while (str.length < 7) {
                str = "0" + str;
            }
            str = "0x" + str;
            for (let j = i; j < i + 16; j = j + 4) {
                // str += (buf[j].toString(16).length < 2 ?
                //     "0" + buf[j].toString(16) : buf[j].toString(16));
                // str += " "
                let a1 = (buf[j].toString(16).length < 2 ?
                    "0" + buf[j].toString(16) : buf[j].toString(16));
                let a2 = (buf[j + 1].toString(16).length < 2 ?
                    "0" + buf[j + 1].toString(16) : buf[j + 1].toString(16));
                let a3 = (buf[j + 2].toString(16).length < 2 ?
                    "0" + buf[j + 2].toString(16) : buf[j + 2].toString(16));
                let a4 = (buf[j + 3].toString(16).length < 2 ?
                    "0" + buf[j + 3].toString(16) : buf[j + 3].toString(16));
                str += (a4 + a3 + a2 + a1 + " ");
            }
            console.log(str);
        }
        // for (let i = 0; i < buf.length; i += 16) {
        //     let str = "0x";
        //     str += ((i.toString(16).length < 2) ? ("0" + i.toString(16)) : i.toString(16)) + ": ";
        //     let upper = (buf.length < i + 16) ? buf.length : i + 16;
        //     for (let j = i; j < upper; j++) {
        //         str += (buf[j].toString(16).length < 2 ?
        //             "0" + buf[j].toString(16) : buf[j].toString(16));
        //         str += " "
        //     }
        //     console.log(str);
        // }
    */
}
async function testUart () {
    let port = new SerialPort(Config.test.port, {
        baudRate: Config.baudrate
    });
    console.log("Test uart:", Config.test.port);
    while (true) {
        await DelayMs(100);
        console.log("a");
        port.write("a");
    }
}
/**  ------------------------------------------------------------ */
let bUse1K = false;

for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === "1k" || process.argv[i] === "1K") {
        bUse1K = true;
        break;
    } else if (process.argv[i] === "crc" || process.argv[i] === "CRC") {
        // calc crc
        calc_crc();

        process.exit(0);
    } else if (process.argv[i] === "uart") {
        // send from uart
        testUart();
    }
}

main();

