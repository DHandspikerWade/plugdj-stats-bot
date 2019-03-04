FROM node:lts-slim
COPY package.json ./app/
RUN cd ./app && npm install -g node-gyp
RUN cd ./app && npm install
COPY index.js ./app/

ENV username ''
ENV password ''
ENV room ' '

CMD cd ./app && node ./index.js -e "$username" -p "$password" -r "$room" --bail