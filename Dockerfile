FROM node@sha256:88da5cd281ece24309c4e6fcce000a8001b17804e19f94a0439954568716a668
RUN mkdir /app && cd ./app && npm install -g node-gyp
WORKDIR /app
COPY package*.json ./
RUN npm ci

ENV PLUGDJ_EMAIL ''
ENV PLUGDJ_PASS ''
ENV PLUGDJ_ROOM ''

COPY ./ /app/

CMD node ./index.js --bail