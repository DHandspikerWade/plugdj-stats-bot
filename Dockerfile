FROM node:lts-slim
COPY package.json ./app/
RUN cd ./app && npm install -g node-gyp
RUN cd ./app && npm install
COPY index.js ./app/

ENV PLUGDJ_EMAIL ''
ENV PLUGDJ_PASS ''
ENV PLUGDJ_ROOM ''

CMD cd ./app && node ./index.js --bail