const LOGGER_DEFAULT_SOURCE = 'Redis';

module.exports = (logger) => {
    const redis = require('redis');
    const redisOptions = {};
    const prefix = process.env.PLUGDJ_REDIS_PREFIX || 'PlugDJ';

    if (process.env.PLUGDJ_REDIS_HOST) {
        redisOptions.host = process.env.PLUGDJ_REDIS_HOST;
    }

    if (process.env.PLUGDJ_REDIS_PORT) {
        redisOptions.port = process.env.PLUGDJ_REDIS_PORT;
    }

    if (process.env.PLUGDJ_REDIS_PASSWORD) {
        redisOptions.password = process.env.PLUGDJ_REDIS_PASSWORD;
    }

    if (process.env.PLUGDJ_REDIS_DB) {
        redisOptions.db = process.env.PLUGDJ_REDIS_DB;
    }

    logger.info(LOGGER_DEFAULT_SOURCE, 'Attempting Redis connection');
    const client = redis.createClient(redisOptions);

    client.hsetnx(prefix + '.config', 'owner', '');

    return {
        cleanup: function() {
            client.quit(); logger.info(LOGGER_DEFAULT_SOURCE, 'Closing Redis connection');
        },
        newDj: function (dj) {
            logger.debug(LOGGER_DEFAULT_SOURCE, 'Attempting to update dj ' + dj.id);
            client.hset(prefix + '.djs', dj.id, JSON.stringify({ username: dj.username, id: dj.id}));
        },
        insertPlay: function (room, media, score, user) {
            if (media && 'cid' in media) {
                logger.debug(LOGGER_DEFAULT_SOURCE, 'Attempting to insert new play for song ' + media.cid);
                if (user) {
                    client.rpush(prefix + '.' + room + '.plays', JSON.stringify({
                        room: room,
                        song_cid: media.cid,
                        unixdate: Math.floor(Date.now() / 1000), 
                        dj_id: user.id, 
                        woots: score.positive, 
                        grabs: score.grabs, 
                        mehs: score.negative, 
                        skipped: score.skipped ? 1 : 0, 
                        listeners: score.listeners
                    }));
        
                    return true;
                }
            }
        
            return false;
        },
        newSong: function (media) {
            logger.debug(LOGGER_DEFAULT_SOURCE, 'Attempting to insert song ' + media.id);
            client.rpush(prefix + '.songs', JSON.stringify({
                cid: media.cid, 
                author: media.author, 
                title: media.title
            }));
        },
        getConfig: function(key, callback) {
            let returnPromise = new Promise((resolve, reject) => {
                client.hget(prefix + '.config', key, (err, reply) => {
                    if (err) {
                        reject(err);
                    } else {
                        if (!reply || reply === 'false' || reply === 'null' || reply === 'OK') {
                            resolve(false);
                        } else if (reply === 'true') {
                            resolve(true);
                        } else {
                            resolve(reply ? JSON.parse(reply) : false);
                        }
                    }
                });
            });

            returnPromise.then(callback, (error) => {
                logger.error(LOGGER_DEFAULT_SOURCE, error);
            });

            return returnPromise;
        },
        setConfig: function(key, value) {
            let returnPromise = new Promise((resolve, reject) => {
                client.hset(prefix + '.config', key, JSON.stringify(value), (err, reply) => {
                    if (err) {
                        reject(err);
                    } else {
                        if (!reply) {
                            resolve(false);
                        } else if (reply === 'true' || reply === 'OK') {
                            resolve(true);
                        } else {
                            resolve(reply);
                        }
                    }
                });
            });

            returnPromise.then(null, (error) => {
                logger.error(LOGGER_DEFAULT_SOURCE, error);
            });

            return returnPromise;
        },
        getClient: function () { return client; }
    };
};