import fetch from "node-fetch";
import twilio from "twilio";
import http from "http";
import url from "url";
import "dotenv/config";
import nodemailer from "nodemailer";

process.stdout.write("\x1bc");
log("Hello from Notiflier");

const USE_HTTP_SERVER = true;
const HTTP_HOST = process.env.HTTP_HOST;
const HTTP_PORT = 8080;
const VM_IP = process.env.VM_IP;

if (USE_HTTP_SERVER) {
  const httpRequestListener = function (req, res) {
    log(`Request from ${req.socket.remoteAddress}`);
    let query = url.parse(req.url, true).query;
    if (query !== undefined) {
      let hex = query.hex;
      if (trackedAircraft.indexOf(hex) !== -1) {
        log(
          `Proceeding with request to stop tracking ${hex}; placing on long cooldown`
        );
        sendMessage(`Stopped tracking ${hex}; placing on long cooldown.`);
        trackedAircraft[trackedAircraft.indexOf(hex)] = null;

        aircraftOnCooldown.push(hex);
        setTimeout(() => {
          // Take off cooldown after it is done
          aircraftOnCooldown.splice(aircraftOnCooldown.indexOf(hex), 1);
          log(`[${hex}]: Off long cooldown`);
        }, MANUAL_STOP_TRACKING_COOLDOWN_TIME);

        res.writeHead(200);
        res.end();
      } else {
        log(`Request bad; could not find hex in tracked aircraft`);
        res.writeHead(500);
        res.end();
      }
    } else {
      log(`Request failed; invalid query: ${query.toString()}`);
      res.writeHead(400);
      res.end();
    }
  };
  const httpServer = http.createServer(httpRequestListener);
  httpServer.listen(HTTP_PORT, HTTP_HOST, () => {
    log(`HTTP server running on http://${HTTP_HOST}:${HTTP_PORT}`);
  });
}

const COMM_METHOD = process.env.COMM_METHOD;

if (COMM_METHOD !== "twilio" && COMM_METHOD !== "email") {
  log(`No valid communication method specified; COMM_METHOD: ${COMM_METHOD}`);
  exit(-1);
}

const ACCOUNT_SID = process.env.ACCOUNT_SID;
const AUTH_TOKEN = process.env.AUTH_TOKEN;
const TWILIO_SENDER_NUMBER = process.env.TWILIO_SENDER_NUMBER;
const TWILIO_TARGET_NUMBER = process.env.TWILIO_TARGET_NUMBER;
const ADSB_AUTH_TOKEN = process.env.ADSB_AUTH_TOKEN;
const LAT = process.env.LAT;
const LON = process.env.LON;

const USE_TWILIO = COMM_METHOD === "twilio";
let client = USE_TWILIO ? twilio(ACCOUNT_SID, AUTH_TOKEN) : null;

const EMAIL_SERVICE = process.env.EMAIL_SERVICE;
const EMAIL_EMAIL = process.env.EMAIL_EMAIL;
const EMAIL_PASS = process.env.EMAIL_PASS;
const EMAIL_TO = process.env.EMAIL_TO;

const USE_EMAIL = COMM_METHOD === "email";
let transporter = USE_EMAIL
  ? nodemailer.createTransport({
      service: EMAIL_SERVICE,
      auth: {
        user: EMAIL_EMAIL,
        pass: EMAIL_PASS,
      },
    })
  : null;

const INTERESTED_TYPES = [
  "C130",
  "H47",
  "H60",
  "E3TF",
  "K35R",
  "TEX2",
  "T38",
  "C17",
  "B1",
  "C30J",
  "C32",
  //"DHC6",
  //"SR20",
  //"PA18",
];
const MAX_ALT = 12000;
const MIN_SPEED = 150;
const ABS_MIN_SPEED = 100;
const SEARCH_RADIUS_NM = process.env.SEARCH_RADIUS_NM;

var trackedAircraft = [];
var aircraftOnCooldown = [];
var updatedTrackedAircraftInterval = null;
const COOLDOWN_TIME = 60000;
// Let's hope the hex isn't gonna be used in the next 24 hours lol
const MANUAL_STOP_TRACKING_COOLDOWN_TIME = 24 * 60 * 60 * 1000;

const FETCH_AIRCRAFT_INTERVAL_TIME_SLOW = 60000;
const FETCH_AIRCRAFT_INTERVAL_TIME_FAST = 30000;

sendMessage("Notiflier has started", "none");
fetchAircraft();
var fetchAircraftInterval = setInterval(
  fetchAircraft,
  FETCH_AIRCRAFT_INTERVAL_TIME_SLOW
);

