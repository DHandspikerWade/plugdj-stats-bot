FROM node:lts-slim as build
RUN apt-get update && apt-get install -y -q --no-install-recommends build-essential python && mkdir /build && cd /build && npm install -g node-gyp
WORKDIR /build
COPY package*.json /build/
RUN npm ci

FROM node:lts-slim
RUN mkdir /app

WORKDIR /app
COPY --from=build /build/node_modules node_modules

ENV PLUGDJ_EMAIL ''
ENV PLUGDJ_PASS ''
ENV PLUGDJ_ROOM ''

COPY ./ /app/

CMD node ./index.js --bail