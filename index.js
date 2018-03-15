const PlugAPI = require('plugapi');
const sqlite3 = require('sqlite3');
const argv = require('minimist')(process.argv.slice(2));
const logger = new (require("jethro"))();

const DB_VERSION = 2;

const ROOM = argv.r;
const LOGGER_DEFAULT_SOURCE = 'StatsBot';

if (!ROOM) {
    logger.error(LOGGER_DEFAULT_SOURCE, 'No provided room slug');
    process.exit(1);
}

logger.addToSourceWhitelist('console', LOGGER_DEFAULT_SOURCE);

let botParams;
if ('e' in argv && 'p' in argv) {
    botParams = { email: argv.e, password: argv.p };
} else {
    botParams = { guest: true };
}

const bot = new PlugAPI(botParams);
bot.setLogger(logger);

logger.info(LOGGER_DEFAULT_SOURCE,'Creating or verifying database.');
const db = new sqlite3.Database('./stats.sqlite');

db.serialize();
db.exec('PRAGMA foreign_keys = FALSE')
    .exec('PRAGMA optimize')
    .exec('PRAGMA auto_vacuum = FULL');

db.get('PRAGMA user_version;', (err, row) => {
    if (err) throw err;
    let statement;

    switch (row.user_version * 1) {
        case 0:
            // This case may run on databases that existed for DB versioning. Cannot assume the tables don't exist.
            db.exec('CREATE TABLE IF NOT EXISTS `dj` ( `id` INTEGER NOT NULL, `username` TEXT, PRIMARY KEY(`id`) ) WITHOUT ROWID')
                .exec('CREATE TABLE IF NOT EXISTS "play" ( `song_id` INTEGER NOT NULL, `room_slug` INTEGER NOT NULL, `dj_id` INTEGER NOT NULL, `unixdate` INTEGER NOT NULL, `woots` INTEGER NOT NULL DEFAULT 0, `grabs` INTEGER NOT NULL DEFAULT 0, `mehs` INTEGER NOT NULL DEFAULT 0, `skipped` INTEGER NOT NULL DEFAULT 0, `listeners` INTEGER NOT NULL DEFAULT 0 )')
                .exec('CREATE TABLE IF NOT EXISTS `room` ( `slug` TEXT NOT NULL UNIQUE, `title` TEXT )')
                .exec('CREATE TABLE IF NOT EXISTS "song" ( `title` TEXT, `cid` TEXT, `author` TEXT, `id` INTEGER NOT NULL, PRIMARY KEY(`id`) ) WITHOUT ROWID');
        case 1:
            db.exec('CREATE TABLE song_copied AS SELECT * FROM song WHERE 0 = 0;')
                .exec('DROP TABLE song;')
                .exec('CREATE TABLE "song" ( `id` INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, `title` TEXT, `cid` TEXT, `author` TEXT )')
                .exec('INSERT into song (author, title, cid)  select max(author), max(title), cid FROM song_copied GROUP BY cid');

            statement = db.prepare('UPDATE play SET song_id = ? WHERE room_slug = ? AND unixdate = ?');
            db.each('SELECT room_slug, unixdate, song_id FROM play;', (err, playRow) => {
                if (err) throw err;

                db.get('SELECT song.id FROM song JOIN song_copied ON song.cid = song_copied.cid WHERE song_copied.id = ?', [playRow.song_id], (err, songRow) => {
                    statement.run([songRow.id, playRow.room_slug, playRow.unixdate]);
                });
            }, () => {
                db.exec('DROP TABLE song_copied');
            });


        default: 
            break;
    }

    db.run('PRAGMA user_version = ' + DB_VERSION);

    logger.info(LOGGER_DEFAULT_SOURCE, `Atempting to connect to "${ROOM}"`);
    bot.connect(ROOM);
});

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
    db.get('SELECT id FROM song WHERE cid = ?', media.cid, (err, row) => {
        if (err) throw err;

        if (!row) {
            logger.debug(LOGGER_DEFAULT_SOURCE, 'Attempting to insert song ' + media.id);
            db.run('INSERT INTO song (cid, author, title) VALUES (?,?,?)', media.cid, media.author, media.title);
        } else {
            logger.debug(LOGGER_DEFAULT_SOURCE, 'Attempting to update song ');
            db.run('UPDATE song  SET cid = ?, author = ?, title = ? WHERE cid = ?', media.cid, media.author, media.title, media.cid);
        }
    });
}

function insertPlay(db, room, media, score, user) {
    if (media && 'cid' in media) {
        logger.debug(LOGGER_DEFAULT_SOURCE, 'Attempting to insert new play for song ' + media.cid);
        if (user) {
            db.get('SELECT id FROM song WHERE cid = ?', [media.cid], (err, row) => {
                if (err || !row) throw 'Song ID mismatch';

                db.run('INSERT INTO play (song_id, room_slug, unixdate, dj_id, woots, grabs, mehs, skipped, listeners) VALUES (?, ?,?,?,?,?,?,?,?)', 
                    [row.id, room, Math.floor(Date.now() / 1000), user.id, score.positive, score.grabs, score.negative, score.skipped ? 1 : 0, score.listeners]
                );
            });

            return true;
        }
    }

    return false;
}

process.on('SIGINT', () => {
    cleanup();
    console.log('Exitting...');
    process.exit(0);
});

// Wait a couple seconds so not to spam a room
let _isReconnecting = false;
const reconnect = () => { 
    logger.warn(LOGGER_DEFAULT_SOURCE, 'Trying to reconnect'); 
    _isReconnecting = true; 

    setTimeout(() => { 
        bot.connect(ROOM); 

        if (bot.getDJ() && bot.getMedia()) {
            newDj(db, bot.getDJ());
            newSong(db, bot.getMedia());
        }
        _isReconnecting = false;
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
    console.log(`${data.user.username} Skipped the song`);
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
                    logger.debug('Song has run long. Attempting reconnection');
                    reconnect();
                }
            }, (data.media.duration + 5) * 1000); // Just use duration because 
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
