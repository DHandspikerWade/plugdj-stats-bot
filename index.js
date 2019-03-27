const PlugAPI = require('plugapi');
const fs = require('fs');
const argv = require('minimist')(process.argv.slice(2));
const logger = new (require("jethro"))();

require('dotenv').config();

let dataHandle;
if (process.env.PLUGDJ_REDIS) {
    dataHandle = require('./redis')(logger);
} else {
    dataHandle = require('./sqlite')(logger);
}

if (!dataHandle.getConfig) {
    dataHandle.getConfig = (() => {
        const fsp = fs.promises;

        if (!fs.existsSync('config.json')) {
            fs.appendFileSync('config.json', '{}');
        }

        return function(key, callback) {
            let returnPromise = new Promise((resolve) => {
                fsp.readFile('config.json', 'utf8').then((contents) => {
                    resolve(JSON.parse(contents)[key]);
                }, () => {
                    logger.error(LOGGER_DEFAULT_SOURCE, 'Failed to read config.json.');
                    resolve(false);
                });
            });

            if (callback) {
                returnPromise.then(callback);
            }

            return returnPromise;
        };
    })();
}

if (!dataHandle.setConfig) {
    dataHandle.setConfig = (() => {
        const fsp = fs.promises;
        
        if (!fs.existsSync('config.json')) {
            fs.appendFileSync('config.json', '{}');
        }

        return function(key, value) {
            let returnPromise = new Promise((resolve, reject) => {
                fsp.readFile('config.json', 'utf8').then((contents) => {
                    let data = JSON.parse(contents);
                    data[key] = value;

                    fsp.writeFile('config.json', JSON.stringify(data), 'utf8').then(() => {
                        resolve();
                    }, reject);

                }, (reason) => {
                    reject('Failed to read config.json. ' + reason);
                });
            });

            return returnPromise;
        };
    })();
}

let ROOM;
if (typeof argv.r === 'string') {
    ROOM = argv.r;
} else if (process.env.PLUGDJ_ROOM) {
    ROOM = process.env.PLUGDJ_ROOM;
} else {
    // TODO: this is going to need restructure to work
    // ROOM = dataHandle.getConfig('room');
}

const LOGGER_DEFAULT_SOURCE = 'StatsBot';

logger.addToSourceWhitelist('console', LOGGER_DEFAULT_SOURCE);

let botParams = {};
if ('e' in argv && 'p' in argv && typeof argv.e === 'string' && typeof argv.p  === 'string') {
    botParams.email = argv.e;  
    botParams.password = argv.p;
}

if (process.env.PLUGDJ_EMAIL && !botParams.email) {
    botParams.email = process.env.PLUGDJ_EMAIL;
}

if (process.env.PLUGDJ_PASS && !botParams.password) {
    botParams.password = process.env.PLUGDJ_PASS;
}

if (!(botParams.password && botParams.email)) {
    botParams.guest = true;
}

const QUICK_FAIL = !!argv.bail

if (!ROOM) {
    logger.error(LOGGER_DEFAULT_SOURCE, 'No provided room slug');
    process.exit(1);
}

const bot = new PlugAPI(botParams);
bot.setLogger(logger);
bot.deleteCommands = false;

logger.info(LOGGER_DEFAULT_SOURCE, `Attempting to connect to "${ROOM}"`);
bot.connect(ROOM);

// Sleep mode detection
let lastHeartbeat = Date.now();
setInterval(() => {
    if (Date.now() - lastHeartbeat > 25e3) {
        logger.warn(LOGGER_DEFAULT_SOURCE, 'Heartbeat skipped');
        reconnect();
    }

    lastHeartbeat = Date.now();
}, 20e3)

function cleanup () {
    logger.info(LOGGER_DEFAULT_SOURCE, 'Performing cleanup');
    bot.close(false); logger.debug(LOGGER_DEFAULT_SOURCE, 'Closing PlugDJ connection');
    dataHandle.cleanup();
}

