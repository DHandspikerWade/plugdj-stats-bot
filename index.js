const PlugAPI = require('plugapi');
const fs = require('fs');
const argv = require('minimist')(process.argv.slice(2));
const logger = new (require("jethro"))();

require('dotenv').config();
const ROOM = typeof argv.r === 'string' ? argv.r : process.env.PLUGDJ_ROOM;
const LOGGER_DEFAULT_SOURCE = 'StatsBot';

if (!ROOM) {
    logger.error(LOGGER_DEFAULT_SOURCE, 'No provided room slug');
    process.exit(1);
}

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
if (!fs.existsSync('config.json')) {
    fs.appendFileSync('config.json', '{}');
}

let config = JSON.parse(fs.readFileSync('config.json'));  

const bot = new PlugAPI(botParams);
bot.setLogger(logger);
bot.deleteCommands = false;

let dataHandle;
if (process.env.PLUGDJ_REDIS) {
    dataHandle = require('./redis')(bot, logger);
} else {
    dataHandle = require('./sqlite')(bot, logger);
}

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
    fs.writeFileSync('config.json', JSON.stringify(config));
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

            if (bot.getDJ() && bot.getMedia()) {
                dataHandle.newDj(bot.getDJ());
                dataHandle.newSong(bot.getMedia());
            }
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
                        if (config.skipEnabled) {
                            bot.moderateForceSkip();
                        }
                    } else {
                        reconnect();
                    }
                }
            }, (data.media.duration - bot.getTimeElapsed() + 5) * 1000); // Just use duration because 

            if (config.autoWoot && bot.getSelf()) {
                bot.woot();
            }
        }

        if (data.currentDJ) {
            dataHandle.newDj(data.currentDJ);
            dataHandle.newSong(data.media);
        }

        if (data.lastPlay) {
            dataHandle.insertPlay(ROOM, data.lastPlay.media, data.lastPlay.score, data.lastPlay.dj);
        }
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
            config.skipEnabled = true;
            data.respond('Skipping stuck songs.');
        } else if (data.args[0] == 'no') {
            config.skipEnabled = false;
            data.respond('Not skipping stuck songs.');
        }
     }
});

bot.on('command:enableAutoWoot', (data) => {
    if (config.owner && data.from.username.toLowerCase() == config.owner.toLowerCase()) {
        logger.info(LOGGER_DEFAULT_SOURCE, 'Got comand: enableAutoWoot ' + JSON.stringify(data.args));
        if (data.args[0]== 'yes') {
            config.autoWoot = true;
            data.respond('Every song is great.');
        } else if (data.args[0] == 'no') {
            config.autoWoot = false;
            data.respond('I\'ll just listen.');
        }
    } else if (config.owner){
        data.respond(`You're not @${config.owner}`)
    }
});