"use strict";

let events = require("events");

let em = new events.EventEmitter();

async function main () {
  console.log("Test remove listener")

  let handle = setTimeout(() => {
    console.log("Timeout happen");
    // em.emit("data", "gogo")
    em.removeAllListeners("data")
  }, 3000);

  let handle2 = setInterval(() => {
    em.emit("data", "gogogo");
  }, 1000);

  em.on("data", (data) => {
    console.log("em receive ", data);
  })

}

main();
