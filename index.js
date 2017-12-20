const PlugAPI = require('plugapi');
const sqlite3 = require('sqlite3');
const argv = require('minimist')(process.argv.slice(2));
const logger = new require("jethro")();
const stdin = process.stdin;

const ROOM = argv.r;
const LOGGER_DEFAULT_SOURCE = 'StatsBot';

var room_statement;

if (!ROOM) {
    logger.error(LOGGER_DEFAULT_SOURCE, 'No provided room slug');
    process.exit(1);
}

logger.addToSourceWhitelist('console', LOGGER_DEFAULT_SOURCE);

stdin.setRawMode(true);
stdin.setEncoding('utf8');

logger.info(LOGGER_DEFAULT_SOURCE,'Creating or verifying database.');
const db = new sqlite3.Database('./stats.sqlite');
db.serialize();
db.exec('PRAGMA foreign_keys = FALSE')
    .exec('CREATE TABLE IF NOT EXISTS `dj` ( `id` INTEGER NOT NULL, `username` TEXT, PRIMARY KEY(`id`) ) WITHOUT ROWID')
    .exec('CREATE TABLE IF NOT EXISTS "play" ( `song_id` INTEGER NOT NULL, `room_slug` INTEGER NOT NULL, `dj_id` INTEGER NOT NULL, `woots` INTEGER NOT NULL DEFAULT 0, `grabs` INTEGER NOT NULL DEFAULT 0, `mehs` INTEGER NOT NULL DEFAULT 0, `skipped` INTEGER NOT NULL DEFAULT 0, `listeners` INTEGER NOT NULL DEFAULT 0 )')
    .exec('CREATE TABLE IF NOT EXISTS `room` ( `slug` TEXT NOT NULL UNIQUE, `title` TEXT )')
    .exec('CREATE TABLE IF NOT EXISTS "song" ( `title` TEXT, `cid` TEXT, `author` TEXT, `id` INTEGER NOT NULL, PRIMARY KEY(`id`) ) WITHOUT ROWID')
    .exec('PRAGMA optimize')
    .exec('PRAGMA auto_vacuum = FULL');

db.parallelize();
let botParams;
if ('e' in argv && 'p' in argv) {
    botParams = {email: argv.e, password: argv.p};
} else {
    botParams = {guest: true};
}

const bot = new PlugAPI(botParams);
bot.setLogger(logger);

function cleanup () {
    logger.info(LOGGER_DEFAULT_SOURCE, 'Performing cleanup');
    bot.close(false); logger.debug(LOGGER_DEFAULT_SOURCE, 'Closing PlugDJ connection');
    db.close(); logger.debug(LOGGER_DEFAULT_SOURCE, 'Closing SQLite database');
}

function newDj(db, dj) {
    logger.debug(LOGGER_DEFAULT_SOURCE, 'Attempting to update dj ' + dj.id);
    db.run('UPDATE dj SET username = ? WHERE id = ?', dj.username, dj.id, function (err) { // Must be long form function to use `this.changes`
        if (err) throw err;

        if (this.changes == 0) {
            logger.debug(LOGGER_DEFAULT_SOURCE, 'Attempting to insert dj ' + dj.id);
            db.run('INSERT INTO dj (username, id) VALUES (?, ?)', dj.username, dj.id, (err) => {
                if (err) logger.error(LOGGER_DEFAULT_SOURCE, err);
            });
        }
    });
}

function newSong(db, media) {
    logger.debug(LOGGER_DEFAULT_SOURCE, 'Attempting to update song ' + media.id);
    db.get('SELECT id FROM song WHERE id = ?', media.id, (err, row) => {
        if (err) throw err;

        if (!row) {
            logger.debug(LOGGER_DEFAULT_SOURCE, 'Attempting to insert song ' + media.id);
            db.run('INSERT INTO song (id, cid, author, title) VALUES (?,?,?,?)', media.id, media.cid, media.author, media.title);
        }
    });
}

function insertPlay(db, room, media, score, user) {
    if (media && 'id' in media) {
        logger.debug(LOGGER_DEFAULT_SOURCE, 'Attempting to insert new play for song ' + media.id);
        if (user) {
            db.run('INSERT INTO play (song_id, room_slug, dj_id, woots, grabs, mehs, skipped) VALUES (?,?,?,?,?,?,?)', 
                [media.id, room, user.id, score.positive, score.grabs, score.negative, score.skipped ? 1 : 0]
            );

            return true;
        }
    }

    return false;
}

stdin.on('data', (key) => {
    //This is a piss-poor user interface
    // Letter "q" to quit
    if (key == '\u0071') {
        cleanup();
        console.log('Exitting...');
        process.exit(0);
    }
});

// Wait a couple seconds so not to spam a room
const reconnect = () => { logger.warn(LOGGER_DEFAULT_SOURCE, 'Trying to reconnect'); setTimeout(() => {bot.connect(ROOM);}, 4000); };

bot.on('close', reconnect);
bot.on('error', reconnect);

bot.on(PlugAPI.events.ROOM_JOIN, (room) => {
    logger.debug(LOGGER_DEFAULT_SOURCE, 'Recieved ROOM_JOIN event');
    console.log(`Joined ${room}`);
});

bot.on(PlugAPI.events.MODERATE_SKIP, (data) => {
    logger.debug(LOGGER_DEFAULT_SOURCE, 'Recieved MODERATE_SKIP event');
    console.log(`${data.user.username} Skipped the song`);
 });

let latest_song;
bot.on(PlugAPI.events.ADVANCE, (data) => {
    logger.debug(LOGGER_DEFAULT_SOURCE, 'Recieved ADVANCE event');
    if (data) {
        if (data.media && latest_song !== data.media.id) { //Only log once. PlugDj sends it multiple times when connecting. Updates are fine; multiple logs are annoying.
            logger.info(LOGGER_DEFAULT_SOURCE, 'Now playing: ' + data.media.title);
            latest_song = data.media.id;
        }

        if (data.currentDJ) {
            newDj(db, data.currentDJ);
            newSong(db, data.media);
        }

        if (data.lastPlay) {
            insertPlay(db, ROOM, data.lastPlay.media, data.lastPlay.score, data.lastPlay.dj);
        }
    }
});

bot.on(PlugAPI.events.BAN, (data) => {
    logger.debug(LOGGER_DEFAULT_SOURCE, 'Recieved BAN event');
    logger.error(LOGGER_DEFAULT_SOURCE, 'The bot has been banned');
    cleanup();
    process.exit(0);
})

logger.info(LOGGER_DEFAULT_SOURCE, `Atempting to connect to "${ROOM}"`);
bot.connect(ROOM);

