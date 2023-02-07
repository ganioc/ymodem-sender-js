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


module.exports = {
    DelayMs: DelayMs,
    PrintConfig: printConfig,
};