const shutdown = () => {
    cleanup();
    console.log('Exitting...');
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Wait a couple seconds so not to spam a room
let _isReconnecting = false;
const reconnect = () => { 
    if (QUICK_FAIL) {
        cleanup();
        process.exit(1);
        return;
    } 

    logger.warn(LOGGER_DEFAULT_SOURCE, 'Trying to reconnect'); 
    _isReconnecting = true; 

    setTimeout(() => { 
        bot.close(true);

        setTimeout(() => {
            bot.connect(ROOM); 
            
            dataHandle.getConfig('storeHistory', (value) => {
                if (bot.getDJ() && bot.getMedia()) {
                    dataHandle.newDj(bot.getDJ());
                    dataHandle.newSong(bot.getMedia());
                }
            });
            _isReconnecting = false;
        }, 1000);
    }, 4000); 
};

bot.on('close', reconnect);
bot.on('error', reconnect);

bot.on(PlugAPI.events.ROOM_JOIN, (room) => {
    logger.debug(LOGGER_DEFAULT_SOURCE, 'Recieved ROOM_JOIN event');
    logger.info(LOGGER_DEFAULT_SOURCE, `Joined ${room}`);
});

bot.on(PlugAPI.events.MODERATE_SKIP, (data) => {
    logger.debug(LOGGER_DEFAULT_SOURCE, 'Recieved MODERATE_SKIP event');
    logger.info(LOGGER_DEFAULT_SOURCE, `${data.user.username} Skipped the song`);
 });

 bot.on(PlugAPI.events.EARN, (data) => {
    logger.info(LOGGER_DEFAULT_SOURCE, `You are currently level ${data.level} with: ${data.pp} PP and ${data.xp} XP `);
 });

let latest_song;
bot.on(PlugAPI.events.ADVANCE, (data) => {
    logger.debug(LOGGER_DEFAULT_SOURCE, 'Recieved ADVANCE event');
    if (data) {
        if (data.media && latest_song !== data.media.id) { //Only log once. PlugDj sends it multiple times when connecting. Updates are fine; multiple logs are annoying.
            logger.info(LOGGER_DEFAULT_SOURCE, 'Now playing: ' + data.media.title);
            latest_song = data.media.id;

            setTimeout(() => {
                logger.debug(LOGGER_DEFAULT_SOURCE, 'Checking connection status');
                let currentMedia = bot.getMedia();
                if (currentMedia && data.media.cid == currentMedia.cid) {
                    logger.debug(LOGGER_DEFAULT_SOURCE, 'Song has run long. Attempting reconnection. Role:' + bot.getSelf().role );

                    if (bot.getSelf() && bot.getSelf().role >= PlugAPI.ROOM_ROLE.BOUNCER){
                        dataHandle.getConfig('skipEnabled', (value) => {
                            value && bot.moderateForceSkip();
                        });
                    } else {
                        reconnect();
                    }
                }
            }, (data.media.duration - bot.getTimeElapsed() + 5) * 1000); // Just use duration because 

            if (bot.getSelf()) {
                dataHandle.getConfig('autoWoot', (value) => {
                    value && bot.woot();
                });                
            }
        }

        dataHandle.getConfig('storeHistory', (value) => {
            if (value) {
                if (data.currentDJ) {
                    dataHandle.newDj(data.currentDJ);
                    dataHandle.newSong(data.media);
                }

                if (data.lastPlay) {
                    dataHandle.newDj(data.lastPlay.dj);
                    dataHandle.newSong(data.lastPlay.media);
                    dataHandle.insertPlay(ROOM, data.lastPlay.media, data.lastPlay.score, data.lastPlay.dj);
                }
            }
        });
    }
});

bot.on(PlugAPI.events.BAN, (data) => {
    logger.debug(LOGGER_DEFAULT_SOURCE, 'Recieved BAN event');
    logger.error(LOGGER_DEFAULT_SOURCE, 'The bot has been banned');
    cleanup();
    process.exit(0);
})

bot.on('command:enableLongSkip', (data) => {
    if (data.havePermission(PlugAPI.ROOM_ROLE.BOUNCER)) {
        logger.info(LOGGER_DEFAULT_SOURCE, 'Got comand: enableLongSkip ' + JSON.stringify(data.args));
        if (data.args[0]== 'yes') {
            dataHandle.setConfig('skipEnabled', true);
            data.respond('Skipping stuck songs.');
        } else if (data.args[0] == 'no') {
            dataHandle.setConfig('skipEnabled', false);
            data.respond('Not skipping stuck songs.');
        }
     }
});

bot.on('command:enableAutoWoot', (data) => {
    dataHandle.getConfig('owner', (owner) => {
        if (owner && data.from.username.toLowerCase() == owner.toLowerCase()) {
            logger.info(LOGGER_DEFAULT_SOURCE, 'Got comand: enableAutoWoot ' + JSON.stringify(data.args));
            if (data.args[0]== 'yes') {
                dataHandle.setConfig('autoWoot', true);
                data.respond('Every song is great.');
            } else if (data.args[0] == 'no') {
                dataHandle.setConfig('autoWoot', false);
                data.respond('I\'ll just listen.');
            }
        } else if (owner){
            data.respond(`You're not @${owner}`)
        }
    });

});