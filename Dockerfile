FROM node:lts-slim
RUN mkdir /app && cd ./app && npm install -g node-gyp
COPY ./ ./app/
RUN cd ./app && npm ci


ENV PLUGDJ_EMAIL ''
ENV PLUGDJ_PASS ''
ENV PLUGDJ_ROOM ''

CMD cd ./app && node ./index.js --bail