async function fetchAircraft() {
  log("Fetching aircraft...");
  var response = null;
  var data = null;
  try {
    response = await fetch(
      `https://adsbexchange-com1.p.rapidapi.com/v2/lat/${LAT}/lon/${LON}/dist/${SEARCH_RADIUS_NM}/`,
      {
        method: "get",
        headers: {
          "X-RapidAPI-Key": ADSB_AUTH_TOKEN,
          "X-RapidAPI-Host": "adsbexchange-com1.p.rapidapi.com",
        },
      }
    );
    data = await response.json();
  } catch (e) {
    log(`Error: Could not fetch aircraft: ${e}`);
  }

  if (data !== null) {
    if (response.status !== 200) {
      log(`Error: Fetch aircraft response was ${response.status}`);
    } else {
      if (data.hasOwnProperty("msg")) {
        if (data["msg"] === "No error") {
          let nAircraft = data["total"];
          log(
            `${nAircraft > 0 ? nAircraft : "No"} aircraft ${
              nAircraft === 1 ? "is" : "are"
            } within ${SEARCH_RADIUS_NM} NM of the specified area`
          );

          // Check to see if all aircraft we are tracking are still within SEARCH_RADIUS_NM NM
          for (var i = 0; i < trackedAircraft.length; i++) {
            // The tracked aircraft would be null if it was stopped tracking because of an HTTP request
            if (trackedAircraft[i] !== null) {
              var trackedAircraftHex = trackedAircraft[i];
              var trackedAircraftObject = null;
              var searching = true;
              // See if the current tracked aircraft we are looking at is still within SEARCH_RADIUS_NM NM
              for (var j = 0; j < data["total"] && searching; j++) {
                if (
                  data["ac"][j] !== null &&
                  data["ac"][j]["hex"] === trackedAircraftHex
                ) {
                  searching = false;
                  // Make a copy with JSON.parse(JSON.stringify())
                  trackedAircraftObject = JSON.parse(
                    JSON.stringify(data["ac"][j])
                  );
                  data["ac"][j] = null;
                }
              }
              // If the aircraft is no longer within SEARCH_RADIUS_NM NM
              if (searching) {
                // Mark that we need to stop tracking it
                trackedAircraft[i] = null;
                // Put on cooldown
                aircraftOnCooldown.push(trackedAircraftHex);
                setTimeout(() => {
                  // Take off cooldown after it is done
                  aircraftOnCooldown.splice(
                    aircraftOnCooldown.indexOf(trackedAircraftHex),
                    1
                  );
                  log(`[${trackedAircraftHex}]: Off cooldown`);
                }, COOLDOWN_TIME);
                log(`[${trackedAircraftHex}]: Stopped tracking; on cooldown`);
                sendMessage(
                  `Stopped tracking ${trackedAircraftHex}; placing on short cooldown.`
                );
              }
              // Otherwise, if the aircraft is still within SEARCH_RADIUS_NM NM
              else {
                let body = `[${trackedAircraftHex}${
                  trackedAircraftObject.hasOwnProperty("flight")
                    ? " (" + trackedAircraftObject["flight"] + ")"
                    : ""
                }] T: ${
                  trackedAircraftObject.hasOwnProperty("t")
                    ? trackedAircraftObject["t"]
                    : "n/a"
                }. Alt: ${
                  trackedAircraftObject.hasOwnProperty("baro_alt")
                    ? trackedAircraftObject["baro_alt"]
                    : trackedAircraftObject.hasOwnProperty("alt_geom")
                    ? trackedAircraftObject["alt_geom"]
                    : trackedAircraftObject.hasOwnProperty("nav_altitude_mcp")
                    ? trackedAircraftObject["nav_altitude_mcp"]
                    : "n/a"
                }. GS: ${
                  trackedAircraftObject.hasOwnProperty("gs")
                    ? trackedAircraftObject["gs"]
                    : "n/a"
                }. Dir: ${
                  trackedAircraftObject.hasOwnProperty("track")
                    ? trackedAircraftObject["track"]
                    : "n/a"
                }.`;
                sendMessage(body, trackedAircraftHex);
              }
            }
          }

          // If any aircraft are not being tracked anymore, they were set to null above, so remove them from the tracked aircraft list
          for (var i = 0; i < trackedAircraft.length; i++) {
            if (trackedAircraft[i] === null) {
              trackedAircraft.splice(i, 1);

              // If we're no longer tracking any aicraft (but once were), reset the fetch interval
              if (trackedAircraft.length === 0) {
                log(
                  "No longer tracking any aircraft; setting fetch aircraft interval to slow"
                );
                clearInterval(fetchAircraftInterval);
                fetchAircraftInterval = setInterval(
                  fetchAircraft,
                  FETCH_AIRCRAFT_INTERVAL_TIME_SLOW
                );
              }

              // The length of trackedAircraft has changed, so start from the beginning now
              i = 0;
            }
          }

          // After checking on our tracked aircraft, see if there are any that need to start being tracked
          for (var i = 0; i < nAircraft; i++) {
            // Any aircraft that are already being tracked will be set to null in the tracked aircraft check above
            if (data["ac"][i] !== null) {
              var interested = false;
              var reason = "";
              // If type is a military aircraft
              if (data["ac"][i].hasOwnProperty("t")) {
                if (INTERESTED_TYPES.indexOf(data["ac"][i]["t"]) !== -1) {
                  reason = "type match";
                  interested = true;
                }
              }
              // Otherwise, if aircraft does not have a callsign or registration, then it's probably a fighter (check speed to make sure it's not a sailplane though)
              else if (
                !data["ac"][i].hasOwnProperty("flight") &&
                !data["ac"][i].hasOwnProperty("r") &&
                data["ac"][i].hasOwnProperty("gs") &&
                data["ac"][i]["gs"] >= MIN_SPEED
              ) {
                reason = "no flt or reg; meets alt & gs req";
                interested = true;
              }
              // Otherwise, if the aircraft is going low enough and slow enough, then it's probably a military aircraft with special clearance
              else if (
                getAltitude(data["ac"][i]) !== null &&
                getAltitude(data["ac"][i] <= MAX_ALT) &&
                data.hasOwnProperty("gs") &&
                data["ac"][i]["gs"] >= MIN_SPEED
              ) {
                reason = "meets alt & gs req";
                interested = true;
              }

              if (interested) {
                // If the aircraft is reporting altitude and it is above MAX_ALT,
                // or the aircraft is probably on the ground (moving too slow
                // to be flying), we are no longer interested
                if (
                  (getAltitude(data["ac"][i]) !== null &&
                    getAltitude(data["ac"][i]["alt_baro"]) > MAX_ALT) ||
                  data["ac"]["gs"] < ABS_MIN_SPEED
                ) {
                  interested = false;
                }
              }
              if (interested) {
                startTracking(
                  JSON.parse(JSON.stringify(data["ac"][i])),
                  reason
                );
              }
            }
          }
        } else {
          log('Error: response msg was not "No error"');
        }
      } else {
        log("Error: response does not have property msg");
      }
    }
  }
}

