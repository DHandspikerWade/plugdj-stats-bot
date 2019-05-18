const argv = require('minimist')(process.argv.slice(2));
const logger = new (require("jethro"))();

require('dotenv').config();

const redisHandle = require('./redis')(logger)
const redis = redisHandle.getClient();
const sqliteHandle = require('./sqlite')(logger);
const prefix = (process.env.PLUGDJ_REDIS_PREFIX || 'PlugDJ') + '.';

const importer = new Promise((finish) => {
    let chain = Promise.resolve();

    redis.get(prefix + 'djs', (djs) => {
        if (djs) {
            let djPromises = [];
            djs.forEach(element => {
                let dj = JSON.parse(element);
                djPromises.push(sqliteHandle.newDj(dj));
            });

            chain = chain.then(() => { return Promise.all(djPromises) });

            redis.get(prefix + 'songs', (songs) => {

            });
        }
    });
    
});


importer.finally(() => {
    redisHandle.cleanup();
    sqliteHandle.cleanup();
});
