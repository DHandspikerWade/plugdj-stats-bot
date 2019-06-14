FROM node:lts-slim
RUN mkdir /app && cd ./app && npm install -g node-gyp
WORKDIR /app
COPY package*.json ./
RUN npm ci

ENV PLUGDJ_EMAIL ''
ENV PLUGDJ_PASS ''
ENV PLUGDJ_ROOM ''

COPY ./ /app/

CMD node ./index.js --bail