async function startTracking(aircraft, reason) {
  let hex = aircraft["hex"];
  if (aircraft.hasOwnProperty("flight")) {
    aircraft["flight"].trimEnd();
  }
  if (aircraftOnCooldown.indexOf(hex) === -1) {
    trackedAircraft.push(hex);
    log(`[${hex}]: Started tracking`);
    let body = `Started tracking ${hex} b/c ${reason}. Flt: ${
      aircraft.hasOwnProperty("flight") ? aircraft["flight"] : "n/a"
    }. T: ${aircraft.hasOwnProperty("t") ? aircraft["t"] : "n/a"}. Alt: ${
      getAltitude(aircraft) !== null ? getAltitude(aircraft) : "n/a"
    }. GS: ${aircraft.hasOwnProperty("gs") ? aircraft["gs"] : "n/a"}. Dir: ${
      aircraft.hasOwnProperty("track") ? aircraft["track"] : "n/a"
    }.`;
    //}. Stop tracking with http://${VM_IP}?hex=${hex}/`;
    sendMessage(body, hex);

    // If this is the first aircraft we started tracking, set the fetch interval to fast
    if (trackedAircraft.length === 1) {
      log("Setting fetch aircraft interval to fast");
      clearInterval(fetchAircraftInterval);
      fetchAircraftInterval = setInterval(
        fetchAircraft,
        FETCH_AIRCRAFT_INTERVAL_TIME_FAST
      );
    }
  }
}

function log(shenme) {
  let now = new Date();
  console.log(`${"\x1b[94m"}${now.toUTCString()} -> ${"\x1b[0m"}${shenme}`);
}

async function sendMessage(body, hex) {
  if (USE_TWILIO) {
    let message = await client.messages.create({
      body: body,
      to: TWILIO_TARGET_NUMBER,
      from: TWILIO_SENDER_NUMBER,
    });
    log(
      `[${hex}] Message sent from ${message.from} to ${message.to}: ${message.body}`
    );
  } else if (USE_EMAIL) {
    transporter.sendMail(
      {
        from: EMAIL_EMAIL,
        to: EMAIL_TO,
        subject: "Notiflier",
        text: body,
      },
      (error, info) => {
        if (error) {
          log(
            `sendMessage encountered error while trying to send email: ${error}`
          );
        } else {
          log(`Email sent from ${EMAIL_EMAIL} to ${EMAIL_TO}: ${body}`);
        }
      }
    );
  } else {
    log(
      `[${hex}] (NOT USING TWILIO OR EMAIL) Message would have been: ${body}`
    );
  }
}

function getAltitude(aircraft) {
  return aircraft.hasOwnProperty("baro_alt")
    ? aircraft["baro_alt"]
    : aircraft.hasOwnProperty("alt_geom")
    ? aircraft["alt_geom"]
    : aircraft.hasOwnProperty("nav_altitude_mcp")
    ? aircraft["nav_altitude_mcp"]
    : null;
}
