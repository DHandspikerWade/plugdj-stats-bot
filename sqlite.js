const LOGGER_DEFAULT_SOURCE = 'SQLite';
const DB_VERSION = 2;

module.exports = (bot, logger) => {
    const sqlite3 = require('sqlite3');

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
    });

    return {
        cleanup: function() {
            db.close(); logger.debug(LOGGER_DEFAULT_SOURCE, 'Closing SQLite database');
        },
        newDj: function (dj) {
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
        },
        insertPlay: function (room, media, score, user) {
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
        },
        newSong: function (media) {
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
    };
};